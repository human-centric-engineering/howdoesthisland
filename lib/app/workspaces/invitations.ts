/**
 * Inviting people into a workspace, whether or not they have an account (t-9).
 *
 * Every signup gets a workspace of its own (t-7), so most colleagues already
 * have an account by the time a team forms. Core's org invitation refuses
 * those addresses, and core's add-by-id needs no consent from the person. So
 * the app has one invitation path, {@link inviteIntoWorkspace}, with two
 * branches the inviter cannot tell apart:
 *
 * - **The address has an account**: a `WorkspaceInvitation` row, and an email
 *   saying where to answer it. The invitee lists, accepts and declines it in
 *   the app ({@link listInvitationsFor}, {@link acceptInvitation},
 *   {@link declineInvitation}); accepting adds them through core's
 *   `addMember()`.
 * - **It has none**: core's sign-up invitation (`deliverInvitation`), with the
 *   same rules core's `POST /api/v1/orgs/[id]/invitations` applies, re-stated
 *   here because that route answers 409 for an existing account and the app
 *   route must not.
 *
 * **Never confirm or deny an account.** Both branches resolve to nothing, and
 * the route answers the same whatever happened. That includes the cases where
 * nothing is sent: the person is already a member, the address is the seeded
 * service account, or core holds a sign-up invitation for that address into
 * another org (which this must not re-target, as core's route must not). Each
 * is logged. Both sending branches send one email, so the two take about as
 * long as each other; the no-send cases are quicker, and say nothing about an
 * account, since one is a member the inviter can already see and the other
 * is an address with no account.
 *
 * Who may invite is the policy's (the route hands it the org resource, as
 * core's does), and what may be invited is core's `checkInvitationInto`: the
 * install org takes none, a suspended workspace issues none, and only an owner
 * invites an owner.
 */
import { APIError } from '@/lib/api/errors';
import { DEFAULT_USER_ROLE } from '@/lib/auth/roles';
import { deliverInvitation } from '@/lib/auth/invitation-delivery';
import { prisma } from '@/lib/db/client';
import { env } from '@/lib/env';
import { sendEmail } from '@/lib/email/send';
import type { Logger } from '@/lib/logging';
import { getTenantContext, runAsSystem } from '@/lib/tenancy/context';
import {
  addMember,
  checkInvitationInto,
  OrgLifecycleError,
  type MembershipActor,
} from '@/lib/tenancy/lifecycle';
import { DEFAULT_ORG_ROLE, ORG_OWNER_ROLE, type OrgRole } from '@/lib/tenancy/roles';
import { getValidInvitation, INVITATION_IDENTIFIER_PREFIX } from '@/lib/utils/invitation-token';
import { WORKSPACE_INVITATION_TTL_DAYS } from '@/lib/app/workspaces/validations';
import WorkspaceInvitationEmail from '@/components/app/emails/workspace-invitation';

/** Where an invitee answers their invitations. */
export const INVITATIONS_PATH = '/settings/workspace';

const ROLE_LABELS: Record<OrgRole, string> = { OWNER: 'Owner', ADMIN: 'Admin', MEMBER: 'Member' };

export type WorkspaceInvitationErrorCode =
  'INVITATION_NOT_FOUND' | 'INVITATION_ALREADY_ANSWERED' | 'INVITATION_EXPIRED';

const STATUS_FOR: Record<WorkspaceInvitationErrorCode, number> = {
  INVITATION_NOT_FOUND: 404,
  INVITATION_ALREADY_ANSWERED: 409,
  INVITATION_EXPIRED: 410,
};

/**
 * An answer refused. An `APIError`, so a route that lets it propagate gets
 * the right status and code from the guard with no mapping of its own.
 */
export class WorkspaceInvitationError extends APIError {
  constructor(code: WorkspaceInvitationErrorCode, message: string) {
    super(message, code, STATUS_FOR[code]);
    this.name = 'WorkspaceInvitationError';
  }
}

export interface InviteIntoWorkspaceInput {
  orgId: string;
  email: string;
  /** Used only by the sign-up branch, which greets them by it. */
  name: string;
  /** Absent means the role a pending invitation already carries, or `MEMBER`. */
  orgRole?: OrgRole;
  actor: MembershipActor;
  inviter: { id: string; name: string };
  log: Logger;
}

/** Invite `email` into the workspace. Resolves to nothing either way (see the header). */
export async function inviteIntoWorkspace(input: InviteIntoWorkspaceInput): Promise<void> {
  await checkInvitationInto(input.orgId, input.orgRole, input.actor);

  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, accountType: true },
  });

  if (!user) return inviteNewPerson(input);
  if (user.accountType === 'SERVICE') {
    input.log.info('Workspace invitation not sent: the address is the service account', {
      orgId: input.orgId,
    });
    return;
  }
  return inWorkspace(input.orgId, () => inviteExistingAccount(input, user.id));
}

/**
 * Run the invitation's writes as the workspace. The policy admits its owners
 * and admins only while acting in it, which is already this scope; a platform
 * admin is admitted from anywhere, and their write needs the bypass to land in
 * a workspace they are not acting in.
 */
function inWorkspace<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  if (getTenantContext()?.orgId === orgId) return fn();
  return runAsSystem('app.workspace-invitations: a platform admin invites from outside', fn);
}

async function inviteExistingAccount(input: InviteIntoWorkspaceInput, userId: string) {
  const { orgId, log } = input;

  const member = await prisma.orgMembership.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { id: true },
  });
  if (member) {
    log.info('Workspace invitation not sent: already a member', { orgId, userId });
    return;
  }

  const now = new Date();
  const existing = await prisma.workspaceInvitation.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { status: true, role: true, expiresAt: true },
  });
  const pending = existing?.status === 'PENDING' && existing.expiresAt > now ? existing : null;
  // Replacing an OWNER invitation needs owner standing whatever the new role
  // is, as core's route asks before re-sending one.
  if (pending?.role === ORG_OWNER_ROLE) {
    await checkInvitationInto(orgId, ORG_OWNER_ROLE, input.actor);
  }
  const role = input.orgRole ?? pending?.role ?? DEFAULT_ORG_ROLE;
  const expiresAt = new Date(now.getTime() + WORKSPACE_INVITATION_TTL_DAYS * 86_400_000);

  // One row per person per workspace: a declined, expired or used invitation
  // is reopened rather than duplicated.
  await prisma.workspaceInvitation.upsert({
    where: { orgId_userId: { orgId, userId } },
    create: { orgId, userId, role, invitedByUserId: input.inviter.id, expiresAt },
    update: {
      role,
      status: 'PENDING',
      invitedByUserId: input.inviter.id,
      expiresAt,
      respondedAt: null,
    },
  });

  const workspace = await prisma.org.findUnique({ where: { id: orgId }, select: { name: true } });
  const result = await sendEmail({
    to: input.email,
    subject: `${input.inviter.name} invited you to ${workspace?.name ?? 'a workspace'}`,
    react: WorkspaceInvitationEmail({
      inviterName: input.inviter.name,
      workspaceName: workspace?.name ?? 'a workspace',
      roleLabel: ROLE_LABELS[role],
      invitationsUrl: `${env.BETTER_AUTH_URL}${INVITATIONS_PATH}`,
      expiresAt,
    }),
  });
  if (!result.success) {
    log.warn('Workspace invitation stored; its email did not go out', {
      orgId,
      userId,
      deliveryStatus: result.status,
    });
  }
  log.info(pending ? 'Workspace invitation re-sent' : 'Workspace invitation created', {
    orgId,
    userId,
    role,
    invitedBy: input.inviter.id,
  });
}

/**
 * Core's sign-up invitation, under the rules core's org route applies to it.
 * Where that route would answer 409 (a pending invitation into another org,
 * or one this cannot read), nothing is sent and the answer is the same.
 */
async function inviteNewPerson(input: InviteIntoWorkspaceInput) {
  const { orgId, email, log } = input;

  // `getValidInvitation` answers null for a row it cannot parse, so look for
  // any unexpired row before believing it: one this cannot read is not ours.
  const existing = await getValidInvitation(email);
  const unreadablePending =
    !existing &&
    (await prisma.verification.count({
      where: {
        identifier: `${INVITATION_IDENTIFIER_PREFIX}${email}`,
        expiresAt: { gt: new Date() },
      },
    })) > 0;
  if (
    unreadablePending ||
    (existing &&
      (existing.metadata.orgId !== orgId || existing.metadata.role !== DEFAULT_USER_ROLE))
  ) {
    log.info('Workspace invitation not sent: another invitation is pending for this address', {
      orgId,
    });
    return;
  }

  if (existing?.metadata.orgRole === ORG_OWNER_ROLE) {
    await checkInvitationInto(orgId, ORG_OWNER_ROLE, input.actor);
  }
  const orgRole = input.orgRole ?? existing?.metadata.orgRole;

  const delivered = await deliverInvitation({
    email,
    name: input.name,
    metadata: {
      name: input.name,
      role: DEFAULT_USER_ROLE,
      invitedBy: input.inviter.id,
      invitedAt: new Date().toISOString(),
      orgId,
      ...(orgRole ? { orgRole } : {}),
    },
    isResend: !!existing,
    inviterName: input.inviter.name,
    log,
  });
  log.info(existing ? 'Sign-up invitation re-sent' : 'Sign-up invitation created', {
    orgId,
    orgRole: orgRole ?? null,
    invitedBy: input.inviter.id,
    emailStatus: delivered.emailStatus,
  });
}

/** One pending invitation, as its invitee sees it. */
export interface InvitationForInvitee {
  id: string;
  workspace: { id: string; name: string };
  role: OrgRole;
  invitedBy: string | null;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * The person's open invitations: pending, unexpired, into an active
 * workspace. Read in the system scope because they span workspaces the person
 * is not in; the `userId` filter is the only fence, and it is the caller's own id.
 */
export async function listInvitationsFor(userId: string): Promise<InvitationForInvitee[]> {
  return runAsSystem('app.workspace-invitations: an invitee lists their own', async () => {
    const rows = await prisma.workspaceInvitation.findMany({
      where: {
        userId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        org: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        role: true,
        expiresAt: true,
        createdAt: true,
        invitedByUserId: true,
        org: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const inviterIds = [
      ...new Set(rows.flatMap((row) => (row.invitedByUserId ? [row.invitedByUserId] : []))),
    ];
    const inviters = inviterIds.length
      ? await prisma.user.findMany({
          where: { id: { in: inviterIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameOf = new Map(inviters.map((user) => [user.id, user.name]));

    return rows.flatMap((row) =>
      row.org
        ? [
            {
              id: row.id,
              workspace: row.org,
              role: row.role,
              invitedBy: row.invitedByUserId ? (nameOf.get(row.invitedByUserId) ?? null) : null,
              expiresAt: row.expiresAt,
              createdAt: row.createdAt,
            },
          ]
        : []
    );
  });
}

/**
 * The invitation, if it is `userId`'s and still open. Someone else's is
 * answered exactly as a missing one, so an id says nothing about who holds it.
 */
async function requireOpenInvitation(invitationId: string, userId: string) {
  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { id: invitationId },
    select: { id: true, orgId: true, userId: true, role: true, status: true, expiresAt: true },
  });
  if (!invitation || invitation.userId !== userId || !invitation.orgId) {
    throw new WorkspaceInvitationError('INVITATION_NOT_FOUND', 'Invitation not found');
  }
  if (invitation.status !== 'PENDING') {
    throw new WorkspaceInvitationError(
      'INVITATION_ALREADY_ANSWERED',
      'This invitation has already been answered'
    );
  }
  if (invitation.expiresAt <= new Date()) {
    throw new WorkspaceInvitationError(
      'INVITATION_EXPIRED',
      'This invitation has expired. Ask the workspace to invite you again.'
    );
  }
  return { ...invitation, orgId: invitation.orgId };
}

/** Move an open invitation to `status`, once: false if another answer got there first. */
async function claim(invitationId: string, status: 'ACCEPTED' | 'DECLINED'): Promise<boolean> {
  const now = new Date();
  const { count } = await prisma.workspaceInvitation.updateMany({
    where: { id: invitationId, status: 'PENDING', expiresAt: { gt: now } },
    data: { status, respondedAt: now },
  });
  return count === 1;
}

function alreadyAnswered(): WorkspaceInvitationError {
  return new WorkspaceInvitationError(
    'INVITATION_ALREADY_ANSWERED',
    'This invitation has already been answered'
  );
}

/**
 * The standing an accepted invitation carries into `addMember()`. Core asks
 * the inviter's standing when an invitation is issued, not when it is
 * accepted, since by then it is not known: an OWNER invitation exists only
 * because someone with owner standing issued it, and no other role needs any.
 */
function issuedInvitationActor(role: OrgRole): MembershipActor {
  return { platformAdmin: false, orgRole: role === ORG_OWNER_ROLE ? ORG_OWNER_ROLE : null };
}

/**
 * Accept: the invitation is claimed first, so it is used once however many
 * requests race, then the membership is written by core. If core refuses for
 * any reason but "already a member", the claim is undone so it can be tried
 * again.
 */
export async function acceptInvitation(
  invitationId: string,
  userId: string
): Promise<{ orgId: string; role: OrgRole }> {
  return runAsSystem('app.workspace-invitations: an invitee accepts their own', async () => {
    const invitation = await requireOpenInvitation(invitationId, userId);
    if (!(await claim(invitation.id, 'ACCEPTED'))) throw alreadyAnswered();

    try {
      const membership = await addMember(
        invitation.orgId,
        userId,
        invitation.role,
        issuedInvitationActor(invitation.role)
      );
      return { orgId: membership.orgId, role: membership.role };
    } catch (error) {
      if (!(error instanceof OrgLifecycleError && error.code === 'ALREADY_MEMBER')) {
        await prisma.workspaceInvitation.updateMany({
          where: { id: invitation.id, status: 'ACCEPTED' },
          data: { status: 'PENDING', respondedAt: null },
        });
      }
      throw error;
    }
  });
}

/** Decline: the invitation is closed and the workspace can see it was declined. */
export async function declineInvitation(invitationId: string, userId: string): Promise<void> {
  await runAsSystem('app.workspace-invitations: an invitee declines their own', async () => {
    const invitation = await requireOpenInvitation(invitationId, userId);
    if (!(await claim(invitation.id, 'DECLINED'))) throw alreadyAnswered();
  });
}

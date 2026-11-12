/**
 * Tests: workspace invitations (t-9).
 *
 * Prisma is mocked at the delegates. `checkInvitationInto` and
 * `OrgLifecycleError` are core's real ones (so the OWNER-standing and
 * suspended-org rules are what refuse); only `addMember` is replaced. The
 * sign-up delivery, token store and mailer are mocked at the module edge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';

vi.mock('@/lib/env', () => ({ env: { BETTER_AUTH_URL: 'http://app.test' } }));

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({ logger: mockLog }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    workspaceInvitation: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    orgMembership: { findUnique: vi.fn() },
    org: { findUnique: vi.fn() },
    verification: { count: vi.fn() },
  },
}));

const mockTenant = vi.hoisted(() => ({ current: null as { orgId: string | null } | null }));
const mockRunAsSystem = vi.hoisted(() =>
  vi.fn((_reason: string, fn: () => Promise<unknown>) => fn())
);
vi.mock('@/lib/tenancy/context', () => ({
  getTenantContext: () => mockTenant.current,
  runAsSystem: mockRunAsSystem,
}));

const mockAddMember = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tenancy/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tenancy/lifecycle')>();
  return { ...actual, addMember: mockAddMember };
});

const mockDeliver = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/invitation-delivery', () => ({ deliverInvitation: mockDeliver }));

vi.mock('@/lib/utils/invitation-token', () => ({
  getValidInvitation: vi.fn(),
  INVITATION_IDENTIFIER_PREFIX: 'invitation:',
}));
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn() }));
// Capture the props the email is built from; its markup has its own tests.
vi.mock('@/components/app/emails/workspace-invitation', () => ({
  default: (props: Record<string, unknown>) => ({ emailProps: props }),
}));

import { prisma } from '@/lib/db/client';
import { sendEmail } from '@/lib/email/send';
import { getValidInvitation } from '@/lib/utils/invitation-token';
import { OrgLifecycleError } from '@/lib/tenancy/lifecycle';
import { WORKSPACE_INVITATION_TTL_DAYS } from '@/lib/app/workspaces/validations';
import {
  WorkspaceInvitationError,
  acceptInvitation,
  declineInvitation,
  inviteIntoWorkspace,
  listInvitationsFor,
} from '@/lib/app/workspaces/invitations';

const ORG = 'cmorg000000000000000team1';
const OTHER_ORG = 'cmorg0000000000000000org2';
const INVITER = { id: 'cminviter00000000000001', name: 'Ines Inviter' };
const INVITEE_ID = 'cminvitee00000000000001';
const INVITATION_ID = 'cminvitation000000000001';
const EMAIL = 'jane@example.com';

const adminActor = { platformAdmin: false, orgRole: 'ADMIN' };
const ownerActor = { platformAdmin: false, orgRole: 'OWNER' };

function input(overrides: Record<string, unknown> = {}) {
  return {
    orgId: ORG,
    email: EMAIL,
    name: 'Jane Doe',
    actor: adminActor,
    inviter: INVITER,
    log: mockLog,
    ...overrides,
  } as unknown as Parameters<typeof inviteIntoWorkspace>[0];
}

const future = () => new Date(Date.now() + 3 * 86_400_000);
const past = () => new Date(Date.now() - 1000);

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITATION_ID,
    orgId: ORG,
    userId: INVITEE_ID,
    role: 'MEMBER',
    status: 'PENDING',
    expiresAt: future(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockTenant.current = { orgId: ORG };
  mockRunAsSystem.mockImplementation((_r: string, fn: () => Promise<unknown>) => fn());
  vi.mocked(prisma.org.findUnique).mockResolvedValue({
    id: ORG,
    name: 'Design Team',
    status: 'ACTIVE',
  } as never);
  vi.mocked(sendEmail).mockResolvedValue({ success: true, status: 'sent', id: 'e1' });
  vi.mocked(getValidInvitation).mockResolvedValue(null);
  vi.mocked(prisma.verification.count).mockResolvedValue(0);
  vi.mocked(prisma.workspaceInvitation.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.workspaceInvitation.updateMany).mockResolvedValue({ count: 1 });
  mockDeliver.mockResolvedValue({ emailStatus: 'sent' });
});

describe('inviteIntoWorkspace — the address has an account', () => {
  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: INVITEE_ID,
      accountType: 'HUMAN',
    } as never);
    vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(null);
  });

  it('upserts a PENDING invitation with the role, inviter and a TTL expiry, and emails the invitee', async () => {
    const before = Date.now();

    await inviteIntoWorkspace(input({ orgRole: 'ADMIN' }));

    const args = vi.mocked(prisma.workspaceInvitation.upsert).mock.calls[0][0];
    expect(args.where).toEqual({ orgId_userId: { orgId: ORG, userId: INVITEE_ID } });
    expect(args.create).toMatchObject({
      orgId: ORG,
      userId: INVITEE_ID,
      role: 'ADMIN',
      invitedByUserId: INVITER.id,
    });
    expect(args.update).toMatchObject({
      role: 'ADMIN',
      status: 'PENDING',
      invitedByUserId: INVITER.id,
      respondedAt: null,
    });
    const expiresAt = (args.create as { expiresAt: Date }).expiresAt.getTime();
    const ttl = WORKSPACE_INVITATION_TTL_DAYS * 86_400_000;
    expect(expiresAt).toBeGreaterThanOrEqual(before + ttl);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + ttl);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: EMAIL,
        subject: 'Ines Inviter invited you to Design Team',
      })
    );
    const react = vi.mocked(sendEmail).mock.calls[0][0].react as unknown as {
      emailProps: Record<string, unknown>;
    };
    expect(react.emailProps).toMatchObject({
      inviterName: 'Ines Inviter',
      workspaceName: 'Design Team',
      roleLabel: 'Admin',
      invitationsUrl: 'http://app.test/settings/workspace',
    });
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it('defaults the role to MEMBER when none is sent and none is pending', async () => {
    await inviteIntoWorkspace(input());

    expect(vi.mocked(prisma.workspaceInvitation.upsert).mock.calls[0][0].create).toMatchObject({
      role: 'MEMBER',
    });
  });

  it('keeps the pending invitation role on a re-invite that names none', async () => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue({
      status: 'PENDING',
      role: 'ADMIN',
      expiresAt: future(),
    } as never);

    await inviteIntoWorkspace(input());

    expect(vi.mocked(prisma.workspaceInvitation.upsert).mock.calls[0][0].update).toMatchObject({
      role: 'ADMIN',
    });
  });

  it('does not inherit the role of an expired or answered invitation', async () => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue({
      status: 'PENDING',
      role: 'ADMIN',
      expiresAt: past(),
    } as never);

    await inviteIntoWorkspace(input());

    expect(vi.mocked(prisma.workspaceInvitation.upsert).mock.calls[0][0].update).toMatchObject({
      role: 'MEMBER',
    });
  });

  it('writes nothing and sends nothing for an existing member', async () => {
    vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue({ id: 'm1' } as never);

    await expect(inviteIntoWorkspace(input())).resolves.toBeUndefined();

    expect(prisma.orgMembership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId_userId: { orgId: ORG, userId: INVITEE_ID } } })
    );
    expect(prisma.workspaceInvitation.upsert).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it('writes nothing and sends nothing for the SERVICE account', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'svc',
      accountType: 'SERVICE',
    } as never);

    await expect(inviteIntoWorkspace(input())).resolves.toBeUndefined();

    expect(prisma.orgMembership.findUnique).not.toHaveBeenCalled();
    expect(prisma.workspaceInvitation.upsert).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it('still stores the invitation, and warns, when the email does not go out', async () => {
    vi.mocked(sendEmail).mockResolvedValue({ success: false, status: 'failed', error: 'down' });

    await expect(inviteIntoWorkspace(input())).resolves.toBeUndefined();

    expect(prisma.workspaceInvitation.upsert).toHaveBeenCalledTimes(1);
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('email did not go out'),
      expect.objectContaining({ deliveryStatus: 'failed' })
    );
  });

  it('runs the writes in place when the caller is already acting in the workspace', async () => {
    await inviteIntoWorkspace(input());

    expect(mockRunAsSystem).not.toHaveBeenCalled();
  });

  it('runs the writes in the system scope when a platform admin invites from outside', async () => {
    mockTenant.current = { orgId: null };

    await inviteIntoWorkspace(input({ actor: { platformAdmin: true } }));

    expect(mockRunAsSystem).toHaveBeenCalledTimes(1);
    expect(prisma.workspaceInvitation.upsert).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an OWNER-role invitation', { orgRole: 'OWNER' }, null],
    ['replacing a pending OWNER invitation with a MEMBER one', { orgRole: 'MEMBER' }, 'OWNER'],
    ['re-sending a pending OWNER invitation with no role', {}, 'OWNER'],
  ])(
    'refuses an ADMIN %s with OWNER_STANDING, writing and sending nothing',
    async (_l, extra, pendingRole) => {
      if (pendingRole) {
        vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue({
          status: 'PENDING',
          role: pendingRole,
          expiresAt: future(),
        } as never);
      }

      await expect(inviteIntoWorkspace(input(extra))).rejects.toMatchObject({
        code: 'OWNER_STANDING',
        status: 403,
      });

      expect(prisma.workspaceInvitation.upsert).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    }
  );

  it('lets an OWNER replace a pending OWNER invitation', async () => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue({
      status: 'PENDING',
      role: 'OWNER',
      expiresAt: future(),
    } as never);

    await inviteIntoWorkspace(input({ actor: ownerActor }));

    expect(vi.mocked(prisma.workspaceInvitation.upsert).mock.calls[0][0].update).toMatchObject({
      role: 'OWNER',
    });
  });

  it('refuses a suspended workspace with ORG_NOT_ACTIVE before looking up the address', async () => {
    vi.mocked(prisma.org.findUnique).mockResolvedValue({ id: ORG, status: 'SUSPENDED' } as never);

    await expect(inviteIntoWorkspace(input())).rejects.toMatchObject({ code: 'ORG_NOT_ACTIVE' });

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('refuses the install org before looking up the address', async () => {
    await expect(inviteIntoWorkspace(input({ orgId: INSTALL_ORG_ID }))).rejects.toBeInstanceOf(
      OrgLifecycleError
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('inviteIntoWorkspace — the address has no account', () => {
  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
  });

  it('delivers a sign-up invitation carrying the workspace and role, writing no row of its own', async () => {
    await inviteIntoWorkspace(input({ orgRole: 'ADMIN' }));

    expect(mockDeliver).toHaveBeenCalledTimes(1);
    const arg = mockDeliver.mock.calls[0][0];
    expect(arg).toMatchObject({
      email: EMAIL,
      name: 'Jane Doe',
      isResend: false,
      inviterName: 'Ines Inviter',
      metadata: {
        name: 'Jane Doe',
        role: 'USER',
        invitedBy: INVITER.id,
        orgId: ORG,
        orgRole: 'ADMIN',
      },
    });
    expect(prisma.workspaceInvitation.upsert).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('omits orgRole from the metadata when none is sent or pending', async () => {
    await inviteIntoWorkspace(input());

    expect(mockDeliver.mock.calls[0][0].metadata).not.toHaveProperty('orgRole');
  });

  it('re-sends over this workspace’s own pending invitation, keeping its org role', async () => {
    vi.mocked(getValidInvitation).mockResolvedValue({
      metadata: { orgId: ORG, role: 'USER', orgRole: 'ADMIN' },
    } as never);

    await inviteIntoWorkspace(input());

    expect(mockDeliver.mock.calls[0][0]).toMatchObject({
      isResend: true,
      metadata: { orgId: ORG, orgRole: 'ADMIN' },
    });
  });

  it.each([
    ['another org', { orgId: OTHER_ORG, role: 'USER' }],
    ['no org', { role: 'USER' }],
    ['a platform ADMIN role', { orgId: ORG, role: 'ADMIN' }],
  ])(
    'sends nothing and does not throw over a pending sign-up invitation into %s',
    async (_l, metadata) => {
      vi.mocked(getValidInvitation).mockResolvedValue({ metadata } as never);

      await expect(inviteIntoWorkspace(input())).resolves.toBeUndefined();

      expect(mockDeliver).not.toHaveBeenCalled();
      expect(mockLog.info).toHaveBeenCalledWith(
        expect.stringContaining('another invitation is pending'),
        { orgId: ORG }
      );
    }
  );

  it('sends nothing and does not throw when an unexpired row exists that cannot be read', async () => {
    vi.mocked(getValidInvitation).mockResolvedValue(null);
    vi.mocked(prisma.verification.count).mockResolvedValue(1);

    await expect(inviteIntoWorkspace(input())).resolves.toBeUndefined();

    expect(prisma.verification.count).toHaveBeenCalledWith({
      where: { identifier: `invitation:${EMAIL}`, expiresAt: { gt: expect.any(Date) } },
    });
    expect(mockDeliver).not.toHaveBeenCalled();
  });

  it.each([
    ['an OWNER-role invitation', { orgRole: 'OWNER' }, null],
    ['replacing a pending OWNER sign-up invitation', { orgRole: 'MEMBER' }, 'OWNER'],
  ])(
    'refuses an ADMIN %s with OWNER_STANDING, delivering nothing',
    async (_l, extra, pendingRole) => {
      if (pendingRole) {
        vi.mocked(getValidInvitation).mockResolvedValue({
          metadata: { orgId: ORG, role: 'USER', orgRole: pendingRole },
        } as never);
      }

      await expect(inviteIntoWorkspace(input(extra))).rejects.toMatchObject({
        code: 'OWNER_STANDING',
      });

      expect(mockDeliver).not.toHaveBeenCalled();
    }
  );

  it('lets an OWNER re-send a pending OWNER sign-up invitation', async () => {
    vi.mocked(getValidInvitation).mockResolvedValue({
      metadata: { orgId: ORG, role: 'USER', orgRole: 'OWNER' },
    } as never);

    await inviteIntoWorkspace(input({ actor: ownerActor }));

    expect(mockDeliver.mock.calls[0][0]).toMatchObject({
      isResend: true,
      metadata: { orgRole: 'OWNER' },
    });
  });
});

describe('acceptInvitation', () => {
  beforeEach(() => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(pendingRow() as never);
    mockAddMember.mockResolvedValue({ orgId: ORG, userId: INVITEE_ID, role: 'MEMBER' });
  });

  it('refuses a missing invitation with 404 INVITATION_NOT_FOUND', async () => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(null);

    const error = await acceptInvitation(INVITATION_ID, INVITEE_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WorkspaceInvitationError);
    expect(error).toMatchObject({ code: 'INVITATION_NOT_FOUND', status: 404 });
    expect(mockAddMember).not.toHaveBeenCalled();
  });

  it('answers someone else’s invitation exactly as a missing one', async () => {
    const missing = vi.mocked(prisma.workspaceInvitation.findUnique);
    missing.mockResolvedValueOnce(null);
    const asMissing = await acceptInvitation(INVITATION_ID, INVITEE_ID).catch((e: unknown) => e);
    missing.mockResolvedValueOnce(pendingRow({ userId: 'cmsomeoneelse00000000001' }) as never);

    const asOthers = await acceptInvitation(INVITATION_ID, INVITEE_ID).catch((e: unknown) => e);

    expect(asOthers).toMatchObject({ code: 'INVITATION_NOT_FOUND', status: 404 });
    expect((asOthers as Error).message).toBe((asMissing as Error).message);
    expect(prisma.workspaceInvitation.updateMany).not.toHaveBeenCalled();
    expect(mockAddMember).not.toHaveBeenCalled();
  });

  it('treats a row whose workspace is gone (null orgId) as not found', async () => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(
      pendingRow({ orgId: null }) as never
    );

    await expect(acceptInvitation(INVITATION_ID, INVITEE_ID)).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND',
    });
  });

  it.each(['ACCEPTED', 'DECLINED'])('refuses a %s invitation with 409', async (status) => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(
      pendingRow({ status }) as never
    );

    await expect(acceptInvitation(INVITATION_ID, INVITEE_ID)).rejects.toMatchObject({
      code: 'INVITATION_ALREADY_ANSWERED',
      status: 409,
    });
    expect(mockAddMember).not.toHaveBeenCalled();
  });

  it('refuses an expired invitation with 410, claiming nothing', async () => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(
      pendingRow({ expiresAt: past() }) as never
    );

    await expect(acceptInvitation(INVITATION_ID, INVITEE_ID)).rejects.toMatchObject({
      code: 'INVITATION_EXPIRED',
      status: 410,
    });
    expect(prisma.workspaceInvitation.updateMany).not.toHaveBeenCalled();
    expect(mockAddMember).not.toHaveBeenCalled();
  });

  it('claims with the same clock the expiry check read, so a lapse between them reads as expired', async () => {
    await acceptInvitation(INVITATION_ID, INVITEE_ID);

    const claim = vi.mocked(prisma.workspaceInvitation.updateMany).mock.calls[0][0] as {
      where: { expiresAt: { gt: Date } };
      data: { respondedAt: Date };
    };
    expect(claim.where.expiresAt.gt).toBe(claim.data.respondedAt);
  });

  it('answers 409 when another request claims it first (updateMany count 0), adding no one', async () => {
    vi.mocked(prisma.workspaceInvitation.updateMany).mockResolvedValue({ count: 0 });

    await expect(acceptInvitation(INVITATION_ID, INVITEE_ID)).rejects.toMatchObject({
      code: 'INVITATION_ALREADY_ANSWERED',
      status: 409,
    });
    expect(mockAddMember).not.toHaveBeenCalled();
  });

  it('claims once, conditionally on PENDING and unexpired, then adds the member with the invited role', async () => {
    const result = await acceptInvitation(INVITATION_ID, INVITEE_ID);

    expect(prisma.workspaceInvitation.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.workspaceInvitation.updateMany).toHaveBeenCalledWith({
      where: { id: INVITATION_ID, status: 'PENDING', expiresAt: { gt: expect.any(Date) } },
      data: { status: 'ACCEPTED', respondedAt: expect.any(Date) },
    });
    expect(mockAddMember).toHaveBeenCalledWith(ORG, INVITEE_ID, 'MEMBER', {
      platformAdmin: false,
      orgRole: null,
    });
    expect(result).toEqual({ orgId: ORG, role: 'MEMBER' });
  });

  it('returns only orgId and role from the membership record', async () => {
    mockAddMember.mockResolvedValue({
      orgId: ORG,
      userId: INVITEE_ID,
      role: 'ADMIN',
      id: 'm1',
      createdAt: new Date(),
    });
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(
      pendingRow({ role: 'ADMIN' }) as never
    );

    expect(await acceptInvitation(INVITATION_ID, INVITEE_ID)).toEqual({
      orgId: ORG,
      role: 'ADMIN',
    });
  });

  it('gives addMember OWNER standing only for an OWNER invitation', async () => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(
      pendingRow({ role: 'OWNER' }) as never
    );
    mockAddMember.mockResolvedValue({ orgId: ORG, role: 'OWNER' });

    await acceptInvitation(INVITATION_ID, INVITEE_ID);

    expect(mockAddMember).toHaveBeenCalledWith(ORG, INVITEE_ID, 'OWNER', {
      platformAdmin: false,
      orgRole: 'OWNER',
    });
  });

  it('never grants platform-admin standing to addMember', async () => {
    await acceptInvitation(INVITATION_ID, INVITEE_ID);

    expect(mockAddMember.mock.calls[0][3]).toMatchObject({ platformAdmin: false });
  });

  it('reverts the claim to PENDING and rethrows when addMember fails for another reason', async () => {
    const failure = new OrgLifecycleError('ORG_NOT_FOUND', 'Organisation not found');
    mockAddMember.mockRejectedValue(failure);

    await expect(acceptInvitation(INVITATION_ID, INVITEE_ID)).rejects.toBe(failure);

    expect(prisma.workspaceInvitation.updateMany).toHaveBeenLastCalledWith({
      where: { id: INVITATION_ID, status: 'ACCEPTED' },
      data: { status: 'PENDING', respondedAt: null },
    });
  });

  it('reverts the claim when addMember throws a non-lifecycle error', async () => {
    const failure = new Error('db down');
    mockAddMember.mockRejectedValue(failure);

    await expect(acceptInvitation(INVITATION_ID, INVITEE_ID)).rejects.toBe(failure);

    expect(prisma.workspaceInvitation.updateMany).toHaveBeenCalledTimes(2);
  });

  it('keeps the invitation used and rethrows when the caller is ALREADY_MEMBER', async () => {
    const failure = new OrgLifecycleError('ALREADY_MEMBER', 'That user is already a member');
    mockAddMember.mockRejectedValue(failure);

    await expect(acceptInvitation(INVITATION_ID, INVITEE_ID)).rejects.toBe(failure);

    expect(prisma.workspaceInvitation.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('declineInvitation', () => {
  beforeEach(() => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(pendingRow() as never);
  });

  it('closes the invitation as DECLINED, conditionally on it still being open', async () => {
    await expect(declineInvitation(INVITATION_ID, INVITEE_ID)).resolves.toBeUndefined();

    expect(prisma.workspaceInvitation.updateMany).toHaveBeenCalledWith({
      where: { id: INVITATION_ID, status: 'PENDING', expiresAt: { gt: expect.any(Date) } },
      data: { status: 'DECLINED', respondedAt: expect.any(Date) },
    });
    expect(mockAddMember).not.toHaveBeenCalled();
  });

  it('refuses a missing invitation with 404', async () => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(null);

    await expect(declineInvitation(INVITATION_ID, INVITEE_ID)).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND',
      status: 404,
    });
  });

  it('refuses someone else’s invitation with the same 404, changing nothing', async () => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(
      pendingRow({ userId: 'cmsomeoneelse00000000001' }) as never
    );

    await expect(declineInvitation(INVITATION_ID, INVITEE_ID)).rejects.toMatchObject({
      code: 'INVITATION_NOT_FOUND',
      status: 404,
    });
    expect(prisma.workspaceInvitation.updateMany).not.toHaveBeenCalled();
  });

  it('refuses an answered invitation with 409', async () => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(
      pendingRow({ status: 'ACCEPTED' }) as never
    );

    await expect(declineInvitation(INVITATION_ID, INVITEE_ID)).rejects.toMatchObject({
      code: 'INVITATION_ALREADY_ANSWERED',
      status: 409,
    });
    expect(prisma.workspaceInvitation.updateMany).not.toHaveBeenCalled();
  });

  it('refuses an expired invitation with 410', async () => {
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(
      pendingRow({ expiresAt: past() }) as never
    );

    await expect(declineInvitation(INVITATION_ID, INVITEE_ID)).rejects.toMatchObject({
      code: 'INVITATION_EXPIRED',
      status: 410,
    });
  });

  it('answers 409 when another answer got there first', async () => {
    vi.mocked(prisma.workspaceInvitation.updateMany).mockResolvedValue({ count: 0 });

    await expect(declineInvitation(INVITATION_ID, INVITEE_ID)).rejects.toMatchObject({
      code: 'INVITATION_ALREADY_ANSWERED',
      status: 409,
    });
  });
});

describe('listInvitationsFor', () => {
  const created = new Date('2026-11-01T00:00:00.000Z');
  const expires = new Date('2026-11-15T00:00:00.000Z');

  function row(id: string, invitedByUserId: string | null, org: object | null) {
    return { id, role: 'MEMBER', expiresAt: expires, createdAt: created, invitedByUserId, org };
  }

  it('reads in the system scope, filtered to the caller’s open invitations into active workspaces', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([]);

    await listInvitationsFor(INVITEE_ID);

    expect(mockRunAsSystem).toHaveBeenCalledTimes(1);
    const args = vi.mocked(prisma.workspaceInvitation.findMany).mock.calls[0][0];
    expect(args?.where).toEqual({
      userId: INVITEE_ID,
      status: 'PENDING',
      expiresAt: { gt: expect.any(Date) },
      org: { status: 'ACTIVE', memberships: { none: { userId: INVITEE_ID } } },
    });
    expect(args?.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('attaches inviter names with a single de-duplicated user query', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([
      row('i1', 'u-a', { id: ORG, name: 'Design Team' }),
      row('i2', 'u-a', { id: OTHER_ORG, name: 'Ops' }),
      row('i3', 'u-b', { id: 'cmorg0000000000000000org3', name: 'Sales' }),
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 'u-a', name: 'Alice' },
      { id: 'u-b', name: 'Bob' },
    ] as never);

    const result = await listInvitationsFor(INVITEE_ID);

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['u-a', 'u-b'] } },
      select: { id: true, name: true },
    });
    expect(result).toEqual([
      {
        id: 'i1',
        workspace: { id: ORG, name: 'Design Team' },
        role: 'MEMBER',
        invitedBy: 'Alice',
        expiresAt: expires,
        createdAt: created,
      },
      expect.objectContaining({ id: 'i2', invitedBy: 'Alice' }),
      expect.objectContaining({ id: 'i3', invitedBy: 'Bob' }),
    ]);
    // The raw row's FK is not leaked.
    expect(result[0]).not.toHaveProperty('invitedByUserId');
  });

  it('reports a null inviter when the sender is gone or unrecorded, and skips the user query when no one is named', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([
      row('i1', null, { id: ORG, name: 'Design Team' }),
    ] as never);

    const result = await listInvitationsFor(INVITEE_ID);

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(result[0].invitedBy).toBeNull();
  });

  it('reports a null inviter when the named user is not found', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([
      row('i1', 'u-gone', { id: ORG, name: 'Design Team' }),
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    expect((await listInvitationsFor(INVITEE_ID))[0].invitedBy).toBeNull();
  });

  it('drops a row whose workspace is gone', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([
      row('i1', null, null),
      row('i2', null, { id: ORG, name: 'Design Team' }),
    ] as never);

    const result = await listInvitationsFor(INVITEE_ID);

    expect(result.map((r) => r.id)).toEqual(['i2']);
  });
});

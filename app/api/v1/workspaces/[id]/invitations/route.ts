/**
 * Invite someone into a workspace, account or not (t-9)
 *
 * POST /api/v1/workspaces/[id]/invitations — `{ name, email, orgRole? }`.
 * Someone with an account gets an invitation to answer in the app; someone
 * without one gets core's sign-up invitation (`lib/app/workspaces/invitations.ts`).
 *
 * **The answer never says which.** Core's `POST /api/v1/orgs/[id]/invitations`
 * answers 409 for an address with an account, which tells an org admin who
 * has one. This route answers 202 with the same body whatever happened behind
 * it, including when nothing was sent. The errors below are all about the
 * caller or the workspace, never the address.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a missing name, a malformed email, an unknown role.
 * - 400 `WORKSPACES_UNAVAILABLE` — `TENANCY_MODE=single`.
 * - 400 `ORG_NOT_ACTIVE` — the workspace is suspended.
 * - 400 `INSTALL_ORG_MEMBERSHIP` — the install org, whose members are invited from Users.
 * - 401 `UNAUTHORIZED` — no session.
 * - 403 `FORBIDDEN` — an API key, a `MEMBER`, someone outside the workspace,
 *   or a workspace that does not exist (the policy's one answer).
 * - 403 `OWNER_STANDING` — an `ADMIN` inviting an `OWNER`, or replacing an
 *   invitation that makes someone one.
 * - 429 `RATE_LIMIT_EXCEEDED` — the invite limiter, per IP, as core's route.
 *
 * Who may call it is the authorization policy's, through the same org
 * `resource` core's members and invitation routes hand the guard: the
 * workspace's `OWNER` or `ADMIN` while acting in it, or a platform admin.
 */
import { withAuth } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { successResponse, errorResponse } from '@/lib/api/responses';
import { ForbiddenError } from '@/lib/api/errors';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { orgIdParamSchema } from '@/lib/validations/tenancy';
import { resolveOrgResource, membershipActorOf } from '@/lib/tenancy/lifecycle';
import { isMultiTenant } from '@/lib/tenancy/context';
import { inviteLimiter, createRateLimitResponse } from '@/lib/security/rate-limit';
import { getClientIP } from '@/lib/security/ip';
import { inviteIntoWorkspace } from '@/lib/app/workspaces/invitations';
import { inviteToWorkspaceSchema } from '@/lib/app/workspaces/validations';

const RESOURCE = {
  resource: async (_request: unknown, context?: { params: Promise<{ id: string }> }) =>
    resolveOrgResource(await context?.params),
  ownership: {
    decidedBy: 'resource',
    because:
      'The policy admitted the caller to the workspace the URL names; the invitation is written for that resolved org id, and a sign-up invitation pending into any other org is left untouched.',
  },
} as const;

export const POST = withAuth<{ id: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);

  if (isApiKeySession(session)) {
    log.warn('Rejected API-key attempt to invite into a workspace', { userId: session.user.id });
    throw new ForbiddenError('Inviting people requires a browser session');
  }

  if (!isMultiTenant()) {
    return errorResponse('Workspaces are not available on this install', {
      code: 'WORKSPACES_UNAVAILABLE',
      status: 400,
    });
  }

  // Prevents email bombing, as on core's invite routes.
  const clientIP = getClientIP(request);
  const rateLimitResult = inviteLimiter.check(clientIP);
  if (!rateLimitResult.success) {
    log.warn('Invite rate limit exceeded', { ip: clientIP, userId: session.user.id });
    return createRateLimitResponse(rateLimitResult);
  }

  const { id } = validateQueryParams(new URLSearchParams(await params), orgIdParamSchema);
  const body = await validateRequestBody(request, inviteToWorkspaceSchema);

  await inviteIntoWorkspace({
    orgId: id,
    email: body.email,
    name: body.name,
    orgRole: body.orgRole,
    actor: membershipActorOf(session),
    inviter: { id: session.user.id, name: session.user.name || 'A workspace admin' },
    log,
  });

  return successResponse(
    {
      email: body.email,
      message: `Invitation sent to ${body.email}.`,
    },
    undefined,
    { status: 202 }
  );
}, RESOURCE);

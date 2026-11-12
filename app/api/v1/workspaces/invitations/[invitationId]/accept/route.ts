/**
 * POST /api/v1/workspaces/invitations/[invitationId]/accept (t-9)
 *
 * Accept an invitation: the caller joins the workspace with the invited role, through core's `addMember()`. 200 with `{ orgId, role }`. The session stays where it is; switching into the workspace is core's `POST /api/v1/orgs/switch`.
 *
 * Only the invitee may answer. Anyone else's invitation is answered as a
 * missing one, so an id says nothing about who holds it.
 *
 * Errors:
 * - 400 `WORKSPACES_UNAVAILABLE` — `TENANCY_MODE=single`.
 * - 401 `UNAUTHORIZED` — no session.
 * - 403 `FORBIDDEN` — an API key.
 * - 404 `INVITATION_NOT_FOUND` — no such invitation, or not the caller's.
 * - 409 `INVITATION_ALREADY_ANSWERED` — accepted or declined already.
 * - 409 `ALREADY_MEMBER` — the caller is already in the workspace; the invitation is used.
 * - 410 `INVITATION_EXPIRED` — past its expiry; the workspace can invite again.
 */
import { withAuth } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { successResponse, errorResponse } from '@/lib/api/responses';
import { ForbiddenError } from '@/lib/api/errors';
import { validateQueryParams } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { isMultiTenant } from '@/lib/tenancy/context';
import { acceptInvitation } from '@/lib/app/workspaces/invitations';
import { invitationIdParamSchema } from '@/lib/app/workspaces/validations';

export const POST = withAuth<{ invitationId: string }>(
  async (request, session, { params }) => {
    const log = await getRouteLogger(request);

    if (isApiKeySession(session)) {
      log.warn('Rejected API-key attempt to answer a workspace invitation', {
        userId: session.user.id,
      });
      throw new ForbiddenError('Answering an invitation requires a browser session');
    }

    if (!isMultiTenant()) {
      return errorResponse('Workspaces are not available on this install', {
        code: 'WORKSPACES_UNAVAILABLE',
        status: 400,
      });
    }

    const { invitationId } = validateQueryParams(
      new URLSearchParams(await params),
      invitationIdParamSchema
    );
    const membership = await acceptInvitation(invitationId, session.user.id);
    log.info('Workspace invitation accepted', {
      invitationId,
      orgId: membership.orgId,
      userId: session.user.id,
    });
    return successResponse(membership);
  },
  {
    ownership: {
      decidedBy: 'self',
      because:
        'Answers only an invitation whose invitee is the caller; any other id is refused as not found (lib/app/workspaces/invitations.ts requireOpenInvitation).',
    },
  }
);

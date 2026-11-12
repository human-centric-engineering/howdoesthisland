/**
 * The caller's own open workspace invitations (t-9)
 *
 * GET /api/v1/workspaces/invitations — pending, unexpired invitations into
 * active workspaces, newest first: id, workspace (id, name), role, who sent
 * it, and when it expires. Answered with `accept` / `decline` beside it.
 *
 * Errors:
 * - 400 `WORKSPACES_UNAVAILABLE` — `TENANCY_MODE=single`.
 * - 401 `UNAUTHORIZED` — no session.
 * - 403 `FORBIDDEN` — an API key: a key belongs to one org, and these are
 *   invitations into others.
 */
import { withAuth } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { successResponse, errorResponse } from '@/lib/api/responses';
import { ForbiddenError } from '@/lib/api/errors';
import { getRouteLogger } from '@/lib/api/context';
import { isMultiTenant } from '@/lib/tenancy/context';
import { listInvitationsFor } from '@/lib/app/workspaces/invitations';

export const GET = withAuth(
  async (request, session) => {
    if (isApiKeySession(session)) {
      const log = await getRouteLogger(request);
      log.warn('Rejected API-key attempt to list workspace invitations', {
        userId: session.user.id,
      });
      throw new ForbiddenError('Reading invitations requires a browser session');
    }

    if (!isMultiTenant()) {
      return errorResponse('Workspaces are not available on this install', {
        code: 'WORKSPACES_UNAVAILABLE',
        status: 400,
      });
    }

    const invitations = await listInvitationsFor(session.user.id);
    return successResponse({ invitations });
  },
  {
    ownership: {
      decidedBy: 'self',
      because:
        'Lists invitations whose invitee is the caller (`where.userId = session.user.id`); no other subject can be named.',
    },
  }
);

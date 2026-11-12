/**
 * Create a team workspace (t-8, D1)
 *
 * POST /api/v1/workspaces — `{ name }` → the new workspace, with the caller
 * as its `OWNER`, granted OpenAI and given the default monthly budget as a
 * signup workspace is (`lib/app/workspaces/create.ts`).
 *
 * The response does not switch the session into it: that is core's
 * `POST /api/v1/orgs/switch`, which the client calls next if it wants to.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a missing, blank or over-long name.
 * - 400 `WORKSPACES_UNAVAILABLE` — the install runs at `TENANCY_MODE=single`,
 *   where every account shares the one org and there is nothing to create.
 * - 401 `UNAUTHORIZED` — no session.
 * - 403 `FORBIDDEN` — an API key. A workspace is a person's, made from the
 *   app; a key belongs to one org and cannot found another.
 * - 409 `WORKSPACE_LIMIT_REACHED` — the caller already owns
 *   `MAX_OWNED_WORKSPACES`.
 *
 * Rate limiting is the section cap `proxy.ts` applies to `/api/v1/**`; the
 * ownership cap bounds how many any one person can make.
 */
import { withAuth } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { successResponse, errorResponse } from '@/lib/api/responses';
import { ForbiddenError } from '@/lib/api/errors';
import { validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { isMultiTenant } from '@/lib/tenancy/context';
import { createTeamWorkspace } from '@/lib/app/workspaces/create';
import { createWorkspaceSchema } from '@/lib/app/workspaces/validations';

export const POST = withAuth(
  async (request, session) => {
    const log = await getRouteLogger(request);

    if (isApiKeySession(session)) {
      log.warn('Rejected API-key attempt to create a workspace', { userId: session.user.id });
      throw new ForbiddenError('Creating a workspace requires a browser session');
    }

    if (!isMultiTenant()) {
      return errorResponse('Workspaces are not available on this install', {
        code: 'WORKSPACES_UNAVAILABLE',
        status: 400,
      });
    }

    const { name } = await validateRequestBody(request, createWorkspaceSchema);

    // Past the cap this throws `WorkspaceLimitError`, a 409 the guard answers.
    const workspace = await createTeamWorkspace({ name, ownerUserId: session.user.id });
    log.info('Workspace created', { orgId: workspace.id, userId: session.user.id });
    return successResponse(workspace, undefined, { status: 201 });
  },
  {
    ownership: {
      decidedBy: 'self',
      because:
        'Counts the caller’s own owner memberships and creates an org whose only member is the caller; no other subject can be named.',
    },
  }
);

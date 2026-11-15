/**
 * Set a workspace's own settings (t-26, D10)
 *
 * PATCH /api/v1/workspaces/[id]/settings — `{ retention }`, where `retention`
 * is `{ days }` (1–3650) to delete content and its assessments that many days
 * after they were made, or `null` to keep them. Answers the settings as
 * written. Judge runs' raw replies go after 30 days whatever this says.
 *
 * This window is the app's (`Org.settings.app.retention`). Core's per-org
 * `retention` slice, set on core's org settings, governs core's own history
 * and is left as it is.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — no `retention`, a window off the range, or a key
 *   this route does not set.
 * - 400 `WORKSPACES_UNAVAILABLE` — `TENANCY_MODE=single`.
 * - 401 `UNAUTHORIZED` — no session.
 * - 403 `FORBIDDEN` — an API key, a `MEMBER`, someone outside the workspace,
 *   or a workspace that does not exist (the policy's one answer).
 * - 404 `NOT_FOUND` — the workspace was deleted between the check and the write.
 *
 * Who may call it is the authorization policy's, through the same org
 * `resource` core's org routes hand the guard: the workspace's `OWNER` or
 * `ADMIN` while acting in it, or a platform admin.
 */
import { withAuth } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { successResponse, errorResponse } from '@/lib/api/responses';
import { ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { orgIdParamSchema } from '@/lib/validations/tenancy';
import { resolveOrgResource } from '@/lib/tenancy/lifecycle';
import { isMultiTenant } from '@/lib/tenancy/context';
import { updateWorkspaceSettingsSchema, writeAppRetention } from '@/lib/app/retention/settings';

const RESOURCE = {
  resource: async (_request: unknown, context?: { params: Promise<{ id: string }> }) =>
    resolveOrgResource(await context?.params),
  ownership: {
    decidedBy: 'resource',
    because:
      "The policy admitted the caller to the workspace the URL names; only that resolved org's settings are written.",
  },
} as const;

export const PATCH = withAuth<{ id: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);

  if (isApiKeySession(session)) {
    throw new ForbiddenError('Changing workspace settings requires a browser session');
  }
  if (!isMultiTenant()) {
    return errorResponse('Workspaces are not available on this install', {
      code: 'WORKSPACES_UNAVAILABLE',
      status: 400,
    });
  }

  const { id } = validateQueryParams(new URLSearchParams(await params), orgIdParamSchema);
  const body = await validateRequestBody(request, updateWorkspaceSettingsSchema);

  const written = await writeAppRetention(id, body.retention);
  if (!written) throw new NotFoundError('Workspace not found');

  log.info('Workspace retention set', {
    orgId: id,
    retentionDays: written.retention?.days ?? null,
    userId: session.user.id,
  });
  return successResponse(written);
}, RESOURCE);

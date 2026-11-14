/**
 * The models a workspace's judges and editor run on (j4, D8)
 *
 * GET /api/v1/workspaces/[id]/judges — each judge and the editor, what it
 * runs on now, whether that follows the default, and the models it may run
 * on: its role's approved list intersected with what the workspace has
 * available (`lib/app/judges/model-choice.ts`). Model names and a
 * plain-language trade-off only; the settings each model runs with are not
 * the workspace's to see or change.
 *
 * Errors:
 * - 400 `WORKSPACES_UNAVAILABLE` — `TENANCY_MODE=single`.
 * - 401 `UNAUTHORIZED` — no session.
 * - 403 `FORBIDDEN` — an API key, a `MEMBER`, someone outside the workspace,
 *   or a workspace that does not exist (the policy's one answer).
 *
 * Who may call it is the authorization policy's, through the org `resource`
 * core's members routes hand the guard: the workspace's `OWNER` or `ADMIN`
 * while acting in it, or a platform admin.
 */
import { withAuth } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { successResponse, errorResponse } from '@/lib/api/responses';
import { ForbiddenError } from '@/lib/api/errors';
import { validateQueryParams } from '@/lib/api/validation';
import { orgIdParamSchema } from '@/lib/validations/tenancy';
import { resolveOrgResource } from '@/lib/tenancy/lifecycle';
import { isMultiTenant } from '@/lib/tenancy/context';
import { listJudgeModels } from '@/lib/app/judges/model-choice';

const RESOURCE = {
  resource: async (_request: unknown, context?: { params: Promise<{ id: string }> }) =>
    resolveOrgResource(await context?.params),
  ownership: {
    decidedBy: 'resource',
    because:
      "The policy admitted the caller to the workspace the URL names; only that resolved org's agents are read.",
  },
} as const;

export const GET = withAuth<{ id: string }>(async (_request, session, { params }) => {
  if (isApiKeySession(session)) {
    throw new ForbiddenError('Choosing judge models requires a browser session');
  }
  if (!isMultiTenant()) {
    return errorResponse('Workspaces are not available on this install', {
      code: 'WORKSPACES_UNAVAILABLE',
      status: 400,
    });
  }
  const { id } = validateQueryParams(new URLSearchParams(await params), orgIdParamSchema);
  return successResponse({ agents: await listJudgeModels(id) });
}, RESOURCE);

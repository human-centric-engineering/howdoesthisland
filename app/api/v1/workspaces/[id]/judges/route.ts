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
 *   a caller acting in another workspace, or a workspace that does not exist.
 *
 * Who may call it is the authorization policy's, through the org `resource`
 * core's members routes hand the guard: the workspace's `OWNER` or `ADMIN`
 * while acting in it, or a platform admin. Either must have entered the
 * workspace: a platform admin acting in another org is refused, and enters
 * this one under its support grant (`lib/app/judges/route-access.ts`).
 */
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { orgIdParamSchema } from '@/lib/validations/tenancy';
import { listJudgeModels } from '@/lib/app/judges/model-choice';
import {
  WORKSPACE_JUDGES_RESOURCE,
  requireEnteredWorkspace,
  refuseJudgesRequest,
} from '@/lib/app/judges/route-access';

export const GET = withAuth<{ id: string }>(async (_request, session, { params }) => {
  const refused = refuseJudgesRequest(session);
  if (refused) return refused;
  const { id } = validateQueryParams(new URLSearchParams(await params), orgIdParamSchema);
  requireEnteredWorkspace(id);
  return successResponse({ agents: await listJudgeModels(id) });
}, WORKSPACE_JUDGES_RESOURCE);

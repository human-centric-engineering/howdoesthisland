/**
 * Choose the model one judge or the editor runs on (j4, D8)
 *
 * PATCH /api/v1/workspaces/[id]/judges/[key] — `{ model }`, where `key` is a
 * judge slot (`judge_ethos`, …) or `editor`, and `model` is one of that
 * agent's options from `GET …/judges`, or `null` to follow the default. A
 * choice makes the binding the workspace's, so the platform no longer moves
 * it; `null` hands it back. Answers the agent as `GET` shows it.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a model off the role's approved list, or one the
 *   workspace does not have available.
 * - 400 `WORKSPACES_UNAVAILABLE` — `TENANCY_MODE=single`.
 * - 401 `UNAUTHORIZED` — no session.
 * - 403 `FORBIDDEN` — an API key, a `MEMBER`, someone outside the workspace,
 *   a caller acting in another workspace, or a workspace that does not exist.
 * - 404 `NOT_FOUND` — no such judge, or the workspace has no agent for it.
 * - 409 `CONFLICT` — the agent changed at the same moment elsewhere.
 *
 * Who may call it: as `GET …/judges`.
 */
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { chooseJudgeModel } from '@/lib/app/judges/model-choice';
import {
  WORKSPACE_JUDGES_RESOURCE,
  requireEnteredWorkspace,
  refuseJudgesRequest,
} from '@/lib/app/judges/route-access';
import { chooseJudgeModelSchema, judgeModelParamsSchema } from '@/lib/app/judges/validations';

export const PATCH = withAuth<{ id: string; key: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const refused = refuseJudgesRequest(session);
  if (refused) return refused;
  const { id, key } = validateQueryParams(
    new URLSearchParams(await params),
    judgeModelParamsSchema
  );
  const body = await validateRequestBody(request, chooseJudgeModelSchema);

  requireEnteredWorkspace(id);
  const choice = await chooseJudgeModel({
    orgId: id,
    key,
    model: body.model,
    userId: session.user.id,
    clientIp: getClientIP(request),
  });
  log.info('Judge model chosen', { orgId: id, key, model: body.model, userId: session.user.id });
  return successResponse(choice);
}, WORKSPACE_JUDGES_RESOURCE);

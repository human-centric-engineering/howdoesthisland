/**
 * Rewrites of the workspace's reviews (t-81, app-plan §4 and §8.2,
 * .context/app/rewrites.md).
 *
 * POST /api/v1/rewrites — the editor rewrites a finished review's text.
 * GET  /api/v1/rewrites?assessmentId= — a review's rewrites, newest first.
 *
 * Authentication: a browser session, or an API key with the `assess` scope.
 * Everything is the workspace the caller acts in.
 *
 * **POST** body (`createRewriteSchema`): `assessmentId`, `focus` (`balanced`,
 * the default, or an appeal: `ethos`, `pathos`, `logos`, `kairos`) and
 * `stream`. The editor reads the review's text, its context and result, and
 * its project's brief (as it is now) and the passages its AI reviewers read.
 *
 * - `stream: false` (the default): 200 with the rewrite once it ends,
 *   `completed` or `failed`.
 * - `stream: true`: Server-Sent Events. `rewrite` (the row, `running`), then
 *   `rewrite_text` for each piece of the draft as it is written, then
 *   `rewrite_done` (the row, `completed` or `failed`), and the stream ends.
 *   A reader that stops listening does not stop the rewrite: it is saved and
 *   charged all the same, and `GET /api/v1/rewrites/{id}` reads it.
 *
 * A rewrite is charged in CopyCredits for what it spent once it ends, as a
 * review is. While it runs, the budget check holds back its estimate.
 *
 * POST errors, before anything is written or spent:
 * - 400 `VALIDATION_ERROR` — the body does not fit, or `focus` is not one the
 *   review's framework has (`details.focus` lists them).
 * - 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (an API key without `assess`).
 * - 402 `INSUFFICIENT_CREDITS` / `BUDGET_EXCEEDED` — as for a review: the
 *   rewrite's estimate (the median of the workspace's last billed rewrites,
 *   failed ones too, `basis: "rewrites"`, or `0` with none, `basis: "none"`) is more
 *   than what is left once reviews and rewrites in flight are held back.
 * - 404 `NOT_FOUND` — no such review in this workspace.
 * - 409 `ASSESSMENT_NOT_REWRITABLE` — the review is not finished (`completed`
 *   or `partial`), or its framework version can no longer be run.
 * - 429 `RATE_LIMIT_EXCEEDED` — over `REWRITES_PER_MINUTE` rewrites per user,
 *   or a burst of requests kept the budget check from its lock.
 *
 * A rewrite that fails once started answers `failed` with `error` and
 * `errorCode` (the editor's: `refused`, `truncated`, `provider_error`,
 * `over_budget`, `rate_limited`, `agent_inactive`, …, or `timed_out` for one
 * that ran past `REWRITE_CALL_MS`), and keeps what it had written.
 *
 * GET errors: 400 `VALIDATION_ERROR` (no `assessmentId`), 401, 403, 404
 * (no such review in this workspace).
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { sseResponse } from '@/lib/api/sse';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { createRateLimitResponse } from '@/lib/security/rate-limit';
import { assessRoute } from '@/lib/app/assessments/api/route-auth';
import { rewriteLimiter } from '@/lib/app/rewrites/limiter';
import { listRewrites, startRewrite } from '@/lib/app/rewrites/service';
import { createRewriteSchema, listRewritesQuerySchema } from '@/lib/app/rewrites/validations';

/**
 * Long enough for the longest rewrite to finish under `after()`: the call
 * stops itself at `REWRITE_CALL_MS` (750s), sized for the editor's largest
 * reply, and this leaves room for its ending write. 800s is the most a
 * serverless host allows (Vercel Pro with fluid compute); a plan with a lower
 * ceiling cuts it off sooner, and recovery ends and charges it then, for what
 * its rows hold.
 */
export const maxDuration = 800;

export const POST = withAuth(async (request: NextRequest, session) => {
  const body = await validateRequestBody(request, createRewriteSchema);
  const limit = rewriteLimiter.check(`user:${session.user.id}`);
  if (!limit.success) return createRateLimitResponse(limit);
  const started = await startRewrite(body, { userId: session.user.id }, request.signal);
  if (body.stream) {
    // The stream closes when the reader goes; the rewrite does not stop.
    return sseResponse(started.events, { signal: request.signal });
  }
  return successResponse(await started.done);
}, assessRoute());

export const GET = withAuth(async (request: NextRequest) => {
  const { assessmentId } = validateQueryParams(
    request.nextUrl.searchParams,
    listRewritesQuerySchema
  );
  return successResponse(await listRewrites(assessmentId));
}, assessRoute());

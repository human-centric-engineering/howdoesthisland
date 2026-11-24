/**
 * The workspace's assessments (t-24, app-plan §4 and §8.2).
 *
 * POST /api/v1/assessments — assess a text, a page or a file.
 * GET  /api/v1/assessments — the workspace's assessments, newest first.
 *
 * Authentication: a browser session, or an API key with the `assess` scope.
 * Everything is the workspace the caller acts in.
 *
 * **POST** body (`createAssessmentSchema`): `source` is one of `{ text }`,
 * `{ url }` (fetched safely, D14) or `{ file: { name, base64 } }`. A
 * `profile` (`quick`, `full` — the default — or a catalogue group) or a
 * `judges` list, `framework`, `version`, `context`, `title`, `wait`, `store`,
 * and `projectId` (t-70): the workspace's project, whose defaults fill what
 * `context` and the profile leave out, and which the review records. A
 * review in a project that calls a judge gives the AI reviewers its brief
 * and passages from its background documents (t-75), and answers them as
 * `contextUsed`: the brief, the documents used (id and title) and the
 * passages, or `null`.
 *
 * - Default: stored and queued; 202 with the assessment. Follow it with
 *   `GET …/{id}` or `GET …/{id}/events`.
 * - `wait: true`: 200 with the result once final, or 202 once the wait bound
 *   (`WAIT_BOUND_MS`) passes; the run carries on.
 * - `store: false`: always synchronous; 200 with the result and `stored:
 *   false`. No text, assessment or judge run is kept: only the cost rows,
 *   marked `ephemeral`.
 *
 * POST errors:
 * - 400 `VALIDATION_ERROR` — the body does not fit the schema (both a profile
 *   and judges; `store: false` with `wait: false`; a malformed URL or base64).
 * - 400 `CONTENT_EMPTY` — no text once trimmed.
 * - 400 `CONTEXT_INVALID` — the context names an id the version lacks.
 * - 400 `PROFILE_UNKNOWN` — no such profile or judge, or one switched off.
 * - 400 `PROJECT_FRAMEWORK_MISMATCH` — `framework` names another framework
 *   than the project's.
 * - 401 `UNAUTHORIZED` — no session or key.
 * - 402 `INSUFFICIENT_CREDITS` — the workspace's CopyCredits, less what its
 *   reviews in flight have spent and are yet to spend, do not cover the
 *   review's estimate, or none are left (t-58, `lib/app/usage/budget.ts`).
 *   No judge started, nothing stored or charged. `details`, in whole credits:
 *   `estimateCredits`, `basis`, `balanceCredits`, `heldCredits`,
 *   `remainingCredits`, `usagePage`. A `quick` profile is never refused this
 *   way. A review that runs is charged for what it spent once it ends.
 * - 402 `BUDGET_EXCEEDED` — checked after the credits: the review's estimated cost is more than what is
 *   left of the workspace's monthly AI budget, or none is left (t-49,
 *   `lib/app/usage/budget.ts`). Stored or not; no judge started, nothing
 *   stored, and the per-user cap is not charged. `details`: `estimateUsd`,
 *   `basis`, `remainingUsd`, `inFlightUsd`, `limitUsd`, `usagePage`. A `quick` profile is
 *   never refused this way.
 * - 403 `FORBIDDEN` — an API key without the `assess` scope.
 * - 404 `FRAMEWORK_NOT_FOUND` / `FRAMEWORK_VERSION_NOT_FOUND`.
 * - 404 `PROJECT_NOT_FOUND` — no such project in this workspace.
 * - 409 `PROJECT_ARCHIVED` — the project is archived; restore it first.
 * - 400 `OVERLAY_INVALID` — the project's weighting (t-72) does not fit this
 *   version's bounds, or it declares none; `details.fromProjectOverlay` is true.
 * - 413 `FILE_TOO_LARGE`, 415 `INVALID_FILE_TYPE` — the file (intake).
 * - 422 `TEXT_TOO_LONG` — over 40,000 characters.
 * - 422 `TOO_MANY_PAGES`, `PDF_HAS_NO_TEXT`, `NO_TEXT`, `FILE_UNREADABLE` — the file.
 * - 422 `URL_NOT_ALLOWED`, `FETCH_FAILED`, `FETCH_TIMEOUT` — the page.
 * - 503 `PROJECT_CONTEXT_UNAVAILABLE` — `store: false` only: the project's
 *   background documents could not be searched (the embedding provider);
 *   no judge was called. A stored review is queued again instead (t-75).
 * - 422 `NOT_SCORABLE` — `store: false` only: the framework could not score
 *   the text (a stored run records it as `failed`). `details.costUsd` is what
 *   the judges had already spent.
 * - 429 `RATE_LIMIT_EXCEEDED` — over `AI_ASSESSMENTS_PER_MINUTE` assessments
 *   that call judges, per user (a `quick` profile is not counted).
 * - 429 `WORKSPACE_BUSY` — `store: false` only: the workspace already has
 *   `RUNNING_PER_WORKSPACE` reviews running or queued, stored or not
 *   (t-28). Queued stored reviews count, so a freed place goes to the queue
 *   first. Carries `Retry-After`, `details.limit` and, when it was counted,
 *   `details.running` and `details.waiting` (stored reviews queued or stalled); no judge started, and the per-user cap is not charged
 *   when the workspace is full on arrival. A quick-profile request is never
 *   refused this way.
 *
 * GET query: `page`, `limit` (≤ 100), `status`, `projectId`. GET errors: 400
 * `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (scope).
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { errorResponse, paginatedResponse, successResponse } from '@/lib/api/responses';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { createRateLimitResponse } from '@/lib/security/rate-limit';
import { aiAssessmentLimiter } from '@/lib/app/assessments/api/limiter';
import { apiKeyIdOf, assessRoute } from '@/lib/app/assessments/api/route-auth';
import {
  createAssessment,
  holdReviewBudget,
  prepareAssessment,
} from '@/lib/app/assessments/api/service';
import {
  createAssessmentSchema,
  listAssessmentsQuerySchema,
} from '@/lib/app/assessments/api/validations';
import { listAssessments } from '@/lib/app/assessments/api/views';
import { RUNNING_PER_WORKSPACE } from '@/lib/app/assessments/limits';
import { assertPlaceFree, WorkspaceBusyError } from '@/lib/app/assessments/places';
import { requireOrgId } from '@/lib/tenancy/context';
import { startWaitingReviews } from '@/lib/app/assessments/kick';

/** Long enough for a run the response did not wait for to finish under `after()`. */
export const maxDuration = 300;

export const POST = withAuth(async (request: NextRequest, session) => {
  const body = await validateRequestBody(request, createAssessmentSchema);
  // A request refused for its version, context, profile or pasted text spent
  // nothing, so it is not counted; one that gets past them is, before
  // anything is fetched. Only one whose judges resolve to some calls a model.
  const prepared = await prepareAssessment(body);
  let created;
  try {
    if (prepared.judges.length > 0) {
      // A `store: false` run with no place free is refused before it is
      // counted, so a caller retrying a busy workspace keeps its allowance.
      if (body.store === false) await assertPlaceFree(requireOrgId());
      const limit = aiAssessmentLimiter.check(`user:${session.user.id}`);
      if (!limit.success) return createRateLimitResponse(limit);
      // Held only now, so a request refused above holds nothing meanwhile.
      await holdReviewBudget(body, prepared);
    }
    created = await createAssessment(
      body,
      prepared,
      { userId: session.user.id, apiKeyId: apiKeyIdOf(session) },
      { signal: request.signal }
    );
  } catch (err) {
    // An APIError cannot carry a header, and this one needs `Retry-After`.
    if (!(err instanceof WorkspaceBusyError)) throw err;
    // Places are free but stored reviews wait for them: start them, in case
    // their own start was lost (throttled per workspace, `kick.ts`).
    if (err.queueCanStart) startWaitingReviews(requireOrgId());
    return errorResponse(err.message, {
      code: 'WORKSPACE_BUSY',
      status: 429,
      details: { ...err.counts, limit: RUNNING_PER_WORKSPACE },
      headers: { 'Retry-After': String(err.retryAfterSeconds) },
    });
  } finally {
    // The budget it held (t-50), however the request ended: failed, or done
    // (a no-op then).
    await prepared.hold?.release();
  }
  const done = created.kind === 'ephemeral' || created.final;
  return successResponse(created.assessment, undefined, { status: done ? 200 : 202 });
}, assessRoute());

export const GET = withAuth(async (request: NextRequest) => {
  const query = validateQueryParams(request.nextUrl.searchParams, listAssessmentsQuerySchema);
  const { items, total } = await listAssessments(query);
  return paginatedResponse(items, { page: query.page, limit: query.limit, total });
}, assessRoute());

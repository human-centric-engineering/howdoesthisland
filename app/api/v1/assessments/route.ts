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
 * `judges` list, `framework`, `version`, `context`, `title`, `wait`, `store`.
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
 * - 401 `UNAUTHORIZED` — no session or key.
 * - 403 `FORBIDDEN` — an API key without the `assess` scope.
 * - 404 `FRAMEWORK_NOT_FOUND` / `FRAMEWORK_VERSION_NOT_FOUND`.
 * - 413 `FILE_TOO_LARGE`, 415 `INVALID_FILE_TYPE` — the file (intake).
 * - 422 `TEXT_TOO_LONG` — over 40,000 characters.
 * - 422 `TOO_MANY_PAGES`, `PDF_HAS_NO_TEXT`, `NO_TEXT`, `FILE_UNREADABLE` — the file.
 * - 422 `URL_NOT_ALLOWED`, `FETCH_FAILED`, `FETCH_TIMEOUT` — the page.
 * - 422 `NOT_SCORABLE` — `store: false` only: the framework could not score
 *   the text (a stored run records it as `failed`). `details.costUsd` is what
 *   the judges had already spent.
 * - 429 `RATE_LIMIT_EXCEEDED` — over `AI_ASSESSMENTS_PER_MINUTE` assessments
 *   that call judges, per user (a `quick` profile is not counted).
 *
 * GET query: `page`, `limit` (≤ 100), `status`. GET errors: 400
 * `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (scope).
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { paginatedResponse, successResponse } from '@/lib/api/responses';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { createRateLimitResponse } from '@/lib/security/rate-limit';
import { aiAssessmentLimiter, callsJudges } from '@/lib/app/assessments/api/limiter';
import { apiKeyIdOf, assessRoute } from '@/lib/app/assessments/api/route-auth';
import { createAssessment } from '@/lib/app/assessments/api/service';
import {
  createAssessmentSchema,
  listAssessmentsQuerySchema,
} from '@/lib/app/assessments/api/validations';
import { listAssessments } from '@/lib/app/assessments/api/views';

/** Long enough for a run the response did not wait for to finish under `after()`. */
export const maxDuration = 300;

export const POST = withAuth(async (request: NextRequest, session) => {
  const body = await validateRequestBody(request, createAssessmentSchema);
  if (callsJudges(body)) {
    const limit = aiAssessmentLimiter.check(`user:${session.user.id}`);
    if (!limit.success) return createRateLimitResponse(limit);
  }
  const created = await createAssessment(body, {
    userId: session.user.id,
    apiKeyId: apiKeyIdOf(session),
  });
  const done = created.kind === 'ephemeral' || created.final;
  return successResponse(created.assessment, undefined, { status: done ? 200 : 202 });
}, assessRoute());

export const GET = withAuth(async (request: NextRequest) => {
  const query = validateQueryParams(request.nextUrl.searchParams, listAssessmentsQuerySchema);
  const { items, total } = await listAssessments(query);
  return paginatedResponse(items, { page: query.page, limit: query.limit, total });
}, assessRoute());

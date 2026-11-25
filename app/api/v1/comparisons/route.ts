/**
 * The workspace's comparisons of drafts (t-87, `.context/app/comparisons.md`).
 *
 * POST /api/v1/comparisons — review 2–5 drafts the same way, to read together.
 * GET  /api/v1/comparisons — the workspace's comparisons, newest first.
 *
 * Authentication: a browser session, or an API key with the `assess` scope.
 * Everything is the workspace the caller acts in.
 *
 * **POST** body (`createComparisonSchema`): `drafts`, 2–5 of `{ text,
 * label? }`, and the review options once, for every draft: `profile` (or a
 * `judges` list), `framework`, `version`, `context` and `projectId`, as a
 * review takes them (`POST /api/v1/assessments`). Each draft becomes an
 * ordinary review, in the workspace's history, titled with its label. 202
 * with the comparison: follow it with `GET …/{id}`, or each draft's review.
 *
 * POST errors: as a review's for its options (400 `VALIDATION_ERROR`,
 * `CONTEXT_INVALID`, `PROFILE_UNKNOWN`, `PROJECT_FRAMEWORK_MISMATCH`,
 * `OVERLAY_INVALID`; 404 `FRAMEWORK_NOT_FOUND`, `FRAMEWORK_VERSION_NOT_FOUND`,
 * `PROJECT_NOT_FOUND`; 409 `PROJECT_ARCHIVED`), and for any draft's text (400
 * `CONTENT_EMPTY`, 422 `TEXT_TOO_LONG`). Fewer than 2 or more than 5 drafts is
 * 400 `VALIDATION_ERROR`. 402 `INSUFFICIENT_CREDITS` / `BUDGET_EXCEEDED` when
 * the workspace cannot cover every draft's estimate together: nothing is
 * stored, and no draft is reviewed. 429 `RATE_LIMIT_EXCEEDED` when the drafts
 * would take the caller past `AI_ASSESSMENTS_PER_MINUTE` reviews that call
 * AI reviewers: each draft counts as one review, and none is counted when the
 * set is refused this way. 401, 403 as every route.
 *
 * GET query: `page`, `limit` (≤ 100), `projectId`. Each item carries its
 * drafts' states and scores, not the per-appeal comparison: that is the
 * comparison's own read. GET errors: 400 `VALIDATION_ERROR`, 401, 403.
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { paginatedResponse, successResponse } from '@/lib/api/responses';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { createRateLimitResponse } from '@/lib/security/rate-limit';
import { aiAssessmentLimiter } from '@/lib/app/assessments/api/limiter';
import { apiKeyIdOf, assessRoute } from '@/lib/app/assessments/api/route-auth';
import {
  createComparison,
  holdComparisonBudget,
  prepareComparison,
  releaseHolds,
} from '@/lib/app/comparisons/service';
import {
  createComparisonSchema,
  listComparisonsQuerySchema,
} from '@/lib/app/comparisons/validations';
import { listComparisons } from '@/lib/app/comparisons/views';

export const POST = withAuth(async (request: NextRequest, session) => {
  const body = await validateRequestBody(request, createComparisonSchema);
  // Refused for its options, a draft's text or the budget: nothing spent,
  // nothing counted.
  const prepared = await prepareComparison(body);
  try {
    if (prepared.judges.length > 0) {
      // Each draft is a review against the per-user cap. Checked for room
      // first, so a set the cap refuses counts none of its drafts.
      const key = `user:${session.user.id}`;
      const room = aiAssessmentLimiter.peek(key);
      if (room.remaining < body.drafts.length) {
        return createRateLimitResponse({ ...room, success: false, remaining: 0 });
      }
      body.drafts.forEach(() => aiAssessmentLimiter.check(key));
      // Held only now, so a request refused above holds nothing meanwhile.
      await holdComparisonBudget(body, prepared);
    }
    const comparison = await createComparison(body, prepared, {
      userId: session.user.id,
      apiKeyId: apiKeyIdOf(session),
    });
    return successResponse(comparison, undefined, { status: 202 });
  } finally {
    // The budget it held, however the request ended (a no-op once stored).
    await releaseHolds(prepared);
  }
}, assessRoute());

export const GET = withAuth(async (request: NextRequest) => {
  const query = validateQueryParams(request.nextUrl.searchParams, listComparisonsQuerySchema);
  const { items, total } = await listComparisons(query);
  return paginatedResponse(items, { page: query.page, limit: query.limit, total });
}, assessRoute());

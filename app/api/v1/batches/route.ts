/**
 * The workspace's batches (t-101, `.context/app/batches.md`).
 *
 * POST /api/v1/batches — review many texts or pages the same way, in one call.
 * GET  /api/v1/batches — the workspace's batches, newest first.
 *
 * Authentication: a browser session, or an API key with the `assess` scope.
 * Everything is the workspace the caller acts in.
 *
 * **POST** body (`createBatchSchema`): `items`, 1 to `APP_BATCH_MAX_ITEMS`
 * (10 unless the install sets it, at most 100) of `{ text, label? }` or
 * `{ url, label? }`, and the review options once, for every item: `profile`
 * (or a `judges` list), `framework`, `version`, `context` and `projectId`,
 * as a review takes them (`POST /api/v1/assessments`). Each item becomes an
 * ordinary review, in the workspace's history, titled with its label (a
 * page untitled is titled by the page). A page is fetched when its own
 * review starts, not in this call: one that cannot be read fails that item
 * alone, with intake's code as its `errorCode`. 202 with the batch: follow it
 * with `GET …/{id}`, or subscribe to `app.batch.finished`.
 *
 * POST errors: as a review's for its options (400 `VALIDATION_ERROR`,
 * `CONTEXT_INVALID`, `PROFILE_UNKNOWN`, `PROJECT_FRAMEWORK_MISMATCH`,
 * `OVERLAY_INVALID`; 404 `FRAMEWORK_NOT_FOUND`, `FRAMEWORK_VERSION_NOT_FOUND`,
 * `PROJECT_NOT_FOUND`; 409 `PROJECT_ARCHIVED`), and for any pasted text (400
 * `CONTENT_EMPTY`, 422 `TEXT_TOO_LONG`, with the item's index in `items` as
 * `details.position`). No items, or more than the cap, is 400
 * `VALIDATION_ERROR`. 402 `INSUFFICIENT_CREDITS` / `BUDGET_EXCEEDED` when the
 * workspace cannot cover every item together: nothing is stored, and no item
 * is reviewed. 429 `RATE_LIMIT_EXCEEDED` when the items would take the caller
 * past `BATCH_ITEMS_PER_HOUR` items: a batch's own allowance, not the
 * per-minute one a single review counts against. Items are counted once the
 * batch is stored, so none is counted when it is refused. 401, 403 as every route.
 *
 * GET query: `page`, `limit` (≤ 100), `projectId`. Each batch carries its
 * counts by state, not its items: that is the batch's own read. GET errors:
 * 400 `VALIDATION_ERROR`, 401, 403.
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { paginatedResponse, successResponse } from '@/lib/api/responses';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { createRateLimitResponse } from '@/lib/security/rate-limit';
import { apiKeyIdOf, assessRoute } from '@/lib/app/assessments/api/route-auth';
import { batchItemLimiter } from '@/lib/app/batches/limiter';
import {
  createBatch,
  holdBatchBudget,
  prepareBatch,
  releaseBatchHolds,
} from '@/lib/app/batches/service';
import { createBatchSchema, listBatchesQuerySchema } from '@/lib/app/batches/validations';
import { listBatches } from '@/lib/app/batches/views';

/** Long enough for the items' runs the response did not wait for, as a comparison's route allows. */
export const maxDuration = 300;

export const POST = withAuth(async (request: NextRequest, session) => {
  const body = await validateRequestBody(request, createBatchSchema);
  // Refused for its options, a text or the budget: nothing spent, nothing counted.
  const prepared = await prepareBatch(body);
  try {
    // Every item is a review against the batch allowance, `quick` ones too:
    // each is still a queued run, and a page a fetch. A batch without room is
    // refused before it holds anything.
    const key = `user:${session.user.id}`;
    const items = body.items.length;
    const refusedByCap = () => {
      const room = batchItemLimiter.peek(key);
      return room.remaining < items
        ? createRateLimitResponse({ ...room, success: false, remaining: 0 })
        : null;
    };
    const early = refusedByCap();
    if (early) return early;
    // Holds nothing for a batch that calls no AI reviewer.
    await holdBatchBudget(body, prepared);
    // Room checked again after the hold, which may have waited on its lock.
    const late = refusedByCap();
    if (late) return late;
    const batch = await createBatch(
      body,
      prepared,
      { userId: session.user.id, apiKeyId: apiKeyIdOf(session) },
      {
        // Counted once stored, so a batch the write refuses (its project
        // archived meanwhile, say) counts none. Two batches checked together
        // can pass the allowance by one of them; it is an allowance.
        onStored: () => {
          for (let i = 0; i < items; i++) batchItemLimiter.check(key);
        },
      }
    );
    return successResponse(batch, undefined, { status: 202 });
  } finally {
    // The budget it held, however the request ended (a no-op once stored).
    await releaseBatchHolds(prepared);
  }
}, assessRoute());

export const GET = withAuth(async (request: NextRequest) => {
  const query = validateQueryParams(request.nextUrl.searchParams, listBatchesQuerySchema);
  const { items, total } = await listBatches(query);
  return paginatedResponse(items, { page: query.page, limit: query.limit, total });
}, assessRoute());

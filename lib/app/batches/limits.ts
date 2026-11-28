/**
 * A batch's limits (t-101, `.context/app/batches.md`), apart from its route
 * schemas. Server-side: the item cap is read from the environment.
 */
import { env } from '@/lib/env';

/** The most items a batch takes when `APP_BATCH_MAX_ITEMS` is unset. */
export const DEFAULT_BATCH_MAX_ITEMS = 10;

/** The most `APP_BATCH_MAX_ITEMS` may be set to: every item is a review held in one request. */
export const BATCH_MAX_ITEMS_CEILING = 100;

/**
 * The most items one batch takes: `APP_BATCH_MAX_ITEMS`, 10 when unset (the
 * env schema keeps it from 1 to {@link BATCH_MAX_ITEMS_CEILING}). Read per
 * call, not at module load, so a test can set it.
 */
export function batchMaxItems(): number {
  return env.APP_BATCH_MAX_ITEMS ?? DEFAULT_BATCH_MAX_ITEMS;
}

/** What a caller calls an item ("Pricing page"); shown beside its scores. */
export const ITEM_LABEL_MAX = 80;

/**
 * Items per user per hour, across every batch. A `quick` batch's items count
 * too: none calls a model, but each is still a queued run, and a page is a
 * fetch the server makes on the caller's behalf. A batch's own allowance,
 * in place of the per-minute one a single review or a comparison's drafts
 * count against (`AI_ASSESSMENTS_PER_MINUTE`, 10): that one would refuse any
 * batch over 10 items, and counting a batch as one request would let a
 * runaway script queue thousands of reviews an hour. Sized to what a
 * workspace works through, three at a time (`RUNNING_PER_WORKSPACE`): two
 * full batches of 100 an hour. The budget and credit check bounds the spend
 * itself; this bounds how fast one person can queue work and fetches.
 */
export const BATCH_ITEMS_PER_HOUR = 200;

/**
 * How long an upload waits for a batch to take it (t-102): 24 hours. Past it,
 * it cannot be claimed (`claimUpload` in `lib/app/assessments/enqueue.ts`)
 * and the hourly job deletes it (`lib/app/batches/uploads.ts`). No longer than
 * the shortest retention window (1 day, `lib/app/retention/settings.ts`), so a
 * claimable upload is never one the retention purge would take.
 */
export const UPLOAD_CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Uploads per user per hour (t-102, `POST /api/v1/contents`): as many as
 * {@link BATCH_ITEMS_PER_HOUR}, since an upload is only of use as a batch
 * item. Each reads a file of up to 10 MB in the request and extracts its
 * text, the work this bounds: a caller with no room left is refused before
 * the body is read. The `/api/v1` section cap alone would allow 6,000 an hour.
 */
export const UPLOADS_PER_HOUR = BATCH_ITEMS_PER_HOUR;

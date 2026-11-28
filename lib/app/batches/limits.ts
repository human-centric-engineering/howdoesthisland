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

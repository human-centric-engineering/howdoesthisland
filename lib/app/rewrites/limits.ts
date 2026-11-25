/**
 * Rewrites' limits (t-81, .context/app/rewrites.md).
 */

/**
 * Rewrites per user per minute, across every way in: a per-flow sub-cap under
 * the proxy's section cap, because each one spends money, as a review that
 * calls judges is (`AI_ASSESSMENTS_PER_MINUTE`). A rewrite is one call, so
 * the same number.
 */
export const REWRITES_PER_MINUTE = 10;

/**
 * How often a running rewrite saves what it has written and renews its
 * lease. A reader that lost the stream (`GET …/{id}`) sees the draft at most
 * this stale; the lease outlasts several saves (`LEASE_MS`).
 */
export const DRAFT_SAVE_MS = 5_000;

/** Where the editor's role is named in its rewrite's cost rows. */
export const REWRITE_COST_TAG = 'rewrite';

/**
 * How old a rewrite must be before recovery ends it (t-85): the route's
 * `maxDuration` (`app/api/v1/rewrites/route.ts`, in seconds there; a test
 * holds them equal). A serverless host cuts the call off there, and it is
 * sized to hold the editor's longest timeout, so a rewrite recovery prices
 * from its saved draft is one whose call has stopped. A call that somehow
 * outlives it and then ends writes its own cost row after the estimate:
 * the monthly cap counts both, the charge only the first (one reference).
 */
export const REWRITE_LIFETIME_MS = 360_000;

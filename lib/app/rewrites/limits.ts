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
 * How old a rewrite must be before recovery prices and ends one that kept
 * its call (t-85): the route's `maxDuration` (`app/api/v1/rewrites/route.ts`,
 * in seconds there; a test holds them equal). The call stops itself before
 * then ({@link REWRITE_CALL_MS}), on any host, so a rewrite recovery prices
 * from its saved draft is one whose call has stopped and will write no cost
 * row of its own after the estimate.
 */
export const REWRITE_LIFETIME_MS = 360_000;

/**
 * How long after its row is written a rewrite's call is stopped, if it is
 * still running (`service.ts`). Nothing else bounds a stream on a
 * long-running server: the provider's timeout covers the connection, not the
 * whole reply. Stopped, the call writes its own cost row (an estimate, as
 * any stopped call's) and ends its rewrite. It leaves
 * {@link REWRITE_LIFETIME_MS} room for that before recovery may price it.
 * Sized past the editor's longest timeout (300s) and the budget lock's wait
 * (10s), so only a call that would have been cut off is stopped.
 */
export const REWRITE_CALL_MS = 330_000;

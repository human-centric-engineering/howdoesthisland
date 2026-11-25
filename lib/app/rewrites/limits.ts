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

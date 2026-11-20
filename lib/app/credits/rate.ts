/**
 * What a CopyCredit is worth (t-57, f-credits). Client-safe: no server imports.
 *
 * CopyCredits are this app's own unit, so a price list can later say what
 * things cost in terms people understand, and Sunrise billing can sell them
 * once it exists. Owner ruling at planning, 2026-11-20 (the decision that
 * supersedes D6): **to begin with, 100 credits ≈ $1 of LLM tokens.**
 *
 * Every conversion between dollars and credits goes through this file. When
 * the price list arrives it replaces {@link creditsForUsd}; nothing that
 * charges or checks credits computes a price of its own.
 */

/** Credits per US dollar of recorded AI cost. */
export const CREDITS_PER_USD = 100;

/**
 * What `usd` of AI cost costs in credits: rounded up to a whole credit, so a
 * charge never rounds a real cost to nothing. The small epsilon stops a float
 * a hair over a whole number (`0.07 * 100 = 7.000000000000001`) costing a
 * credit more than it should.
 */
export function creditsForUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.ceil(usd * CREDITS_PER_USD - 1e-9);
}

/** What `credits` are worth in dollars, for comparing a balance with a cap. */
export function usdForCredits(credits: number): number {
  return credits / CREDITS_PER_USD;
}

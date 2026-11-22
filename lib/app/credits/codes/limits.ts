/**
 * How often a code may be tried (t-60). Client-safe numbers, read by the
 * proxy rule (`lib/app/rate-limit.ts`), the handler's per-person cap
 * (`./limiter.ts`) and the docs.
 *
 * A code is about 59 bits, so no rate here makes guessing one feasible; the
 * caps stop a script hammering the lookup, not a person at a door. Per IP is
 * the looser of the two because a QR card is handed out at events, where a
 * room of people scanning together share one address, and one person's way
 * through takes several requests (the page, a check, the page again after
 * sign-up, the redemption). At 120 a minute, twenty or more people behind one
 * address get through in a minute.
 */

/**
 * Checks and redemptions per IP a minute: the `/redeem` page given a code and
 * both code routes, together. A page load with no code is not counted (t-66).
 */
export const CODE_ATTEMPTS_PER_MINUTE_PER_IP = 120;

/** Redemptions per person a minute, across their sessions and keys. */
export const REDEEM_ATTEMPTS_PER_MINUTE_PER_USER = 10;

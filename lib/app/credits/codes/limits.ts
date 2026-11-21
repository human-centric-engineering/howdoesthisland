/**
 * How often a code may be tried (t-60). Client-safe numbers, read by the
 * proxy rule (`lib/app/rate-limit.ts`), the handler's per-person cap
 * (`./limiter.ts`) and the docs.
 *
 * A code is about 59 bits, so no rate here makes guessing one feasible; the
 * caps stop a script hammering the lookup, not a person at a door. Per IP is
 * the looser of the two because a QR card is handed out at events, where a
 * room of people scanning together share one address.
 */

/** Checks and redemptions per IP a minute: the `/redeem` page and both code routes, together. */
export const CODE_ATTEMPTS_PER_MINUTE_PER_IP = 30;

/** Redemptions per person a minute, across their sessions and keys. */
export const REDEEM_ATTEMPTS_PER_MINUTE_PER_USER = 10;

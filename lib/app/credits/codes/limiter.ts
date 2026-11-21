/**
 * The per-person cap on redemption attempts (t-60).
 *
 * The proxy's `redeem` rule (`lib/app/rate-limit.ts`) caps attempts per IP;
 * this caps them per person, keyed on the user so their sessions and keys
 * share one allowance. A handler-level limiter, as CLAUDE.md allows for a
 * sub-flow: the proxy keys its rule on one thing.
 */
import { SECURITY_CONSTANTS } from '@/lib/security/constants';
import { createRateLimiter } from '@/lib/security/rate-limit';
import { REDEEM_ATTEMPTS_PER_MINUTE_PER_USER } from '@/lib/app/credits/codes/limits';

export const redeemLimiter = createRateLimiter({
  interval: 60_000,
  maxRequests: REDEEM_ATTEMPTS_PER_MINUTE_PER_USER,
  uniqueTokenPerInterval: SECURITY_CONSTANTS.RATE_LIMIT.MAX_UNIQUE_TOKENS,
});

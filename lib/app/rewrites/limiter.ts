/**
 * The per-user sub-cap on rewrites (t-81): a handler-level limiter, as
 * CLAUDE.md allows for an expensive sub-flow, keyed on the user as the
 * assessments' is (`lib/app/assessments/api/limiter.ts`).
 */
import { SECURITY_CONSTANTS } from '@/lib/security/constants';
import { createRateLimiter } from '@/lib/security/rate-limit';
import { REWRITES_PER_MINUTE } from '@/lib/app/rewrites/limits';

export const rewriteLimiter = createRateLimiter({
  interval: 60_000,
  maxRequests: REWRITES_PER_MINUTE,
  uniqueTokenPerInterval: SECURITY_CONSTANTS.RATE_LIMIT.MAX_UNIQUE_TOKENS,
});

/**
 * The per-user cap on batch items that call AI reviewers (t-101):
 * {@link BATCH_ITEMS_PER_HOUR}, keyed on the user, as the per-minute review
 * cap is (`lib/app/assessments/api/limiter.ts`). A handler-level limiter, as
 * CLAUDE.md allows for an expensive sub-flow.
 */
import { SECURITY_CONSTANTS } from '@/lib/security/constants';
import { createRateLimiter } from '@/lib/security/rate-limit';
import { BATCH_ITEMS_PER_HOUR } from '@/lib/app/batches/limits';

export const batchItemLimiter = createRateLimiter({
  interval: 60 * 60_000,
  maxRequests: BATCH_ITEMS_PER_HOUR,
  uniqueTokenPerInterval: SECURITY_CONSTANTS.RATE_LIMIT.MAX_UNIQUE_TOKENS,
});

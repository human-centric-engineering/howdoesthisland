/**
 * The per-user caps on batch items, {@link BATCH_ITEMS_PER_HOUR} (t-101),
 * and on the uploads they name, {@link UPLOADS_PER_HOUR} (t-102): each keyed
 * on the user, as the per-minute review cap is
 * (`lib/app/assessments/api/limiter.ts`). Handler-level limiters, as
 * CLAUDE.md allows for an expensive sub-flow.
 */
import { SECURITY_CONSTANTS } from '@/lib/security/constants';
import { createRateLimiter } from '@/lib/security/rate-limit';
import { BATCH_ITEMS_PER_HOUR, UPLOADS_PER_HOUR } from '@/lib/app/batches/limits';

export const batchItemLimiter = createRateLimiter({
  interval: 60 * 60_000,
  maxRequests: BATCH_ITEMS_PER_HOUR,
  uniqueTokenPerInterval: SECURITY_CONSTANTS.RATE_LIMIT.MAX_UNIQUE_TOKENS,
});

/** {@link UPLOADS_PER_HOUR}, keyed on the user. */
export const uploadLimiter = createRateLimiter({
  interval: 60 * 60_000,
  maxRequests: UPLOADS_PER_HOUR,
  uniqueTokenPerInterval: SECURITY_CONSTANTS.RATE_LIMIT.MAX_UNIQUE_TOKENS,
});

/**
 * The per-caller cap on PDF renders (t-31).
 *
 * The route's section cap (`proxy.ts`, 100/min) is far more than a render can
 * stand: each is a whole headless browser. Only renders count, not cache
 * hits, so downloading a report that has been made stays as cheap as any read.
 */
import { SECURITY_CONSTANTS } from '@/lib/security/constants';
import { createRateLimiter } from '@/lib/security/rate-limit';

/** Renders one caller may start per minute. */
export const PDF_RENDERS_PER_MINUTE = 10;

export const reportPdfLimiter = createRateLimiter({
  interval: 60_000,
  maxRequests: PDF_RENDERS_PER_MINUTE,
  uniqueTokenPerInterval: SECURITY_CONSTANTS.RATE_LIMIT.MAX_UNIQUE_TOKENS,
});

/**
 * The per-user sub-cap on adding project documents (t-74).
 *
 * The proxy's `/api/v1/**` section cap counts requests; each add also reads a
 * file or fetches a page and embeds its text, which is spend. A
 * handler-level limiter, as CLAUDE.md allows for an expensive sub-flow (an
 * upload), keyed on the user so a person's keys and sessions share one
 * allowance.
 */
import { SECURITY_CONSTANTS } from '@/lib/security/constants';
import { createRateLimiter } from '@/lib/security/rate-limit';

/** Adds one person may make in {@link DOCUMENT_ADD_INTERVAL_MS}. */
export const DOCUMENT_ADDS_PER_INTERVAL = 20;

/** Ten minutes. */
export const DOCUMENT_ADD_INTERVAL_MS = 10 * 60 * 1000;

export const documentAddLimiter = createRateLimiter({
  interval: DOCUMENT_ADD_INTERVAL_MS,
  maxRequests: DOCUMENT_ADDS_PER_INTERVAL,
  uniqueTokenPerInterval: SECURITY_CONSTANTS.RATE_LIMIT.MAX_UNIQUE_TOKENS,
});

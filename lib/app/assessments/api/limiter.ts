/**
 * The per-user sub-cap on assessments that call judges (t-24).
 *
 * The proxy's `/api/v1/**` section cap counts requests; this counts spend.
 * A handler-level limiter, as CLAUDE.md allows for an expensive sub-flow,
 * keyed on the user so a person's keys and sessions share one allowance.
 * The number is a constant until f-usage.
 */
import { SECURITY_CONSTANTS } from '@/lib/security/constants';
import { createRateLimiter } from '@/lib/security/rate-limit';
import { AI_ASSESSMENTS_PER_MINUTE } from '@/lib/app/assessments/limits';
import type { CreateAssessmentBody } from '@/lib/app/assessments/api/validations';

export const aiAssessmentLimiter = createRateLimiter({
  interval: 60_000,
  maxRequests: AI_ASSESSMENTS_PER_MINUTE,
  uniqueTokenPerInterval: SECURITY_CONSTANTS.RATE_LIMIT.MAX_UNIQUE_TOKENS,
});

/**
 * Whether a request will call judges. Only the `quick` profile calls none;
 * an explicit list has at least one. Decided from the body, and checked
 * once the version, context and profile have passed (`prepareAssessment`),
 * so a request over the cap is refused before anything is fetched.
 */
export const callsJudges = (body: CreateAssessmentBody): boolean =>
  body.judges !== undefined || (body.profile ?? 'full') !== 'quick';

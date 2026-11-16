/**
 * App rate-limit registrations.
 *
 * **Fork-owned scaffold** — Sunrise ships this empty and does NOT change it
 * after release, so your edits here merge cleanly on upgrade (the stable
 * contract is this file's export, not its body). Treat it like the landing
 * page: a starting point you're expected to modify.
 *
 * Auto-wired: the rate-limit middleware imports and calls this once at module
 * load (middleware runtime). Add `registerRateLimitTier()` /
 * `registerRateLimitKeyResolver()` / `registerRateLimitRule()` calls —
 * registration is namespace-scoped and fails fast (it throws if a rule could
 * shadow a Sunrise-protected surface, or names a custom key whose resolver
 * hasn't been registered yet — resolvers first, then rules).
 *
 * Full guide + example: CUSTOMIZATION.md §4 · .context/security/rate-limiting.md
 *
 * HowDoesThisLand (t-24): the free quick scan (`POST /api/v1/scan`, D7) is
 * anonymous, so the section cap's session-user key would fall back to IP at
 * the section's 100/min. It gets its own tier, keyed on IP for everyone,
 * signed in or not, at `SCANS_PER_MINUTE`.
 *
 * t-32: a share link (`/r/{token}` and `GET /api/v1/shared-reports/{token}`)
 * is opened by people with no account, so it too is keyed on IP, at
 * `SHARED_REPORT_VIEWS_PER_MINUTE`. With no session the section cap would
 * key on IP anyway, but at 100/min, which is a guessing rate this does not
 * need to allow; the page is matched too, since it reads the same row.
 */
import { SECURITY_CONSTANTS } from '@/lib/security/constants';
import { createRateLimiter, registerRateLimitTier } from '@/lib/security/rate-limit';
import { registerRateLimitRule, type RateLimitRule } from '@/lib/security/rate-limit-policy';
import { SCANS_PER_MINUTE } from '@/lib/app/assessments/limits';
import { SHARED_REPORT_VIEWS_PER_MINUTE } from '@/lib/app/reports/share/limits';

/** The tier and the path it covers, for the tests. */
export const SCAN_TIER = 'scan';
export const SCAN_PATH = /^\/api\/v1\/scan\/?$/;

// Module scope, not inside the function: a tier is registered once per name
// and the function may be called again (tests, a hot reload), and the
// registry refuses a second limiter under one name.
const scanLimiter = createRateLimiter({
  interval: 60_000,
  maxRequests: SCANS_PER_MINUTE,
  uniqueTokenPerInterval: SECURITY_CONSTANTS.RATE_LIMIT.MAX_UNIQUE_TOKENS,
});

// The rule too: the registry dedupes rules by reference, so a fresh literal
// on each call would add another copy.
const scanRule: RateLimitRule = { match: SCAN_PATH, tier: SCAN_TIER, key: 'ip' };

/** The share-link tier and the paths it covers: the page, and its API. */
export const SHARED_REPORT_TIER = 'shared-report';
export const SHARED_REPORT_PATH = /^\/(r|api\/v1\/shared-reports)\/[^/]+\/?$/;

const sharedReportLimiter = createRateLimiter({
  interval: 60_000,
  maxRequests: SHARED_REPORT_VIEWS_PER_MINUTE,
  uniqueTokenPerInterval: SECURITY_CONSTANTS.RATE_LIMIT.MAX_UNIQUE_TOKENS,
});

const sharedReportRule: RateLimitRule = {
  match: SHARED_REPORT_PATH,
  tier: SHARED_REPORT_TIER,
  key: 'ip',
};

export function registerAppRateLimits(): void {
  registerRateLimitTier(SCAN_TIER, scanLimiter);
  registerRateLimitRule(scanRule);
  registerRateLimitTier(SHARED_REPORT_TIER, sharedReportLimiter);
  registerRateLimitRule(sharedReportRule);
}

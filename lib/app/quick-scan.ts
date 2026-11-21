/**
 * The quick-scan switch, and who may run the quick scan (t-61).
 *
 * The owner may launch without the quick scan, so everything that offers it
 * sits behind one switch: `QUICK_SCAN_ENABLED`, on by default outside
 * production and off in production, as the culture switch is
 * (`lib/app/frameworks/culture.ts`). It covers `POST /api/v1/scan` (absent
 * from the API, its OpenAPI document and `/developers` while off), the
 * landing page's live self-score, and the "quick scan first" step on
 * `/assess`. It does **not** cover the engine's fallback when a judge fails,
 * calibration's quick mode, or the `quick` profile of `POST assessments`,
 * which a workspace member runs with their own account.
 *
 * With it on, the route takes a browser session, an API key with the
 * `assess` scope, or a free review code that could still be redeemed. The
 * code is checked, never consumed: running the quick scan does not use up
 * one of its redemptions.
 *
 * Read per call, not at module load, so a test can flip it.
 */
import type { NextRequest } from 'next/server';
import { APIError, ForbiddenError } from '@/lib/api/errors';
import { resolveApiKey } from '@/lib/auth/api-keys';
import { hasScope } from '@/lib/auth/api-key-scopes';
import { getServerSession } from '@/lib/auth/utils';
import { ASSESS_SCOPE } from '@/lib/app/assessments/api/route-auth';
import { checkCode } from '@/lib/app/credits/codes/redeem';
import { env } from '@/lib/env';

export function isQuickScanEnabled(): boolean {
  return env.QUICK_SCAN_ENABLED ?? env.NODE_ENV !== 'production';
}

/** How a quick-scan caller was let in. */
export type QuickScanAccess = 'api-key' | 'session' | 'code';

/** The refusal for a caller with no account, no key and no code that could be redeemed. */
export class QuickScanAccountRequiredError extends APIError {
  constructor() {
    super(
      'The quick scan needs an account, an API key with the assess scope, or a free review code that has not expired or run out.',
      'ACCOUNT_REQUIRED',
      401
    );
    this.name = 'QuickScanAccountRequiredError';
  }
}

/**
 * Let a quick-scan caller in, or refuse them. An API key is checked first,
 * as the guards check one: a key without the `assess` scope is refused 403,
 * whatever else the request carries. Then a browser session, then `code`.
 * A code is admitted only while it could still be redeemed, and every other
 * answer (unknown, expired, revoked, used up) is the same 401, so the route
 * says no more about a code than `POST /api/v1/codes/check` does.
 */
export async function admitQuickScan(
  request: NextRequest,
  code: string | undefined
): Promise<QuickScanAccess> {
  const apiKey = await resolveApiKey(request);
  if (apiKey) {
    if (!hasScope(apiKey.scopes, ASSESS_SCOPE)) {
      throw new ForbiddenError(`API key scope '${ASSESS_SCOPE}' required`);
    }
    return 'api-key';
  }
  if (await getServerSession()) return 'session';
  if (code !== undefined && (await checkCode(code)).status === 'active') return 'code';
  throw new QuickScanAccountRequiredError();
}

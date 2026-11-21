/**
 * The quick-scan switch, and who may run the quick scan (t-61).
 *
 * The owner may launch without the quick scan, so it sits behind one switch:
 * `QUICK_SCAN_ENABLED`, on by default outside production and off in
 * production, as the culture switch is (`lib/app/frameworks/culture.ts`).
 * Off, `POST /api/v1/scan` answers 404 and is absent from its OpenAPI
 * document and `/developers`. A page that later offers the quick scan checks
 * it too. It does **not** cover the engine's fallback when a judge fails,
 * calibration's quick mode, or the `quick` profile of `POST assessments`,
 * which a workspace member runs with their own account.
 *
 * With it on, the route takes a browser session or an API key with the
 * `assess` scope, through `withAuth` like every other guarded route, or a
 * free review code that could still be redeemed. The code is checked, never
 * consumed: running the quick scan does not use up one of its redemptions.
 *
 * Read per call, not at module load, so a test can flip it.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { APIError } from '@/lib/api/errors';
import { API_KEY_PREFIX } from '@/lib/auth/api-keys';
import { getServerSession } from '@/lib/auth/utils';
import { checkCode } from '@/lib/app/credits/codes/redeem';
import { MAX_TYPED_CODE } from '@/lib/app/credits/codes/wire';
import { env } from '@/lib/env';

export function isQuickScanEnabled(): boolean {
  return env.QUICK_SCAN_ENABLED ?? env.NODE_ENV !== 'production';
}

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
 * Whether the caller presents an account: an API key in the `Authorization`
 * header, or a browser session. Such a caller goes through `withAuth`, which
 * decides whether the key or session may act (its scope, its workspace).
 * A key is recognised by its header, not looked up, so the guard looks it up
 * once; a key the guard then refuses is refused, whatever code the body holds.
 */
export async function presentsAccount(request: NextRequest): Promise<boolean> {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith(`Bearer ${API_KEY_PREFIX}`)) return true;
  return (await getServerSession()) !== null;
}

const codeOnly = z.object({ code: z.string().max(MAX_TYPED_CODE) });

/**
 * Let a caller with no account in on the `code` in their body, or refuse
 * them, before the rest of the body is checked. A code is admitted only while
 * it could still be redeemed, and every other answer (missing, malformed,
 * unknown, expired, revoked, used up) is the same 401, so the route says no
 * more about a code than `POST /api/v1/codes/check` does.
 */
export async function admitWithCode(body: unknown): Promise<void> {
  const parsed = codeOnly.safeParse(body);
  if (parsed.success && (await checkCode(parsed.data.code)).status === 'active') return;
  throw new QuickScanAccountRequiredError();
}

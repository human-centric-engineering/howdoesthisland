/**
 * Who may run the quick scan (t-61), once its switch (`./switch.ts`) is on.
 *
 * The route takes a browser session or an API key with the `assess` scope,
 * through `withAuth` like every other guarded route, or a free review code
 * that could still be redeemed. The code is checked, never consumed: running
 * the quick scan does not use up one of its redemptions.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { APIError } from '@/lib/api/errors';
import { API_KEY_PREFIX } from '@/lib/auth/api-keys';
import { auth } from '@/lib/auth/config';
import { checkCode } from '@/lib/app/credits/codes/redeem';
import { MAX_TYPED_CODE } from '@/lib/app/credits/codes/wire';

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
 * The session is asked of better-auth directly, not through
 * `getServerSession()`, which answers a failed lookup as "no session": a
 * member whose lookup fails gets the 500, not the code path's 401. The guard
 * then looks the session up again: a second read, accepted because
 * better-auth's cookie cache (`lib/auth/config.ts`, five minutes) answers it
 * without the database, and `withAuth` takes no session from outside.
 */
export async function presentsAccount(request: NextRequest): Promise<boolean> {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith(`Bearer ${API_KEY_PREFIX}`)) return true;
  return (await auth.api.getSession({ headers: request.headers })) !== null;
}

const codeOnly = z.object({ code: z.string().max(MAX_TYPED_CODE) });

/**
 * Let a caller with no account in on the `code` in their body, or refuse
 * them, once the JSON is parsed and before the rest of the body is checked. A code is admitted only while
 * it could still be redeemed, and every other answer (missing, malformed,
 * unknown, expired, revoked, used up) is the same 401, so the route says no
 * more about a code than `POST /api/v1/codes/check` does.
 */
export async function admitWithCode(body: unknown): Promise<void> {
  const parsed = codeOnly.safeParse(body);
  if (parsed.success && (await checkCode(parsed.data.code)).status === 'active') return;
  throw new QuickScanAccountRequiredError();
}

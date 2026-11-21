/**
 * POST /api/v1/codes/check — what a free review code would give (t-60).
 *
 * Anyone may call it, signed in or not: someone holding a code checks it
 * before they have an account. Nothing is written. The code is in the body,
 * not the URL, so it is never in a logged path.
 *
 * Body: `{ code }`, as typed: any case, with or without dashes or spaces.
 * Answers 200 with `status`: `active` (with `credits` and `expiresAt`),
 * `expired` (with `expiresAt`), `used-up`, `revoked`, or `unknown` for
 * anything malformed or not found, alike.
 *
 * Rate limiting: `CODE_ATTEMPTS_PER_MINUTE_PER_IP` per IP, by the `redeem`
 * rule in `lib/app/rate-limit.ts`, shared with the page and redeeming.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a body that is not JSON or does not fit the schema.
 * - 429 `RATE_LIMIT_EXCEEDED` — over the per-IP cap.
 */
import type { NextRequest } from 'next/server';
import { handleAPIError } from '@/lib/api/errors';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { checkCode } from '@/lib/app/credits/codes/redeem';
import { typedCodeSchema } from '@/lib/app/credits/codes/wire';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { code } = await validateRequestBody(request, typedCodeSchema);
    // Whether the caller redeemed it is the page's to say, for a signed-in
    // person; the public answer is about the code alone.
    const { alreadyRedeemed: _mine, ...check } = await checkCode(code);
    return successResponse(check);
  } catch (error) {
    return handleAPIError(error);
  }
}

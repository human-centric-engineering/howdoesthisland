/**
 * POST /api/v1/codes/redeem — redeem a free review code (t-60).
 *
 * Adds the code's CopyCredits to the workspace the caller acts in, as a
 * `REDEEM` credit entry referencing the redemption. Atomic: however many
 * redeem a code at once, it is never redeemed more than its maximum, and the
 * redemption and its credits are written together (`lib/app/credits/codes/redeem.ts`).
 * Once per person per code.
 *
 * Authentication: a browser session, or an API key with the `assess` scope
 * (a read-only `reports` key cannot add credits).
 *
 * Body: `{ code }`, as typed. Answers 200 with the redemption: the credits
 * it gave, the workspace's balance after it, and the workspace.
 *
 * Rate limiting: `CODE_ATTEMPTS_PER_MINUTE_PER_IP` per IP (the `redeem` rule
 * in `lib/app/rate-limit.ts`) and `REDEEM_ATTEMPTS_PER_MINUTE_PER_USER` per
 * person, every attempt counted.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a body that does not fit the schema.
 * - 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (a key without the `assess` scope).
 * - 404 `CODE_UNKNOWN` — malformed or not found, alike.
 * - 404 `NOT_FOUND` — the workspace is not active.
 * - 409 `CODE_ALREADY_REDEEMED` — this person has redeemed this code.
 * - 410 `CODE_EXPIRED`, `CODE_USED_UP`, `CODE_REVOKED`.
 * - 429 `RATE_LIMIT_EXCEEDED` — over either cap.
 *
 * Many redeeming one code at once never turns one away while uses are left:
 * a place lost to another redemption is tried again (`redeemCode`).
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { createRateLimitResponse } from '@/lib/security/rate-limit';
import { requireOrgId } from '@/lib/tenancy/context';
import { ASSESS_SCOPE } from '@/lib/app/assessments/api/route-auth';
import { redeemLimiter } from '@/lib/app/credits/codes/limiter';
import { redeemCode } from '@/lib/app/credits/codes/redeem';
import { typedCodeSchema } from '@/lib/app/credits/codes/wire';

export const POST = withAuth(
  async (request: NextRequest, session) => {
    const limit = redeemLimiter.check(`user:${session.user.id}`);
    if (!limit.success) return createRateLimitResponse(limit);
    const { code } = await validateRequestBody(request, typedCodeSchema);
    return successResponse(
      await redeemCode(code, { orgId: requireOrgId(), userId: session.user.id })
    );
  },
  {
    scope: ASSESS_SCOPE,
    ownership: {
      decidedBy: 'nothing',
      because:
        'The credits are the workspace’s, credited to the org the guard entered; a code is install-level config owned by no one, and the redemption records who redeemed it.',
    },
  }
);

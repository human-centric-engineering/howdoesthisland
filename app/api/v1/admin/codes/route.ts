/**
 * /api/v1/admin/codes — free review codes (t-59).
 *
 * GET lists codes, newest first, each with its redeem link, what is used and
 * left of it, and its status. `?q=` narrows by campaign or code; at most 200,
 * with `truncated` when more match.
 *
 * POST mints `count` codes alike: credits per redemption, maximum
 * redemptions (1 for a personal code, N for a QR card), expiry and campaign.
 * With `idempotencyKey`, a retried call mints once: the same key and body
 * answer 200 with the first call's codes (`replayed: true`); a new mint is
 * 201. Shaped so ConQuest can later mint a code for a qualified lead.
 *
 * Authentication: a platform admin (session, or an `admin` API key).
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a body or `q` outside the schema.
 * - 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (not a platform admin, or at `multi`
 *   a session in a workspace other than the install org).
 * - 409 `CONFLICT` — the idempotency key was used for a different request.
 */
import type { NextRequest } from 'next/server';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { withAdminAuth } from '@/lib/auth/guards';
import { issueCodes, listCodes } from '@/lib/app/credits/codes/service';
import { CODES_OWNERSHIP } from '@/lib/app/credits/codes/route-auth';
import { adminCodesQuerySchema, issueCodesSchema } from '@/lib/app/credits/codes/wire';

export const GET = withAdminAuth(async (request: NextRequest) => {
  const { q } = validateQueryParams(new URL(request.url).searchParams, adminCodesQuerySchema);
  return successResponse(await listCodes(q || undefined));
}, CODES_OWNERSHIP);

export const POST = withAdminAuth(
  async (request: NextRequest, session) => {
    const input = await validateRequestBody(request, issueCodesSchema);
    const result = await issueCodes(input, session.user.id);
    return successResponse(result, undefined, { status: result.replayed ? 200 : 201 });
  },
  { ...CODES_OWNERSHIP, writesSharedSettings: true }
);

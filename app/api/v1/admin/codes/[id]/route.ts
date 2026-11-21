/**
 * DELETE /api/v1/admin/codes/{id} — revoke a free review code (t-59).
 *
 * Sets `revokedAt`: the code can no longer be redeemed, and credits it
 * already gave stay given. The row is kept, so the list still shows it.
 * Revoking a revoked code changes nothing. Answers with the code as it now is.
 *
 * Authentication: a platform admin (session, or an `admin` API key).
 *
 * Errors:
 * - 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (not a platform admin, or at `multi`
 *   a session in a workspace other than the install org).
 * - 404 `NOT_FOUND` — no such code.
 */
import type { NextRequest } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { successResponse } from '@/lib/api/responses';
import { withAdminAuth } from '@/lib/auth/guards';
import { revokeCode } from '@/lib/app/credits/codes/service';
import { CODES_OWNERSHIP } from '@/lib/app/credits/codes/route-auth';
import { codeIdParamSchema } from '@/lib/app/credits/codes/wire';

export const DELETE = withAdminAuth<{ id: string }>(
  async (_request: NextRequest, _session, { params }) => {
    const parsed = codeIdParamSchema.safeParse(await params);
    if (!parsed.success) throw new NotFoundError('Code not found');
    return successResponse(await revokeCode(parsed.data.id));
  },
  { ...CODES_OWNERSHIP, writesSharedSettings: true }
);

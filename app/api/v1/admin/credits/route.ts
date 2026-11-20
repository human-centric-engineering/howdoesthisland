/**
 * GET /api/v1/admin/credits — active workspaces, by name, each with its
 * CopyCredits balance and what its monthly AI cap (the safety ceiling) leaves
 * this month (t-57). The admin page's one read. `?q=` narrows by name or slug;
 * at most 200, with `truncated` when more match.
 *
 * Authentication: a platform admin (session, or an `admin` API key).
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a `q` over 100 characters.
 * - 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (not a platform admin).
 */
import type { NextRequest } from 'next/server';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { withAdminAuth } from '@/lib/auth/guards';
import { listWorkspaceCredits } from '@/lib/app/credits/admin';
import { CREDITS_PLATFORM_ONLY } from '@/lib/app/credits/route-auth';
import { adminCreditsQuerySchema } from '@/lib/app/credits/wire';

export const GET = withAdminAuth(async (request: NextRequest) => {
  const { q } = validateQueryParams(new URL(request.url).searchParams, adminCreditsQuerySchema);
  return successResponse(await listWorkspaceCredits(q || undefined));
}, CREDITS_PLATFORM_ONLY);

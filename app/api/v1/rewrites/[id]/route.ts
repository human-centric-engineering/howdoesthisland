/**
 * GET /api/v1/rewrites/{id} — one of the workspace's rewrites (t-81): while
 * it runs, the draft as last saved (every few seconds); then the whole draft,
 * or why it failed.
 *
 * Authentication: a browser session, or an API key with the `assess` scope.
 *
 * Errors: 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (an API key without `assess`),
 * 404 `NOT_FOUND` (no such rewrite in this workspace; another workspace's id
 * reads the same).
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { assessRoute } from '@/lib/app/assessments/api/route-auth';
import { getRewrite } from '@/lib/app/rewrites/service';
import { rewriteIdParamSchema } from '@/lib/app/rewrites/validations';

export const GET = withAuth<{ id: string }>(async (_request: NextRequest, _session, { params }) => {
  const { id } = validateQueryParams(new URLSearchParams(await params), rewriteIdParamSchema);
  return successResponse(await getRewrite(id));
}, assessRoute<{ id: string }>());

/**
 * One of the workspace's comparisons (t-87, `.context/app/comparisons.md`).
 *
 * GET    /api/v1/comparisons/{id} — each draft's state and scores, and per
 *        appeal each draft's difference from the best, with the leaders, once
 *        two drafts are scored. A draft whose review was deleted or purged
 *        reads as `purged`.
 * DELETE /api/v1/comparisons/{id} — delete the comparison; its drafts'
 *        reviews stay in the workspace's history.
 *
 * Authentication: a browser session, or an API key with the `assess` scope.
 *
 * Errors: 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (an API key without `assess`),
 * 404 `NOT_FOUND` (no such comparison in this workspace; another workspace's
 * id reads the same).
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { assessRoute } from '@/lib/app/assessments/api/route-auth';
import { getComparison, removeComparison } from '@/lib/app/comparisons/service';
import { comparisonIdParamSchema } from '@/lib/app/comparisons/validations';

export const GET = withAuth<{ id: string }>(async (_request: NextRequest, _session, { params }) => {
  const { id } = validateQueryParams(new URLSearchParams(await params), comparisonIdParamSchema);
  return successResponse(await getComparison(id));
}, assessRoute<{ id: string }>());

export const DELETE = withAuth<{ id: string }>(
  async (_request: NextRequest, _session, { params }) => {
    const { id } = validateQueryParams(new URLSearchParams(await params), comparisonIdParamSchema);
    return successResponse(await removeComparison(id));
  },
  assessRoute<{ id: string }>()
);

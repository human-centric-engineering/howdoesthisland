/**
 * One of the workspace's assessments (t-24).
 *
 * GET    /api/v1/assessments/{id} — the assessment, its judges and, once final, its result.
 * DELETE /api/v1/assessments/{id} — delete it, its judge runs, and its text.
 *
 * Authentication: a browser session, or an API key with the `assess` scope.
 * Delete works in any state: a run still going stores nothing more. Its
 * cost rows stay, as the usage record.
 *
 * Errors:
 * - 401 `UNAUTHORIZED` — no session or key.
 * - 403 `FORBIDDEN` — an API key without the `assess` scope.
 * - 404 `NOT_FOUND` — no such assessment in this workspace. Another
 *   workspace's id reads the same, so an id is not confirmed to an outsider.
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { assessRoute } from '@/lib/app/assessments/api/route-auth';
import { getAssessment, remove } from '@/lib/app/assessments/api/service';
import { assessmentIdParamSchema } from '@/lib/app/assessments/api/validations';

export const GET = withAuth<{ id: string }>(async (_request: NextRequest, _session, { params }) => {
  const { id } = validateQueryParams(new URLSearchParams(await params), assessmentIdParamSchema);
  return successResponse(await getAssessment(id));
}, assessRoute<{ id: string }>());

export const DELETE = withAuth<{ id: string }>(
  async (_request: NextRequest, _session, { params }) => {
    const { id } = validateQueryParams(new URLSearchParams(await params), assessmentIdParamSchema);
    return successResponse(await remove(id));
  },
  assessRoute<{ id: string }>()
);

/**
 * GET /api/v1/assessments/{id}/gaps — a finished review's gaps, as questions
 * for the writer (t-108, `.context/app/coaching.md`).
 *
 * The facts only the writer knows that the review found missing, strongest
 * first, each with a plain-words question about the writer's situation and
 * why it matters. Built from what the report shows, its latest rewrite's
 * placeholders and its project's brief, with no AI call. Gaps the brief
 * already answers are left out.
 *
 * Authentication: a browser session, or an API key with the `assess` scope.
 *
 * Errors:
 * - 401 `UNAUTHORIZED` — no session or key.
 * - 403 `FORBIDDEN` — an API key without the `assess` scope.
 * - 404 `NOT_FOUND` — no such review in this workspace (another workspace's id too).
 * - 409 `ASSESSMENT_NOT_FINISHED` — still queued or running, or it ended with no result.
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { assessRoute } from '@/lib/app/assessments/api/route-auth';
import { assessmentIdParamSchema } from '@/lib/app/assessments/api/validations';
import { getGaps } from '@/lib/app/coaching/service';

export const GET = withAuth<{ id: string }>(async (_request: NextRequest, _session, { params }) => {
  const { id } = validateQueryParams(new URLSearchParams(await params), assessmentIdParamSchema);
  return successResponse(await getGaps(id));
}, assessRoute<{ id: string }>());

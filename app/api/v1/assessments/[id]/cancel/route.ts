/**
 * POST /api/v1/assessments/{id}/cancel — stop a queued or running assessment (t-24).
 *
 * No further judge is called. Judges already in flight finish and are kept,
 * since their cost is spent. Answers with the assessment, now `cancelled`.
 *
 * Authentication: a browser session, or an API key with the `assess` scope.
 *
 * Errors:
 * - 401 `UNAUTHORIZED` — no session or key.
 * - 403 `FORBIDDEN` — an API key without the `assess` scope.
 * - 404 `NOT_FOUND` — no such assessment in this workspace (another workspace's id too).
 * - 409 `ASSESSMENT_FINAL` — it has already finished, failed or been cancelled.
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { assessRoute } from '@/lib/app/assessments/api/route-auth';
import { cancel } from '@/lib/app/assessments/api/service';
import { assessmentIdParamSchema } from '@/lib/app/assessments/api/validations';

export const POST = withAuth<{ id: string }>(
  async (_request: NextRequest, _session, { params }) => {
    const { id } = validateQueryParams(new URLSearchParams(await params), assessmentIdParamSchema);
    return successResponse(await cancel(id));
  },
  assessRoute<{ id: string }>()
);

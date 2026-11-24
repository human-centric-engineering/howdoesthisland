/**
 * GET /api/v1/assessments/{id}/events — an assessment's progress, as
 * Server-Sent Events (t-24, §8.2).
 *
 * Read from the stored rows, so a stream sees every judge whichever process
 * runs the assessment, and a stream opened late first replays the judges
 * that have landed. Events: `assessment_status`, `assessment_quick_scan`
 * (a running review's quick scan, before any judge; t-77), `assessment_judge`,
 * `assessment_done` (then the stream ends), `assessment_gone` (deleted) and
 * `assessment_timeout` (open again to carry on). See
 * `lib/app/assessments/api/events.ts`.
 *
 * Authentication: a browser session, or an API key with the `assess` scope.
 *
 * Errors, before the stream opens:
 * - 401 `UNAUTHORIZED` — no session or key.
 * - 403 `FORBIDDEN` — an API key without the `assess` scope.
 * - 404 `NOT_FOUND` — no such assessment in this workspace (another workspace's id too).
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { sseResponse } from '@/lib/api/sse';
import { validateQueryParams } from '@/lib/api/validation';
import { assessmentEvents } from '@/lib/app/assessments/api/events';
import { assessRoute } from '@/lib/app/assessments/api/route-auth';
import { assessmentExists } from '@/lib/app/assessments/api/views';
import { NotFoundError } from '@/lib/api/errors';
import { assessmentIdParamSchema } from '@/lib/app/assessments/api/validations';

/** As long as one stream stays open (`EVENTS_MAX_MS`), and a little over. */
export const maxDuration = 310;

export const GET = withAuth<{ id: string }>(async (request: NextRequest, _session, { params }) => {
  const { id } = validateQueryParams(new URLSearchParams(await params), assessmentIdParamSchema);
  // A 404 before the stream opens, not an event inside it. Only whether it
  // exists: the stream reads the rest, its quick scan included (t-77).
  if (!(await assessmentExists(id))) throw new NotFoundError('Assessment not found');
  return sseResponse(assessmentEvents(id, { signal: request.signal }), {
    signal: request.signal,
  });
}, assessRoute<{ id: string }>());

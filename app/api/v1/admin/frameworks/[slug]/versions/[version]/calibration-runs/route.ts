/**
 * POST /api/v1/admin/frameworks/{slug}/versions/{version}/calibration-runs —
 * start a calibration run of the version (t-38). Body: `{ mode: 'quick' | 'ai' }`.
 *
 * A quick run is free and quick, and is answered 201 once it is stored
 * complete. An AI run calls every judge on every case against the install
 * org's budget: it is answered 202 as soon as it is stored as running, and
 * finishes in the background (`GET /api/v1/admin/frameworks` shows it). The
 * caller is recorded as the run's `startedByUserId`, and on each judge call's
 * cost row. This never publishes.
 *
 * Authentication: a platform admin (session, or an `admin` API key).
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a body that does not fit the schema.
 * - 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (not a platform admin).
 * - 404 `NOT_FOUND` — no such framework or version.
 * - 409 `CALIBRATION_SET_MISSING` — no calibration set is written for the version.
 * - 409 `CALIBRATION_REFUSED` — the set does not fit the version, or it has no
 *   judges for an AI run. `details.reason` and `details.problems` say why.
 * - 409 `CALIBRATION_RUNNING` — an AI run of the version is still running.
 */
import type { NextRequest } from 'next/server';
import { NotFoundError } from '@/lib/api/errors';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { withAdminAuth } from '@/lib/auth/guards';
import { startCalibrationRun } from '@/lib/app/calibration/admin';
import { PLATFORM_ONLY } from '@/lib/app/calibration/route-auth';
import {
  calibrationRunParamsSchema,
  startCalibrationRunSchema,
} from '@/lib/app/calibration/validations';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';

/**
 * Long enough for an AI run the response did not wait for to carry on under
 * `after()`, as an assessment does. A whole set can take longer on a
 * serverless host; such a run is shown as stopped (`STOPPED_AFTER_MS`).
 */
export const maxDuration = 300;

export const POST = withAdminAuth<{ slug: string; version: string }>(
  async (request: NextRequest, session, { params }) => {
    const raw = await params;
    const parsed = calibrationRunParamsSchema.safeParse(raw);
    if (!parsed.success || parsed.data.slug !== howDoesThisLand.slug) {
      throw new NotFoundError(`No framework ${raw.slug} with calibration runs.`);
    }
    const { mode } = await validateRequestBody(request, startCalibrationRunSchema);
    const started = await startCalibrationRun({
      version: parsed.data.version,
      mode,
      userId: session.user.id,
    });
    return successResponse(started, undefined, {
      status: started.status === 'complete' ? 201 : 202,
    });
  },
  PLATFORM_ONLY
);

/**
 * A report's share links (t-32).
 *
 * POST /api/v1/assessments/{id}/shares — make a link that opens the report,
 * read-only, for someone without an account (`/r/{token}`). Body
 * (`createShareSchema`, may be empty): `{ expiresInDays? }`, 1 to 365,
 * default 30. The answer is the only time the token and its URL are shown:
 * only a hash is kept.
 *
 * GET /api/v1/assessments/{id}/shares — the report's links, newest first,
 * with each one's state (`active`, `expired`, `revoked`) and view count.
 *
 * Authentication: a browser session, or an API key with the `reports` scope.
 * Any member of the workspace may make and list them.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a body that is not JSON or does not fit the schema.
 * - 401 `UNAUTHORIZED` — no session or key.
 * - 403 `FORBIDDEN` — an API key without the `reports` scope.
 * - 404 `NOT_FOUND` — no such assessment in this workspace.
 * - 409 `REPORT_NOT_READY` (POST) — still queued or running, or it failed or
 *   was cancelled, so there is no report. `details.status` says which.
 */
import type { NextRequest } from 'next/server';
import { ValidationError } from '@/lib/api/errors';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { withAuth } from '@/lib/auth/guards';
import { assessRoute, REPORTS_SCOPE } from '@/lib/app/assessments/api/route-auth';
import { assessmentIdParamSchema } from '@/lib/app/assessments/api/validations';
import { createShare, listShares } from '@/lib/app/reports/share/service';
import { createShareSchema } from '@/lib/app/reports/share/validations';

export const POST = withAuth<{ id: string }>(async (request: NextRequest, session, { params }) => {
  const { id } = validateQueryParams(new URLSearchParams(await params), assessmentIdParamSchema);
  const share = await createShare(id, await readBody(request), session.user.id);
  return successResponse(share, undefined, { status: 201 });
}, assessRoute<{ id: string }>(REPORTS_SCOPE));

export const GET = withAuth<{ id: string }>(async (_request: NextRequest, _session, { params }) => {
  const { id } = validateQueryParams(new URLSearchParams(await params), assessmentIdParamSchema);
  return successResponse(await listShares(id));
}, assessRoute<{ id: string }>(REPORTS_SCOPE));

/** The body, where an empty one means every default. */
async function readBody(request: NextRequest) {
  const text = await request.text();
  let raw: unknown = {};
  if (text.trim() !== '') {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ValidationError('Invalid JSON in request body');
    }
  }
  const parsed = createShareSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError('Invalid request body', {
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

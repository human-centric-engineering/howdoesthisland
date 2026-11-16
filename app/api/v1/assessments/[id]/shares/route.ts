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
 * Authentication: a browser session, or an API key. Making a link needs the
 * `assess` scope: it publishes the report to anyone with the link, which a
 * `reports` key, read-only, must not be able to do. Listing needs `reports`.
 * Any member of the workspace may make and list them.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a body that is not JSON or does not fit the schema.
 * - 401 `UNAUTHORIZED` — no session or key.
 * - 403 `FORBIDDEN` — an API key without the scope (`assess` to make,
 *   `reports` to list).
 * - 404 `NOT_FOUND` — no such assessment in this workspace.
 * - 409 `REPORT_NOT_READY` (POST) — still queued or running, or it failed or
 *   was cancelled, so there is no report. `details.status` says which.
 */
import type { NextRequest } from 'next/server';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { withAuth } from '@/lib/auth/guards';
import { ASSESS_SCOPE, assessRoute, REPORTS_SCOPE } from '@/lib/app/assessments/api/route-auth';
import { assessmentIdParamSchema } from '@/lib/app/assessments/api/validations';
import { createShare, listShares } from '@/lib/app/reports/share/service';
import { createShareSchema } from '@/lib/app/reports/share/validations';

export const POST = withAuth<{ id: string }>(async (request: NextRequest, session, { params }) => {
  const { id } = validateQueryParams(new URLSearchParams(await params), assessmentIdParamSchema);
  const share = await createShare(id, await readBody(request), session.user.id);
  return successResponse(share, undefined, { status: 201 });
}, assessRoute<{ id: string }>(ASSESS_SCOPE));

export const GET = withAuth<{ id: string }>(async (_request: NextRequest, _session, { params }) => {
  const { id } = validateQueryParams(new URLSearchParams(await params), assessmentIdParamSchema);
  return successResponse(await listShares(id));
}, assessRoute<{ id: string }>(REPORTS_SCOPE));

/** The body, where an empty one means every default. */
async function readBody(request: NextRequest) {
  const text = await request.clone().text();
  if (text.trim() === '') return createShareSchema.parse({});
  return validateRequestBody(request, createShareSchema);
}

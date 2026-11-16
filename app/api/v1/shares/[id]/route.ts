/**
 * DELETE /api/v1/shares/{id} — revoke a share link (t-32).
 *
 * The link stops opening the report at once. The row stays, revoked, so the
 * report's list still shows it; revoking it again keeps the first time.
 *
 * Authentication: a browser session, or an API key with the `assess` scope,
 * as making one needs: a `reports` key is read-only and changes no link.
 * Any member of the workspace may revoke any of its links.
 *
 * Errors:
 * - 401 `UNAUTHORIZED` — no session or key.
 * - 403 `FORBIDDEN` — an API key without the `assess` scope.
 * - 404 `NOT_FOUND` — no such link in this workspace.
 */
import type { NextRequest } from 'next/server';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { withAuth } from '@/lib/auth/guards';
import { ASSESS_SCOPE, assessRoute } from '@/lib/app/assessments/api/route-auth';
import { revokeShare } from '@/lib/app/reports/share/service';
import { shareIdParamSchema } from '@/lib/app/reports/share/validations';

export const DELETE = withAuth<{ id: string }>(
  async (_request: NextRequest, _session, { params }) => {
    const { id } = validateQueryParams(new URLSearchParams(await params), shareIdParamSchema);
    return successResponse(await revokeShare(id));
  },
  assessRoute<{ id: string }>(ASSESS_SCOPE)
);

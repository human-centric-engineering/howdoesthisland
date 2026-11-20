/**
 * The workspace's usage this month (t-48).
 *
 * GET /api/v1/usage — reviews run, AI reviewer calls and spend this calendar
 * month (UTC), by project and in total, against the workspace's monthly
 * budget and what is left of it (`getMonthUsage`, `lib/app/usage/service.ts`).
 * The total is the one the budget is held to.
 *
 * Authentication: a browser session, or an API key with the `reports` scope.
 * Any member of the workspace may read it: it is the workspace the caller acts
 * in, and its figures are the workspace's, not a person's.
 *
 * Errors:
 * - 401 `UNAUTHORIZED` — no session or key.
 * - 403 `FORBIDDEN` — an API key without the `reports` scope.
 */
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { requireOrgId } from '@/lib/tenancy/context';
import { REPORTS_SCOPE } from '@/lib/app/assessments/api/route-auth';
import { getMonthUsage } from '@/lib/app/usage/service';

export const GET = withAuth(async () => successResponse(await getMonthUsage(requireOrgId())), {
  scope: REPORTS_SCOPE,
  ownership: {
    decidedBy: 'nothing',
    because:
      "Usage is the workspace's, not a person's: every read names the org the guard entered.",
  },
});

/**
 * GET /api/v1/admin/frameworks — every framework version, drafts included,
 * with its calibration snapshot and its calibration runs, each with its
 * agreement by kind and its change from the run before it (t-38). The admin
 * page's one read.
 *
 * Authentication: a platform admin (session, or an `admin` API key).
 *
 * Errors: 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (not a platform admin).
 */
import { successResponse } from '@/lib/api/responses';
import { withAdminAuth } from '@/lib/auth/guards';
import { listFrameworkCalibration } from '@/lib/app/calibration/admin';
import { PLATFORM_ONLY } from '@/lib/app/calibration/route-auth';

export const GET = withAdminAuth(async () => {
  return successResponse([await listFrameworkCalibration()]);
}, PLATFORM_ONLY);

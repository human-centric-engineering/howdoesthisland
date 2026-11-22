/**
 * GET /api/v1/frameworks — every framework with a published version, and
 * those versions, most recently published first (t-11).
 *
 * Authentication: a browser session, or an API key with the `assess` scope
 * (t-67). Errors: 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (a key without `assess`).
 */
import { withAuth } from '@/lib/auth/guards';
import { listFrameworks } from '@/lib/app/frameworks/api/service';
import { conditionalResponse, frameworkErrorResponse } from '@/lib/app/frameworks/api/respond';
import { frameworkReader } from '@/lib/app/frameworks/api/route-auth';

export const GET = withAuth(async (request) => {
  try {
    const frameworks = await listFrameworks();
    return await conditionalResponse(request, frameworks, () =>
      Promise.resolve({ data: frameworks })
    );
  } catch (error) {
    return frameworkErrorResponse(error);
  }
}, frameworkReader());

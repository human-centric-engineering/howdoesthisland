/**
 * GET /api/v1/frameworks — every framework with a published version, and
 * those versions, newest first (t-11).
 *
 * Authentication: none. Rate limiting: the `/api/v1` section cap, keyed on the
 * caller's IP when anonymous (`lib/security/rate-limit-policy.ts`).
 */
import { listFrameworks } from '@/lib/app/frameworks/api/service';
import { conditionalResponse, frameworkErrorResponse } from '@/lib/app/frameworks/api/respond';

export async function GET(request: Request): Promise<Response> {
  try {
    const frameworks = await listFrameworks();
    return await conditionalResponse(request, frameworks, () =>
      Promise.resolve({ data: frameworks })
    );
  } catch (error) {
    return frameworkErrorResponse(error);
  }
}

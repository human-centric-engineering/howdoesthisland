/**
 * GET /api/v1/frameworks/{slug} — one framework and its published versions
 * (t-11). `latestVersion` is the one new reviews use.
 *
 * Authentication: a browser session, or an API key with the `assess` scope
 * (t-67). Errors: 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (a key without
 * `assess`), 404 `FRAMEWORK_NOT_FOUND`.
 */
import { withAuth } from '@/lib/auth/guards';
import { getFramework } from '@/lib/app/frameworks/api/service';
import { conditionalResponse, frameworkErrorResponse } from '@/lib/app/frameworks/api/respond';
import { frameworkReader } from '@/lib/app/frameworks/api/route-auth';

export const GET = withAuth<{ slug: string }>(async (request, _session, { params }) => {
  try {
    const { slug } = await params;
    const framework = await getFramework(slug);
    return await conditionalResponse(request, framework, () =>
      Promise.resolve({ data: framework })
    );
  } catch (error) {
    return frameworkErrorResponse(error);
  }
}, frameworkReader<{ slug: string }>());

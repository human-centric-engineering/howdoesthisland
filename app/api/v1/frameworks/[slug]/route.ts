/**
 * GET /api/v1/frameworks/{slug} — one framework, its published versions and
 * the record kinds a version serves (t-11).
 *
 * Authentication: none. 404 `FRAMEWORK_NOT_FOUND` for a slug with no
 * published version.
 */
import { getFramework } from '@/lib/app/frameworks/api/service';
import { conditionalResponse, frameworkErrorResponse } from '@/lib/app/frameworks/api/respond';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  try {
    const { slug } = await params;
    const framework = await getFramework(slug);
    return await conditionalResponse(request, framework, () =>
      Promise.resolve({ data: framework })
    );
  } catch (error) {
    return frameworkErrorResponse(error);
  }
}

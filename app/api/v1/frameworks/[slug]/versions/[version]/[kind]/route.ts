/**
 * GET /api/v1/frameworks/{slug}/versions/{version}/{kind} — one kind of
 * record from a published version (`dimension`, `move`, `red_flag`, …), in
 * model order (t-11). `GET /frameworks/{slug}` lists the kinds.
 *
 * Authentication: none. 404 `FRAMEWORK_NOT_FOUND`,
 * `FRAMEWORK_VERSION_NOT_FOUND` or `FRAMEWORK_KIND_NOT_FOUND` (which the
 * culture kinds are while the culture switch is off).
 */
import {
  assertServedKind,
  kindRecords,
  resolveVersion,
  versionETagSource,
} from '@/lib/app/frameworks/api/service';
import { conditionalResponse, frameworkErrorResponse } from '@/lib/app/frameworks/api/respond';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; version: string; kind: string }> }
): Promise<Response> {
  try {
    const { slug, version, kind } = await params;
    const resolved = await resolveVersion(slug, version);
    // Resolve the kind before the ETag check, so an unknown kind is a 404
    // even for a caller sending a stale If-None-Match.
    assertServedKind(resolved, kind);
    return await conditionalResponse(request, versionETagSource(resolved, kind), () =>
      kindRecords(resolved, kind)
    );
  } catch (error) {
    return frameworkErrorResponse(error);
  }
}

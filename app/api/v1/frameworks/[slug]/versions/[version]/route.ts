/**
 * GET /api/v1/frameworks/{slug}/versions/{version} — the whole model of a
 * published version, as materialised from its records (t-11).
 *
 * `meta.sourceSha256` is the imported file's checksum. With the culture
 * switch off, the `culture` section is left out and named in `meta.omitted`.
 *
 * Authentication: none. 404 `FRAMEWORK_NOT_FOUND` or
 * `FRAMEWORK_VERSION_NOT_FOUND` (a draft is not found).
 */
import {
  resolveVersion,
  versionDocument,
  versionETagSource,
} from '@/lib/app/frameworks/api/service';
import { conditionalResponse, frameworkErrorResponse } from '@/lib/app/frameworks/api/respond';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; version: string }> }
): Promise<Response> {
  try {
    const { slug, version } = await params;
    const resolved = await resolveVersion(slug, version);
    return await conditionalResponse(request, versionETagSource(resolved), () =>
      versionDocument(resolved)
    );
  } catch (error) {
    return frameworkErrorResponse(error);
  }
}

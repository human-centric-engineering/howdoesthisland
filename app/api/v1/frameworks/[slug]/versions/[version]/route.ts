/**
 * GET /api/v1/frameworks/{slug}/versions/{version} — the whole model of a
 * published version, as materialised from its records (t-11).
 *
 * The model is HowDoesThisLand's IP: platform admins only (t-67). API
 * callers read a version's catalogue instead (`…/catalogue`).
 *
 * `meta.sourceSha256` is the imported file's checksum. With the culture
 * switch off, the `culture` section is left out and named in `meta.omitted`.
 *
 * Authentication: a platform admin (session, or an `admin` API key).
 * Errors: 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404 `FRAMEWORK_NOT_FOUND` or
 * `FRAMEWORK_VERSION_NOT_FOUND` (a draft is not found).
 */
import { withAdminAuth } from '@/lib/auth/guards';
import {
  resolveVersion,
  versionDocument,
  versionETagSource,
} from '@/lib/app/frameworks/api/service';
import { conditionalResponse, frameworkErrorResponse } from '@/lib/app/frameworks/api/respond';
import { MODEL_ADMIN_ONLY } from '@/lib/app/frameworks/api/route-auth';

export const GET = withAdminAuth<{ slug: string; version: string }>(
  async (request, _session, { params }) => {
    try {
      const { slug, version } = await params;
      const resolved = await resolveVersion(slug, version);
      return await conditionalResponse(request, versionETagSource(resolved), () =>
        versionDocument(resolved)
      );
    } catch (error) {
      return frameworkErrorResponse(error);
    }
  },
  MODEL_ADMIN_ONLY
);

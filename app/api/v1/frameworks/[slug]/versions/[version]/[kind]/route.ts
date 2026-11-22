/**
 * GET /api/v1/frameworks/{slug}/versions/{version}/{kind} — one kind of
 * record from a published version, in model order (t-11). A nested kind (a
 * perspective's levers) carries `meta.parents`.
 *
 * Part of the model, so platform admins only (t-67).
 *
 * Authentication: a platform admin (session, or an `admin` API key).
 * Errors: 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404 `FRAMEWORK_NOT_FOUND`,
 * `FRAMEWORK_VERSION_NOT_FOUND` or `FRAMEWORK_KIND_NOT_FOUND`.
 */
import { withAdminAuth } from '@/lib/auth/guards';
import {
  assertServedKind,
  kindRecords,
  resolveVersion,
  versionETagSource,
} from '@/lib/app/frameworks/api/service';
import { conditionalResponse, frameworkErrorResponse } from '@/lib/app/frameworks/api/respond';
import { MODEL_ADMIN_ONLY } from '@/lib/app/frameworks/api/route-auth';

export const GET = withAdminAuth<{ slug: string; version: string; kind: string }>(
  async (request, _session, { params }) => {
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
  },
  MODEL_ADMIN_ONLY
);

/**
 * GET /api/v1/frameworks/{slug}/versions/{version}/catalogue — what a
 * version's reviews take and return, by id and name (t-67): the types of
 * copy, reader archetypes, roles, audience settings and countries a review's
 * `context` takes, and the appeals, dimensions, lenses, groups, red flags and
 * duties a result names. Never the model itself.
 *
 * Authentication: a browser session, or an API key with the `assess` scope.
 * Errors: 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (a key without `assess`),
 * 404 `FRAMEWORK_NOT_FOUND` or `FRAMEWORK_VERSION_NOT_FOUND`.
 */
import { withAuth } from '@/lib/auth/guards';
import {
  resolveVersion,
  versionCatalogue,
  versionETagSource,
} from '@/lib/app/frameworks/api/service';
import { conditionalResponse, frameworkErrorResponse } from '@/lib/app/frameworks/api/respond';
import { frameworkReader } from '@/lib/app/frameworks/api/route-auth';

/** Its own ETag key, apart from every record kind's. */
const CATALOGUE = '#catalogue';

export const GET = withAuth<{ slug: string; version: string }>(
  async (request, _session, { params }) => {
    try {
      const { slug, version } = await params;
      const resolved = await resolveVersion(slug, version);
      return await conditionalResponse(request, versionETagSource(resolved, CATALOGUE), () =>
        versionCatalogue(resolved)
      );
    } catch (error) {
      return frameworkErrorResponse(error);
    }
  },
  frameworkReader<{ slug: string; version: string }>()
);

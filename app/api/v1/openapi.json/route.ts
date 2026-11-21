/**
 * GET /api/v1/openapi.json — this API as an OpenAPI 3.1 document, generated
 * from the route registry (t-44).
 *
 * The body is the document itself, not the success envelope, so a tool can
 * load the URL as it is. A conditional GET: the `ETag` is the document's
 * hash, and it changes when a deploy changes the registry or the quick-scan
 * switch (`lib/app/quick-scan.ts`) adds or drops `POST /api/v1/scan`.
 *
 * Authentication: none. Rate limiting: the `/api/v1` section cap, keyed on
 * the caller's IP when anonymous (`lib/security/rate-limit-policy.ts`).
 */
import { handleAPIError } from '@/lib/api/errors';
import { checkConditional } from '@/lib/api/etag';
import { DEFAULT_CACHE_CONTROL } from '@/lib/api/responses';
import { publishedOpenApi } from '@/lib/app/api/openapi';

export const GET = (request: Request): Response => {
  try {
    const { document, etag } = publishedOpenApi();
    const notModified = checkConditional(request, etag);
    if (notModified) return notModified;
    return Response.json(document, {
      headers: { ETag: etag, 'Cache-Control': DEFAULT_CACHE_CONTROL },
    });
  } catch (error) {
    return handleAPIError(error);
  }
};

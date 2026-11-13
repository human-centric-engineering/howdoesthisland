/**
 * The `frameworks` routes' shared response steps (t-11): the conditional GET
 * through `lib/api/etag.ts`, and a 404 with the lookup's own code.
 */
import { checkConditional, computeETag } from '@/lib/api/etag';
import { handleAPIError } from '@/lib/api/errors';
import { errorResponse, successResponse } from '@/lib/api/responses';
import { FrameworkApiError } from '@/lib/app/frameworks/api/service';

/**
 * A 304 when the caller already holds `etagSource`'s version, else the
 * envelope `build()` returns. `build` runs only on a miss.
 */
export async function conditionalResponse(
  request: Request,
  etagSource: unknown,
  build: () => Promise<{ data: unknown; meta?: Record<string, unknown> }>
): Promise<Response> {
  const etag = computeETag(etagSource);
  const notModified = checkConditional(request, etag);
  if (notModified) return notModified;
  const { data, meta } = await build();
  return successResponse(data, meta, { headers: { ETag: etag } });
}

export function frameworkErrorResponse(error: unknown): Response {
  if (error instanceof FrameworkApiError) {
    return errorResponse(error.message, { code: error.code, status: error.status });
  }
  return handleAPIError(error);
}

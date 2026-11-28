/**
 * Files uploaded for a batch (t-102, `.context/app/batches.md`).
 *
 * POST /api/v1/contents — upload one file; a batch item then names it.
 *
 * Authentication: a browser session, or an API key with the `assess` scope.
 * The upload is the workspace's the caller acts in, and only a batch in that
 * workspace can take it.
 *
 * **Body**: `multipart/form-data` with one `file` part (`readUpload`), as a
 * single review takes a file, and nothing else: an `options` part, if sent,
 * must be `{}`. Its text is read in this request (`extractText`), under the
 * same limits and refusals as a review's upload, and stored with no review.
 * 201 with the upload: `id`, `fileName`, `title`, `wordCount`, `createdAt`
 * and `expiresAt`. Name it in `POST /api/v1/batches` as `{ contentId: id,
 * label? }`; one batch item takes it. One no batch takes by `expiresAt`, 24
 * hours on, is deleted.
 *
 * Errors: 400 `VALIDATION_ERROR` (not multipart, no file, an unknown part, a
 * body cut short), 400 `CONTENT_EMPTY`, 413 `FILE_TOO_LARGE` (the file, or a
 * body over `MAX_UPLOAD_BODY_BYTES`, refused before it is read), 415
 * `INVALID_FILE_TYPE`, 422 `TEXT_TOO_LONG`, `TOO_MANY_PAGES`,
 * `PDF_HAS_NO_TEXT`, `NO_TEXT`, `FILE_UNREADABLE`. 429 `RATE_LIMIT_EXCEEDED`
 * past `UPLOADS_PER_HOUR` per user, counted once the body is read, so a
 * refused type counts too: it was read. 401, 403 as every route.
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { ValidationError } from '@/lib/api/errors';
import { successResponse } from '@/lib/api/responses';
import { createRateLimitResponse } from '@/lib/security/rate-limit';
import { assessRoute } from '@/lib/app/assessments/api/route-auth';
import { isMultipart, readUpload } from '@/lib/app/intake/upload';
import { uploadLimiter } from '@/lib/app/batches/limiter';
import { storeUpload } from '@/lib/app/batches/uploads';
import { contentUploadOptionsSchema } from '@/lib/app/batches/validations';

/** Long enough to read a long PDF or deck within the request. */
export const maxDuration = 60;

export const POST = withAuth(async (request: NextRequest, session) => {
  if (!isMultipart(request)) {
    throw new ValidationError('Send the file as multipart/form-data, in a `file` part', {
      file: ['Send exactly one file, in the `file` part'],
    });
  }
  const { file } = await readUpload(request, contentUploadOptionsSchema);
  const limit = uploadLimiter.check(`user:${session.user.id}`);
  if (!limit.success) return createRateLimitResponse(limit);
  const upload = await storeUpload(file, session.user.id);
  return successResponse(upload, undefined, { status: 201 });
}, assessRoute());

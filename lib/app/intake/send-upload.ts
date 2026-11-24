'use client';

/**
 * Send a file the person chose to an API route that reads uploads (t-80,
 * `lib/app/intake/upload.ts`): a project's background document, a file to
 * review. Browser-only, and apart from intake's parsers, so a page that
 * imports it carries none of them.
 *
 * The file goes as a `multipart/form-data` `file` part, its own bytes, and
 * the request's other fields as JSON in an `options` part.
 */
import { APIClientError, apiErrorFromResponse } from '@/lib/api/client';
import { parseApiResponse } from '@/lib/api/parse-response';
import type { APIResponse } from '@/types/api';

/**
 * POST `file` and `options` to `endpoint`; the success envelope's `data`.
 *
 * A host that refuses the body before the route runs (Vercel, over 4.5 MB)
 * answers 413 without the API's envelope: that is reported as
 * `FILE_TOO_LARGE` with `tooLargeMessage`, as the route's own refusal of a
 * file too large would be.
 *
 * @throws APIClientError — `FILE_UNREADABLE` when the chosen file can no
 *   longer be read; the route's refusal, the host's, or a network failure
 */
export async function sendUpload(
  endpoint: string,
  file: File,
  options: Record<string, unknown>,
  tooLargeMessage: string
): Promise<unknown> {
  // A file moved, deleted or unshared since it was chosen fails only when
  // read. Read its first byte, so that says "choose it again" rather than
  // coming back as a network failure from inside `fetch`.
  try {
    await file.slice(0, 1).arrayBuffer();
  } catch {
    throw new APIClientError(
      `${file.name} could not be opened. Try choosing it again.`,
      'FILE_UNREADABLE'
    );
  }
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('options', JSON.stringify(options));
  let response: Response;
  try {
    response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', body: form });
  } catch (err) {
    throw new APIClientError(
      err instanceof Error ? err.message : 'Network request failed',
      'NETWORK_ERROR'
    );
  }
  if (!response.ok) {
    const err = await apiErrorFromResponse(response);
    if (response.status === 413 && err.code === 'INVALID_RESPONSE') {
      throw new APIClientError(tooLargeMessage, 'FILE_TOO_LARGE', 413);
    }
    throw err;
  }
  let body: APIResponse<unknown>;
  try {
    body = await parseApiResponse<unknown>(response);
  } catch {
    throw new APIClientError(
      `Invalid response format: ${response.statusText}`,
      'INVALID_RESPONSE',
      response.status
    );
  }
  if (!body.success) {
    throw new APIClientError(
      body.error.message,
      body.error.code,
      response.status,
      body.error.details
    );
  }
  return body.data;
}

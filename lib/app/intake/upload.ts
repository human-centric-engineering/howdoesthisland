/**
 * Read a file sent as `multipart/form-data` (t-80): the way into every route
 * that takes a file, in place of base64 inside a JSON body.
 *
 * **Why not JSON.** Base64 is 4/3 the file's size, and the proxy
 * (`proxy.ts`, which matches `/api/v1/**`) keeps only the first
 * {@link MAX_UPLOAD_BODY_BYTES} of any body
 * (`experimental.proxyClientMaxBodySize` in `next.config.js`). A 10 MB file
 * as base64 arrived cut short and failed as invalid JSON. As a multipart part
 * it travels as its own bytes, with a little framing.
 *
 * **The parts.** `file`: the file, its name the one it was sent with, whose
 * extension picks the reader (`extractText`). `options` (optional): a JSON
 * object with the route's other fields, as its JSON body would carry them
 * without `source`. Any other part is refused, as a strict JSON body refuses
 * an unknown key.
 *
 * **A body the proxy would cut short is refused**, not read: one whose
 * `Content-Length` is over {@link MAX_UPLOAD_BODY_BYTES} is answered 413
 * before it is parsed. One sent without a length and cut short fails to
 * parse, and is answered 400. Vercel (staging) refuses any body over 4.5 MB
 * before the route runs, with a 413 of its own (`.context/app/workbench.md`).
 */
import type { z } from 'zod';
import { APIError, ErrorCodes, ValidationError } from '@/lib/api/errors';
import { enforceContentLengthCap } from '@/lib/api/multipart-guard';
import { DEFAULT_INTAKE_LIMITS } from '@/lib/app/intake/extract-text';

/**
 * The largest multipart body a route reads: the largest file intake reads
 * and 64 KB for the framing and the `options` part. The proxy's body limit
 * (`proxyClientMaxBodySize` in `next.config.js`) is set to this, and a test
 * holds the two equal: a body under it arrives whole.
 */
export const MAX_UPLOAD_BODY_BYTES = DEFAULT_INTAKE_LIMITS.maxBytes + 64 * 1024;

/** The longest `options` part, in characters: well inside the framing allowance. */
export const MAX_OPTIONS_CHARS = 32 * 1024;

/** The longest file name accepted. */
const MAX_FILE_NAME = 255;

const PARTS = new Set(['file', 'options']);

/** A file read from the request: its name and its bytes. */
export interface UploadedFile {
  name: string;
  bytes: Buffer;
}

/** Whether the request is a multipart upload, by its `Content-Type`. */
export function isMultipart(request: Request): boolean {
  return (request.headers.get('content-type') ?? '')
    .toLowerCase()
    .startsWith('multipart/form-data');
}

/**
 * The file and the parsed `options` of a multipart request.
 *
 * @param request - A request {@link isMultipart} accepts
 * @param optionsSchema - The route's other fields; an absent `options` part parses as `{}`
 * @param maxFileBytes - The largest file the route reads
 * @throws APIError 413 `FILE_TOO_LARGE` — the body or the file is too large
 * @throws ValidationError — not a well-formed multipart body, no file, an unknown part, or options that do not fit
 */
export async function readUpload<T>(
  request: Request,
  optionsSchema: z.ZodType<T>,
  maxFileBytes: number = DEFAULT_INTAKE_LIMITS.maxBytes
): Promise<{ file: UploadedFile; options: T }> {
  const tooLarge = tooLargeError(maxFileBytes);
  if (enforceContentLengthCap(request, { ...tooLarge, maxBytes: MAX_UPLOAD_BODY_BYTES })) {
    throw new APIError(tooLarge.errorMessage, tooLarge.errorCode, 413, tooLarge.details);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ValidationError(
      'The body could not be read as multipart/form-data; it may have been cut short.'
    );
  }

  const unknown = [...new Set(form.keys())].filter((key) => !PARTS.has(key));
  if (unknown.length > 0) {
    throw new ValidationError('Send only a file part and an options part', {
      parts: [`Unknown part: ${unknown.join(', ')}`],
    });
  }

  const files = form.getAll('file');
  const file = files[0];
  if (files.length !== 1 || !(file instanceof File)) {
    throw new ValidationError('Send exactly one file, in the `file` part', {
      file: ['Send exactly one file, in the `file` part'],
    });
  }
  const name = file.name.trim();
  if (name.length === 0 || name.length > MAX_FILE_NAME) {
    throw new ValidationError('The file needs a name', {
      file: [`Give the file a name of 1 to ${MAX_FILE_NAME} characters`],
    });
  }
  if (file.size > maxFileBytes) {
    throw new APIError(tooLarge.errorMessage, tooLarge.errorCode, 413, tooLarge.details);
  }

  return {
    file: { name, bytes: Buffer.from(await file.arrayBuffer()) },
    options: parseOptions(form.getAll('options'), optionsSchema),
  };
}

function tooLargeError(maxFileBytes: number) {
  return {
    errorCode: ErrorCodes.FILE_TOO_LARGE,
    errorMessage: `The file is too large: the most read is ${maxFileBytes / 1_048_576} MB.`,
    details: { maxBytes: maxFileBytes },
  };
}

function parseOptions<T>(parts: FormDataEntryValue[], schema: z.ZodType<T>): T {
  if (parts.length > 1) {
    throw new ValidationError('Send at most one options part', {
      options: ['Send at most one options part'],
    });
  }
  const [part] = parts;
  if (part !== undefined && typeof part !== 'string') {
    throw new ValidationError('The options part is JSON text, not a file', {
      options: ['Send options as JSON text, not a file'],
    });
  }
  if (part !== undefined && part.length > MAX_OPTIONS_CHARS) {
    throw new ValidationError('The options part is too long', {
      options: [`${MAX_OPTIONS_CHARS} characters at most`],
    });
  }
  let raw: unknown = {};
  if (part !== undefined) {
    try {
      raw = JSON.parse(part);
    } catch {
      throw new ValidationError('The options part is not valid JSON', {
        options: ['Send options as a JSON object'],
      });
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError('Invalid options', fieldErrorsOf(parsed.error));
  }
  return parsed.data;
}

/** Zod issues as `validateRequestBody` reports a JSON body's, each path under `options`. */
function fieldErrorsOf(error: z.ZodError): Record<string, unknown> {
  return {
    errors: error.issues.map((issue) => ({
      path: ['options', ...issue.path.map(String)].join('.'),
      message: issue.message,
    })),
  };
}

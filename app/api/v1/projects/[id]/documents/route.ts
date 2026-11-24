/**
 * A project's context documents (t-74, D18, app-plan §8.4).
 *
 * GET  /api/v1/projects/{id}/documents — the project's documents, oldest
 *   first, each with its status in the workspace's knowledge base.
 * POST /api/v1/projects/{id}/documents — add one: as JSON, `source` is
 *   `{ url }` (fetched safely, D14), with an optional `title`. A file in the
 *   intake formats is sent as `multipart/form-data` instead (t-80,
 *   `readUpload`): a `file` part, and an optional `options` part holding
 *   `{ title }` as JSON. The text is chunked and embedded
 *   into the workspace's knowledge base before the answer, which is 201 with
 *   the document; the same text already in this project answers 200 with its
 *   existing link, without indexing it again, renamed to `title` when one is
 *   given.
 *
 * Authentication: a browser session, or an API key with the `projects` scope.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — POST: the body does not fit (a file in JSON);
 *   a multipart body with no file, an unknown part, or one that cannot be
 *   parsed, as one cut short.
 * - 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (scope).
 * - 404 `NOT_FOUND` — no such project in this workspace. Another workspace's
 *   id reads the same.
 * - 409 `PROJECT_ARCHIVED` — POST: the project is archived; restore it first.
 * - 409 `TOO_MANY_DOCUMENTS` — POST: the project holds the most it may.
 * - 409 `DOCUMENT_CHANGED` — POST: the knowledge document was deleted while
 *   it was being added; try again.
 * - 413 `FILE_TOO_LARGE`, 415 `INVALID_FILE_TYPE` — POST: the file; a
 *   multipart body over `MAX_UPLOAD_BODY_BYTES`, refused before it is read.
 * - 422 `TEXT_TOO_LONG`, `TOO_MANY_PAGES`, `PDF_HAS_NO_TEXT`, `NO_TEXT`,
 *   `FILE_UNREADABLE` — POST: the file.
 * - 422 `URL_NOT_ALLOWED`, `FETCH_FAILED`, `FETCH_TIMEOUT` — POST: the page.
 * - 429 `RATE_LIMIT_EXCEEDED` — POST: more than
 *   `DOCUMENT_ADDS_PER_INTERVAL` adds in ten minutes, per user. Every valid
 *   add counts, including one refused or answered from an existing link:
 *   each still reads its file or fetches its page.
 * - 502 `DOCUMENT_NOT_INDEXED` — POST: read, but could not be embedded.
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { createRateLimitResponse } from '@/lib/security/rate-limit';
import { projectsRoute } from '@/lib/app/projects/route-auth';
import { addProjectDocument, listProjectDocuments } from '@/lib/app/projects/documents';
import { documentAddLimiter } from '@/lib/app/projects/document-limiter';
import {
  addDocumentSchema,
  documentUploadOptionsSchema,
  MAX_DOCUMENT_BYTES,
  projectIdParamSchema,
  type AddDocumentRequest,
} from '@/lib/app/projects/validations';
import { isMultipart, readUpload } from '@/lib/app/intake/upload';

type Params = { id: string };

/** Long enough to read, fetch and embed a long document within the request. */
export const maxDuration = 300;

async function idOf(params: Promise<Params>): Promise<string> {
  return validateQueryParams(new URLSearchParams(await params), projectIdParamSchema).id;
}

/** The request as the service takes it: a JSON body, or a file and its options. */
async function bodyOf(request: NextRequest): Promise<AddDocumentRequest> {
  if (!isMultipart(request)) return validateRequestBody(request, addDocumentSchema);
  const { file, options } = await readUpload(
    request,
    documentUploadOptionsSchema,
    MAX_DOCUMENT_BYTES
  );
  return { ...options, source: { file } };
}

export const GET = withAuth<Params>(async (_request: NextRequest, _session, { params }) => {
  return successResponse(await listProjectDocuments(await idOf(params)));
}, projectsRoute<Params>());

export const POST = withAuth<Params>(async (request: NextRequest, session, { params }) => {
  const id = await idOf(params);
  const body = await bodyOf(request);
  const limit = documentAddLimiter.check(`user:${session.user.id}`);
  if (!limit.success) return createRateLimitResponse(limit);
  const { document, added } = await addProjectDocument(id, body, session.user.id);
  return successResponse(document, undefined, { status: added ? 201 : 200 });
}, projectsRoute<Params>());

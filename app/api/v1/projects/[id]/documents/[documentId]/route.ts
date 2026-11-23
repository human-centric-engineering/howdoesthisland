/**
 * One of a project's context documents (t-74).
 *
 * DELETE /api/v1/projects/{id}/documents/{documentId} — remove it from the
 *   project. The document leaves the workspace's knowledge base too only when
 *   this app's upload put it there, no other project links it, and no agent is
 *   granted it; otherwise only the link goes. The answer says which
 *   (`knowledgeDocumentDeleted`).
 *
 * Authentication: a browser session, or an API key with the `projects` scope.
 *
 * Errors:
 * - 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (scope).
 * - 404 `NOT_FOUND` — no such project in this workspace, or no such document
 *   in it. Another workspace's ids read the same.
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { projectsRoute } from '@/lib/app/projects/route-auth';
import { removeProjectDocument } from '@/lib/app/projects/documents';
import { projectDocumentParamSchema } from '@/lib/app/projects/validations';

type Params = { id: string; documentId: string };

export const DELETE = withAuth<Params>(async (_request: NextRequest, _session, { params }) => {
  const { id, documentId } = validateQueryParams(
    new URLSearchParams(await params),
    projectDocumentParamSchema
  );
  return successResponse(await removeProjectDocument(id, documentId));
}, projectsRoute<Params>());

/**
 * The workspace's projects (t-70, f-projects).
 *
 * POST /api/v1/projects — make a project: a name, a brief, the defaults its
 *   reviews take, its weighting (`overlay`, t-72), and the framework they are
 *   scored with.
 * GET  /api/v1/projects — the workspace's projects, newest first. Archived
 *   ones only with `archived=true`.
 *
 * Authentication: a browser session, or an API key with the `projects`
 * scope. Everything is the workspace the caller acts in; any member may make
 * one.
 *
 * POST errors:
 * - 400 `VALIDATION_ERROR` — the body does not fit the schema.
 * - 400 `DEFAULTS_INVALID` — the defaults name an id or profile the
 *   framework's latest version lacks; `details.issues` gives each path.
 * - 400 `OVERLAY_INVALID` — the weighting does not fit the bounds the
 *   framework's latest version declares, or it declares none.
 * - 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (scope).
 * - 404 `FRAMEWORK_NOT_FOUND` / `FRAMEWORK_VERSION_NOT_FOUND` — no such
 *   framework, or none of its versions is published.
 *
 * GET query: `page`, `limit` (≤ 100), `archived`. GET errors: 400
 * `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (scope).
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { paginatedResponse, successResponse } from '@/lib/api/responses';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { projectsRoute } from '@/lib/app/projects/route-auth';
import { createProject, listProjects } from '@/lib/app/projects/service';
import { createProjectSchema, listProjectsQuerySchema } from '@/lib/app/projects/validations';

export const POST = withAuth(async (request: NextRequest, session) => {
  const body = await validateRequestBody(request, createProjectSchema);
  return successResponse(await createProject(body, session.user.id), undefined, { status: 201 });
}, projectsRoute());

export const GET = withAuth(async (request: NextRequest) => {
  const query = validateQueryParams(request.nextUrl.searchParams, listProjectsQuerySchema);
  const { items, total } = await listProjects(query);
  return paginatedResponse(items, { page: query.page, limit: query.limit, total });
}, projectsRoute());

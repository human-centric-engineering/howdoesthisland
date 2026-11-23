/**
 * One of the workspace's projects (t-70).
 *
 * GET    /api/v1/projects/{id} — the project.
 * PATCH  /api/v1/projects/{id} — change its name, brief, defaults or
 *   weighting (`overlay`, t-72; each replaced whole, `overlay: null` or `{}`
 *   clears it), or archive or restore it (`archived`).
 * DELETE /api/v1/projects/{id} — archive it. Its reviews keep their link,
 *   and `PATCH { archived: false }` restores it.
 *
 * Authentication: a browser session, or an API key with the `projects` scope.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — PATCH: the body does not fit, or changes nothing.
 * - 400 `DEFAULTS_INVALID` — PATCH: the defaults name an id or profile the
 *   framework's latest version lacks; `details.issues` gives each path.
 * - 400 `OVERLAY_INVALID` — PATCH: the weighting does not fit the bounds the
 *   framework's latest version declares, or it declares none;
 *   `details.issues` gives each path (`overlay.weights.ethos`).
 * - 401 `UNAUTHORIZED`, 403 `FORBIDDEN` (scope).
 * - 404 `NOT_FOUND` — no such project in this workspace. Another workspace's
 *   id reads the same, so an id is not confirmed to an outsider.
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { projectsRoute } from '@/lib/app/projects/route-auth';
import { archiveProject, getProject, updateProject } from '@/lib/app/projects/service';
import { projectIdParamSchema, updateProjectSchema } from '@/lib/app/projects/validations';

type Params = { id: string };

async function idOf(params: Promise<Params>): Promise<string> {
  return validateQueryParams(new URLSearchParams(await params), projectIdParamSchema).id;
}

export const GET = withAuth<Params>(async (_request: NextRequest, _session, { params }) => {
  return successResponse(await getProject(await idOf(params)));
}, projectsRoute<Params>());

export const PATCH = withAuth<Params>(async (request: NextRequest, _session, { params }) => {
  const id = await idOf(params);
  const body = await validateRequestBody(request, updateProjectSchema);
  return successResponse(await updateProject(id, body));
}, projectsRoute<Params>());

export const DELETE = withAuth<Params>(async (_request: NextRequest, _session, { params }) => {
  return successResponse(await archiveProject(await idOf(params)));
}, projectsRoute<Params>());

/**
 * A workspace's own settings: its retention windows (t-26, D10)
 *
 * GET   /api/v1/workspaces/[id]/settings — the windows in force.
 * PATCH /api/v1/workspaces/[id]/settings — `{ retention?, judgeReplyRetention? }`.
 *   - `retention`: `{ days }` (1–3650) to delete content and its assessments
 *     that many days after they were made, or `null` to keep them.
 *   - `judgeReplyRetention`: `{ days }` (1–365) to delete each judge's reply
 *     that many days after it was saved, or `null` for the default, 30.
 *   A key left out is unchanged. Answers the windows in force, as `GET` does.
 *   `judgeReplyRetention` reads `null` only when the stored window is
 *   unreadable: no reply is deleted until it is set again.
 *
 * These are the app's (`Org.settings.app`). Core's per-org `retention`
 * slice, set on core's org settings, governs core's own history and is left
 * as it is.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — neither key, a window off its range, or a key
 *   this route does not set.
 * - 400 `WORKSPACES_UNAVAILABLE` — `TENANCY_MODE=single`.
 * - 401 `UNAUTHORIZED` — no session.
 * - 403 `FORBIDDEN` — an API key, a `MEMBER`, someone outside the workspace,
 *   or a workspace that does not exist (the policy's one answer).
 * - 404 `NOT_FOUND` — the workspace was deleted between the check and the read
 *   or write.
 *
 * Who may call it is the authorization policy's, through the same org
 * `resource` core's org routes hand the guard: the workspace's `OWNER` or
 * `ADMIN` while acting in it, or a platform admin.
 */
import type { NextRequest } from 'next/server';
import { withAuth, type AuthSession } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { successResponse, errorResponse } from '@/lib/api/responses';
import { ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { orgIdParamSchema } from '@/lib/validations/tenancy';
import { resolveOrgResource } from '@/lib/tenancy/lifecycle';
import { isMultiTenant } from '@/lib/tenancy/context';
import { prisma } from '@/lib/db/client';
import {
  readWorkspaceSettings,
  updateWorkspaceSettingsSchema,
  writeWorkspaceSettings,
} from '@/lib/app/retention/settings';

const RESOURCE = {
  resource: async (_request: unknown, context?: { params: Promise<{ id: string }> }) =>
    resolveOrgResource(await context?.params),
  ownership: {
    decidedBy: 'resource',
    because:
      "The policy admitted the caller to the workspace the URL names; only that resolved org's settings are read or written.",
  },
} as const;

/** What neither method serves: an API key (throws 403), or a single-tenant install. */
function refused(session: AuthSession): Response | null {
  if (isApiKeySession(session)) {
    throw new ForbiddenError('Workspace settings require a browser session');
  }
  if (!isMultiTenant()) {
    return errorResponse('Workspaces are not available on this install', {
      code: 'WORKSPACES_UNAVAILABLE',
      status: 400,
    });
  }
  return null;
}

async function orgIdOf(params: Promise<{ id: string }>): Promise<string> {
  return validateQueryParams(new URLSearchParams(await params), orgIdParamSchema).id;
}

export const GET = withAuth<{ id: string }>(async (_request: NextRequest, session, { params }) => {
  const stop = refused(session);
  if (stop) return stop;
  const id = await orgIdOf(params);

  // `Org` is a system model: this read needs no tenant scope.
  const org = await prisma.org.findUnique({ where: { id }, select: { settings: true } });
  if (!org) throw new NotFoundError('Workspace not found');
  return successResponse(readWorkspaceSettings(org.settings, id));
}, RESOURCE);

export const PATCH = withAuth<{ id: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const stop = refused(session);
  if (stop) return stop;
  const id = await orgIdOf(params);
  const body = await validateRequestBody(request, updateWorkspaceSettingsSchema);

  const written = await writeWorkspaceSettings(id, body);
  if (!written) throw new NotFoundError('Workspace not found');

  log.info('Workspace retention set', {
    orgId: id,
    retentionDays: written.retention?.days ?? null,
    judgeReplyDays: written.judgeReplyRetention?.days ?? null,
    userId: session.user.id,
  });
  return successResponse(written);
}, RESOURCE);

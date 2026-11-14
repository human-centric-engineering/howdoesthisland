/**
 * Who may reach the judges routes, and the org they then run in (j4, D8).
 *
 * Shared by `GET /api/v1/workspaces/[id]/judges` and `PATCH …/judges/[key]`
 * so the access rule is written once.
 *
 * The guard runs a handler in the org the session entered. The policy also
 * admits a platform admin to a workspace they are not acting in, and that
 * workspace's agents, provider grants and availability have to be read in
 * its own tenant context, not the session's. So the handler body runs
 * through {@link inWorkspace}, which enters the workspace the URL names when
 * it is not the one already entered.
 */
import type { AuthSession } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { ForbiddenError } from '@/lib/api/errors';
import { errorResponse } from '@/lib/api/responses';
import { resolveOrgResource } from '@/lib/tenancy/lifecycle';
import { getTenantContext, isMultiTenant, runAsOrg } from '@/lib/tenancy/context';

/** The guard options both routes hand `withAuth`: the org the URL names. */
export const WORKSPACE_JUDGES_RESOURCE = {
  resource: async (_request: unknown, context?: { params: Promise<{ id: string }> }) =>
    resolveOrgResource(await context?.params),
  ownership: {
    decidedBy: 'resource',
    because:
      "The policy admitted the caller to the workspace the URL names; only that resolved org's agents are read or written.",
  },
} as const;

/**
 * Refuse what the routes never serve: an API-key session (throws a 403), and
 * a single-tenant install (answers `WORKSPACES_UNAVAILABLE`). `null` to go on.
 */
export function refuseJudgesRequest(session: AuthSession): Response | null {
  if (isApiKeySession(session)) {
    throw new ForbiddenError('Choosing judge models requires a browser session');
  }
  if (!isMultiTenant()) {
    return errorResponse('Workspaces are not available on this install', {
      code: 'WORKSPACES_UNAVAILABLE',
      status: 400,
    });
  }
  return null;
}

/** Run `fn` in `orgId`'s tenant context, entering it if it is not the current one. */
export function inWorkspace<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  const current = getTenantContext();
  if (current?.orgId === orgId) return fn();
  return runAsOrg(orgId, fn, { source: 'session', role: null });
}

/**
 * Who may reach the judges routes, and the org they then run in (j4, D8).
 *
 * Shared by `GET /api/v1/workspaces/[id]/judges` and `PATCH …/judges/[key]`
 * so the access rule is written once.
 *
 * The guard runs a handler in the org the session entered, and the policy
 * also admits a platform admin to a workspace they are not acting in. The
 * workspace's agents, provider grants and availability are only read
 * correctly in its own tenant context, and entering it here would skip what
 * the guard checks on entry (the org's status, a platform admin's support
 * grant and its stamp). So the routes serve only the org the caller entered:
 * {@link requireEnteredWorkspace} refuses any other. A platform admin reaches
 * a workspace by entering it, under its support grant.
 */
import type { AuthSession } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { ForbiddenError } from '@/lib/api/errors';
import { errorResponse } from '@/lib/api/responses';
import { resolveOrgResource } from '@/lib/tenancy/lifecycle';
import { getTenantContext, isMultiTenant } from '@/lib/tenancy/context';

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

/** Refuse (403) unless the request entered the workspace the URL names. */
export function requireEnteredWorkspace(orgId: string): void {
  if (getTenantContext()?.orgId !== orgId) {
    throw new ForbiddenError('Switch to this workspace to choose its judge models');
  }
}

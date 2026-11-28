/**
 * Who may reach a workspace's webhook routes, and the org they run in (t-99).
 *
 * The rule the MCP-key routes follow (`lib/app/workspaces/mcp-keys-access.ts`),
 * for the same reasons: the authorization policy admits the workspace's
 * `OWNER` or `ADMIN` (or a platform admin) to the org the URL names, a
 * subscription's secret is a credential minted in the org the request entered,
 * and an API key must not mint credentials. So the routes take a browser
 * session only, and serve only the workspace the caller entered.
 */
import type { AuthSession } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { ForbiddenError } from '@/lib/api/errors';
import { errorResponse } from '@/lib/api/responses';
import { resolveOrgResource } from '@/lib/tenancy/lifecycle';
import { getTenantContext, isMultiTenant } from '@/lib/tenancy/context';

/** The guard options every webhook route hands `withAuth`: the org the URL names. */
export const EVENT_SUBSCRIPTIONS_RESOURCE = {
  resource: async (_request: unknown, context?: { params: Promise<{ id: string }> }) =>
    resolveOrgResource(await context?.params),
  ownership: {
    decidedBy: 'resource',
    because:
      "The policy admitted the caller to the workspace the URL names; only that resolved org's webhooks are read or changed.",
  },
} as const;

/**
 * Refuse what the routes never serve: an API-key session (throws a 403), and
 * a single-tenant install (answers `WORKSPACES_UNAVAILABLE`). `null` to go on.
 */
export function refuseEventSubscriptionsRequest(session: AuthSession): Response | null {
  if (isApiKeySession(session)) {
    throw new ForbiddenError('Managing webhooks requires a browser session');
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
    throw new ForbiddenError('Switch to this workspace to manage its webhooks');
  }
}

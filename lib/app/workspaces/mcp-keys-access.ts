/**
 * Who may reach a workspace's MCP-key routes, and the org they run in (t-95).
 *
 * Shared by `…/mcp-keys` and `…/mcp-keys/[keyId]/revoke` so the rule is
 * written once. The same shape as the judges routes
 * (`lib/app/judges/route-access.ts`), for the same reason: the policy admits a
 * platform admin to a workspace they are not acting in, and a key is minted in
 * the org the request entered (`orgForMint`). So the routes serve only the
 * workspace the caller entered.
 */
import type { AuthSession } from '@/lib/auth/guards';
import { isApiKeySession } from '@/lib/auth/api-keys';
import { ForbiddenError } from '@/lib/api/errors';
import { errorResponse } from '@/lib/api/responses';
import { resolveOrgResource } from '@/lib/tenancy/lifecycle';
import { getTenantContext, isMultiTenant } from '@/lib/tenancy/context';

/** The guard options both routes hand `withAuth`: the org the URL names. */
export const WORKSPACE_MCP_KEYS_RESOURCE = {
  resource: async (_request: unknown, context?: { params: Promise<{ id: string }> }) =>
    resolveOrgResource(await context?.params),
  ownership: {
    decidedBy: 'resource',
    because:
      "The policy admitted the caller to the workspace the URL names; only that resolved org's MCP keys are read, made or revoked.",
  },
} as const;

/**
 * Refuse what the routes never serve: an API-key session (throws a 403; a key
 * must not mint keys), and a single-tenant install (answers
 * `WORKSPACES_UNAVAILABLE`). `null` to go on.
 */
export function refuseMcpKeysRequest(session: AuthSession): Response | null {
  if (isApiKeySession(session)) {
    throw new ForbiddenError('Managing MCP keys requires a browser session');
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
    throw new ForbiddenError('Switch to this workspace to manage its MCP keys');
  }
}

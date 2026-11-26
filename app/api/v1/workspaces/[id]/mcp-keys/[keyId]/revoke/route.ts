/**
 * Revoke one of a workspace's MCP keys (t-95)
 *
 * POST /api/v1/workspaces/[id]/mcp-keys/[keyId]/revoke — the key stops
 * authenticating at once. The row is kept, inactive, so the list and the MCP
 * audit log still name it. Revoking a revoked key answers it unchanged.
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a malformed id.
 * - 400 `WORKSPACES_UNAVAILABLE` — `TENANCY_MODE=single`.
 * - 401 `UNAUTHORIZED` — no session.
 * - 403 `FORBIDDEN` — as `GET …/mcp-keys`.
 * - 404 `NOT_FOUND` — no such key in this workspace, another workspace's
 *   among them.
 *
 * Who may call it: as `…/mcp-keys` (`lib/app/workspaces/mcp-keys-access.ts`).
 */
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { revokeWorkspaceMcpKey, workspaceMcpKeyParamsSchema } from '@/lib/app/workspaces/mcp-keys';
import {
  WORKSPACE_MCP_KEYS_RESOURCE,
  refuseMcpKeysRequest,
  requireEnteredWorkspace,
} from '@/lib/app/workspaces/mcp-keys-access';

export const POST = withAuth<{ id: string; keyId: string }>(
  async (request, session, { params }) => {
    const log = await getRouteLogger(request);
    const refused = refuseMcpKeysRequest(session);
    if (refused) return refused;
    const { id, keyId } = validateQueryParams(
      new URLSearchParams(await params),
      workspaceMcpKeyParamsSchema
    );
    requireEnteredWorkspace(id);

    const { key, changed } = await revokeWorkspaceMcpKey(id, keyId);
    if (changed) {
      log.info('Workspace MCP key revoked', {
        orgId: id,
        keyId,
        keyPrefix: key.keyPrefix,
        userId: session.user.id,
      });
      logAdminAction({
        userId: session.user.id,
        action: 'mcp_api_key.update',
        entityType: 'mcp_api_key',
        entityId: keyId,
        entityName: key.name,
        changes: { isActive: { from: true, to: false } },
        clientIp: getClientIP(request),
      });
    }
    return successResponse({ key });
  },
  WORKSPACE_MCP_KEYS_RESOURCE
);

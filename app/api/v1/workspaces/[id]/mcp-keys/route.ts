/**
 * A workspace's MCP keys (t-95)
 *
 * GET  /api/v1/workspaces/[id]/mcp-keys — the workspace's keys, newest first,
 *   revoked ones included. Never a key's value or hash.
 * POST /api/v1/workspaces/[id]/mcp-keys — `{ name, expiresAt? }`. Makes a key
 *   that can list and call the MCP tools (`tools:list`, `tools:execute`) and
 *   nothing wider, acting as the caller. Answers its value once
 *   (`plaintext`); it cannot be read again.
 *
 * The key is bound to the workspace and dispatches as `mcp-system` (no scoped
 * agent). Every spending tool charges the workspace's credits, which is the
 * bound on what a key can spend (`lib/app/workspaces/mcp-keys.ts`).
 *
 * Errors:
 * - 400 `VALIDATION_ERROR` — a missing name, an expiry not in the future, or
 *   a field this route does not take (scopes among them).
 * - 400 `WORKSPACES_UNAVAILABLE` — `TENANCY_MODE=single`.
 * - 401 `UNAUTHORIZED` — no session.
 * - 403 `FORBIDDEN` — an API key, a `MEMBER`, someone outside the workspace,
 *   a caller acting in another workspace, a workspace that does not exist, or
 *   (on `POST`) a support session.
 *
 * Who may call it is the authorization policy's, through the org `resource`
 * core's members routes hand the guard: the workspace's `OWNER` or `ADMIN`
 * while acting in it, or a platform admin who has entered it. A platform admin
 * under a support grant can list and revoke, but not make a key
 * (`orgForMint`): a key outlives the session, and would act as someone who is
 * not a member.
 */
import { withAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { orgIdParamSchema } from '@/lib/validations/tenancy';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import {
  createWorkspaceMcpKey,
  createWorkspaceMcpKeySchema,
  listWorkspaceMcpKeys,
} from '@/lib/app/workspaces/mcp-keys';
import {
  WORKSPACE_MCP_KEYS_RESOURCE,
  refuseMcpKeysRequest,
  requireEnteredWorkspace,
} from '@/lib/app/workspaces/mcp-keys-access';

export const GET = withAuth<{ id: string }>(async (_request, session, { params }) => {
  const refused = refuseMcpKeysRequest(session);
  if (refused) return refused;
  const { id } = validateQueryParams(new URLSearchParams(await params), orgIdParamSchema);
  requireEnteredWorkspace(id);
  return successResponse({ keys: await listWorkspaceMcpKeys(id) });
}, WORKSPACE_MCP_KEYS_RESOURCE);

export const POST = withAuth<{ id: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const refused = refuseMcpKeysRequest(session);
  if (refused) return refused;
  const { id } = validateQueryParams(new URLSearchParams(await params), orgIdParamSchema);
  requireEnteredWorkspace(id);
  const body = await validateRequestBody(request, createWorkspaceMcpKeySchema);

  const { key, plaintext } = await createWorkspaceMcpKey({
    orgId: id,
    createdBy: session.user.id,
    body,
  });

  log.info('Workspace MCP key created', {
    orgId: id,
    keyId: key.id,
    keyPrefix: key.keyPrefix,
    userId: session.user.id,
  });
  logAdminAction({
    userId: session.user.id,
    action: 'mcp_api_key.create',
    entityType: 'mcp_api_key',
    entityId: key.id,
    entityName: key.name,
    metadata: { keyPrefix: key.keyPrefix, scopes: key.scopes },
    clientIp: getClientIP(request),
  });

  return successResponse({ key: { ...key, plaintext } }, undefined, { status: 201 });
}, WORKSPACE_MCP_KEYS_RESOURCE);

/**
 * The shapes the MCP-keys panel reads from
 * `/api/v1/workspaces/[id]/mcp-keys` (t-95), validated rather than cast.
 */
import { z } from 'zod';

export const mcpKeysEndpoint = (orgId: string): string =>
  `/api/v1/workspaces/${encodeURIComponent(orgId)}/mcp-keys`;

export const revokeMcpKeyEndpoint = (orgId: string, keyId: string): string =>
  `${mcpKeysEndpoint(orgId)}/${encodeURIComponent(keyId)}/revoke`;

/** One key, as `WorkspaceMcpKey` in `lib/app/workspaces/mcp-keys.ts` on the wire. */
export const mcpKeyRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  isActive: z.boolean(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
});

export type McpKeyRow = z.infer<typeof mcpKeyRowSchema>;

export const mcpKeyListSchema = z.object({ keys: z.array(mcpKeyRowSchema) });

/** `POST …/mcp-keys` data: the new key, with its value shown once. */
export const mintedMcpKeySchema = z.object({
  key: mcpKeyRowSchema.extend({ plaintext: z.string() }),
});

/** The least of a mint response that still shows the new key's value. */
export const mintedMcpRawKeySchema = z.object({
  key: z.object({ name: z.string(), plaintext: z.string() }),
});

/** `POST …/revoke` data. */
export const revokedMcpKeySchema = z.object({ key: mcpKeyRowSchema });

export type McpKeyState = 'active' | 'expired' | 'revoked';

export function mcpKeyState(
  key: Pick<McpKeyRow, 'isActive' | 'expiresAt'>,
  now: Date
): McpKeyState {
  if (!key.isActive) return 'revoked';
  if (key.expiresAt && new Date(key.expiresAt) <= now) return 'expired';
  return 'active';
}

/**
 * A workspace's own MCP keys (t-95): list, make and revoke them from the
 * workspace's settings rather than `/admin`.
 *
 * Built on core's key helpers, unedited: `generateApiKey` mints the value and
 * its hash, and `orgForMint` names the org the request acts in (and refuses a
 * support session, so a platform admin entering under a grant cannot leave a
 * credential behind).
 *
 * **A key made here can only list and call tools** (`WORKSPACE_MCP_KEY_SCOPES`).
 * It has no `scopedAgentId`, so it dispatches as `mcp-system`, and no `scope`
 * or rate-limit override. What it can spend is bounded by the workspace's
 * credits, since every spending tool charges them, and it acts as the person
 * who made it (`McpApiKey.createdBy`, see `.context/app/mcp.md`).
 *
 * **Revoking deactivates the row; it never deletes it.** `McpAuditLog` rows
 * point at the key, and the list keeps showing a revoked key so the workspace
 * can see what it turned off.
 *
 * Every query names the workspace as well as the row's id, so a key of another
 * workspace reads as not found even where row isolation is not enabled.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { NotFoundError } from '@/lib/api/errors';
import { generateApiKey } from '@/lib/orchestration/mcp/auth';
import { cuidSchema } from '@/lib/validations/common';
import { orgIdParamSchema } from '@/lib/validations/tenancy';
import { orgForMint } from '@/lib/tenancy/entry';

/** The protocol scopes the app's MCP tools need, and nothing wider. */
export const WORKSPACE_MCP_KEY_SCOPES = ['tools:list', 'tools:execute'] as const;

/** Body of `POST /api/v1/workspaces/[id]/mcp-keys`. */
export const createWorkspaceMcpKeySchema = z
  .object({
    name: z.string().trim().min(1, 'Give the key a name').max(100),
    /** ISO 8601. Left out or `null`: the key lasts until it is revoked. */
    expiresAt: z.iso
      .datetime({ offset: true })
      .refine((at) => Date.parse(at) > Date.now(), 'Expiration must be in the future')
      .nullable()
      .optional(),
  })
  .strict();

export type CreateWorkspaceMcpKey = z.infer<typeof createWorkspaceMcpKeySchema>;

/** `[keyId]` of `…/mcp-keys/[keyId]/revoke`, with the workspace's `id`. */
export const workspaceMcpKeyParamsSchema = orgIdParamSchema.extend({ keyId: cuidSchema });

const KEY_SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  scopes: true,
  isActive: true,
  expiresAt: true,
  lastUsedAt: true,
  createdAt: true,
  creator: { select: { name: true } },
} as const;

/** One key as the workspace sees it. Never its hash. */
export interface WorkspaceMcpKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  /** Who made it, which is who its tool calls act as; `null` once they have gone. */
  createdByName: string | null;
}

type KeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  creator: { name: string } | null;
};

function toView({ creator, ...row }: KeyRow): WorkspaceMcpKey {
  return { ...row, createdByName: creator?.name ?? null };
}

/** The workspace's keys, newest first, revoked ones included. */
export async function listWorkspaceMcpKeys(orgId: string): Promise<WorkspaceMcpKey[]> {
  const rows = await prisma.mcpApiKey.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    select: KEY_SELECT,
  });
  return rows.map(toView);
}

/**
 * Make a key in the workspace the request acts in, as `createdBy`. Answers the
 * plaintext once; only its hash is stored.
 *
 * `orgId` is the workspace the route resolved; it must be the one the request
 * entered (`orgForMint`), which the route has already required.
 */
export async function createWorkspaceMcpKey(input: {
  orgId: string;
  createdBy: string;
  body: CreateWorkspaceMcpKey;
}): Promise<{ key: WorkspaceMcpKey; plaintext: string }> {
  const mintOrg = orgForMint();
  if (mintOrg !== input.orgId) {
    // The route requires the entered workspace first; this is the backstop.
    throw new NotFoundError('Workspace not found');
  }
  const { plaintext, hash, prefix } = generateApiKey();
  const row = await prisma.mcpApiKey.create({
    data: {
      name: input.body.name,
      keyHash: hash,
      keyPrefix: prefix,
      scopes: [...WORKSPACE_MCP_KEY_SCOPES],
      expiresAt: input.body.expiresAt ? new Date(input.body.expiresAt) : null,
      createdBy: input.createdBy,
      orgId: mintOrg,
    },
    select: KEY_SELECT,
  });
  return { key: toView(row), plaintext };
}

/**
 * Revoke one of the workspace's keys: it stops authenticating at once.
 * Revoking a key already revoked answers it unchanged. A key of another
 * workspace, or none, is not found.
 */
export async function revokeWorkspaceMcpKey(
  orgId: string,
  keyId: string
): Promise<{ key: WorkspaceMcpKey; changed: boolean }> {
  const existing = await prisma.mcpApiKey.findFirst({
    where: { id: keyId, orgId },
    select: KEY_SELECT,
  });
  if (!existing) throw new NotFoundError('MCP key not found');
  if (!existing.isActive) return { key: toView(existing), changed: false };

  const { count } = await prisma.mcpApiKey.updateMany({
    where: { id: keyId, orgId },
    data: { isActive: false },
  });
  if (count === 0) throw new NotFoundError('MCP key not found');
  return { key: toView({ ...existing, isActive: false }), changed: true };
}

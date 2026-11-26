/**
 * Tests: a workspace's MCP keys (t-95): list, make, revoke.
 *
 * `generateApiKey` is real (pure), so what reaches prisma is checked against
 * the value it really made: the hash is stored, the plaintext is not.
 *
 * @see lib/app/workspaces/mcp-keys.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('@/lib/db/client', () => ({
  prisma: {
    mcpApiKey: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  },
}));
const orgForMint = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tenancy/entry', () => ({ orgForMint }));

import {
  WORKSPACE_MCP_KEY_SCOPES,
  createWorkspaceMcpKey,
  createWorkspaceMcpKeySchema,
  listWorkspaceMcpKeys,
  revokeWorkspaceMcpKey,
  workspaceMcpKeyParamsSchema,
} from '@/lib/app/workspaces/mcp-keys';
import { ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';

const ORG = 'cmorg000000000000000team1';
const OTHER_ORG = 'cmorg0000000000000000org2';
const USER = 'cmuser00000000000000user1';
const KEY_ID = 'cmkey000000000000000key01';

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: KEY_ID,
    name: 'Sam’s Claude',
    keyPrefix: 'smcp_abcdefg',
    scopes: ['tools:list', 'tools:execute'],
    isActive: true,
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    creator: { name: 'Sam' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  orgForMint.mockReturnValue(ORG);
});

describe('listWorkspaceMcpKeys', () => {
  it('reads only the workspace’s keys, newest first, and flattens the creator', async () => {
    vi.mocked(prisma.mcpApiKey.findMany).mockResolvedValue([
      dbRow(),
      dbRow({ id: 'k2', creator: null, isActive: false }),
    ] as never);

    const keys = await listWorkspaceMcpKeys(ORG);

    const args = vi.mocked(prisma.mcpApiKey.findMany).mock.calls[0]?.[0];
    expect(args?.where).toEqual({ orgId: ORG });
    expect(args?.orderBy).toEqual({ createdAt: 'desc' });
    // The select never asks for the hash.
    expect(args?.select).not.toHaveProperty('keyHash');
    expect(keys[0]).toMatchObject({ id: KEY_ID, createdByName: 'Sam' });
    expect(keys[0]).not.toHaveProperty('creator');
    expect(keys[1]).toMatchObject({ id: 'k2', createdByName: null, isActive: false });
  });
});

describe('createWorkspaceMcpKey', () => {
  it('stores the hash, the fixed scopes, the org and the maker, and answers the plaintext once', async () => {
    vi.mocked(prisma.mcpApiKey.create).mockResolvedValue(dbRow() as never);

    const { key, plaintext } = await createWorkspaceMcpKey({
      orgId: ORG,
      createdBy: USER,
      body: { name: 'Sam’s Claude', expiresAt: '2027-02-15T12:00:00.000Z' },
    });

    const args = vi.mocked(prisma.mcpApiKey.create).mock.calls[0]?.[0];
    expect(args?.data).toEqual({
      name: 'Sam’s Claude',
      keyHash: createHash('sha256').update(plaintext).digest('hex'),
      keyPrefix: plaintext.slice(0, 12),
      scopes: ['tools:list', 'tools:execute'],
      expiresAt: new Date('2027-02-15T12:00:00.000Z'),
      createdBy: USER,
      orgId: ORG,
    });
    expect(args?.data).not.toHaveProperty('scopedAgentId');
    expect(args?.data).not.toHaveProperty('rateLimitOverride');
    expect(Object.values(args?.data ?? {})).not.toContain(plaintext);
    expect(plaintext.startsWith('smcp_')).toBe(true);
    expect(key).not.toHaveProperty('keyHash');
    expect(key).not.toHaveProperty('plaintext');
    expect(key.createdByName).toBe('Sam');
  });

  it('never stores a different scope list than the constant, and hands out a copy', async () => {
    vi.mocked(prisma.mcpApiKey.create).mockResolvedValue(dbRow() as never);
    await createWorkspaceMcpKey({ orgId: ORG, createdBy: USER, body: { name: 'x' } });
    const scopes = vi.mocked(prisma.mcpApiKey.create).mock.calls[0]?.[0].data.scopes;
    expect(scopes).toEqual([...WORKSPACE_MCP_KEY_SCOPES]);
    expect(scopes).not.toBe(WORKSPACE_MCP_KEY_SCOPES);
  });

  it('stores no expiry when none is given or it is null', async () => {
    vi.mocked(prisma.mcpApiKey.create).mockResolvedValue(dbRow() as never);
    await createWorkspaceMcpKey({ orgId: ORG, createdBy: USER, body: { name: 'a' } });
    await createWorkspaceMcpKey({
      orgId: ORG,
      createdBy: USER,
      body: { name: 'b', expiresAt: null },
    });
    for (const call of vi.mocked(prisma.mcpApiKey.create).mock.calls) {
      expect(call[0].data.expiresAt).toBeNull();
    }
  });

  it('makes a different key each time', async () => {
    vi.mocked(prisma.mcpApiKey.create).mockResolvedValue(dbRow() as never);
    const a = await createWorkspaceMcpKey({ orgId: ORG, createdBy: USER, body: { name: 'a' } });
    const b = await createWorkspaceMcpKey({ orgId: ORG, createdBy: USER, body: { name: 'a' } });
    expect(a.plaintext).not.toBe(b.plaintext);
  });

  it('refuses, writing nothing, when the request entered another workspace', async () => {
    orgForMint.mockReturnValue(OTHER_ORG);
    await expect(
      createWorkspaceMcpKey({ orgId: ORG, createdBy: USER, body: { name: 'x' } })
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.mcpApiKey.create).not.toHaveBeenCalled();
  });

  it('propagates a refusal from orgForMint (a support session)', async () => {
    orgForMint.mockImplementation(() => {
      throw new Error('support');
    });
    await expect(
      createWorkspaceMcpKey({ orgId: ORG, createdBy: USER, body: { name: 'x' } })
    ).rejects.toThrow('support');
    expect(prisma.mcpApiKey.create).not.toHaveBeenCalled();
  });
});

describe('revokeWorkspaceMcpKey', () => {
  it('deactivates the key, scoped by id and org, and answers it inactive', async () => {
    vi.mocked(prisma.mcpApiKey.findFirst).mockResolvedValue(dbRow() as never);
    vi.mocked(prisma.mcpApiKey.updateMany).mockResolvedValue({ count: 1 });

    const { key, changed } = await revokeWorkspaceMcpKey(ORG, KEY_ID);

    expect(vi.mocked(prisma.mcpApiKey.findFirst).mock.calls[0]?.[0]?.where).toEqual({
      id: KEY_ID,
      orgId: ORG,
    });
    expect(prisma.mcpApiKey.updateMany).toHaveBeenCalledWith({
      where: { id: KEY_ID, orgId: ORG, isActive: true },
      data: { isActive: false },
    });
    expect(changed).toBe(true);
    expect(key.isActive).toBe(false);
  });

  it('reads another workspace’s key as not found, writing nothing', async () => {
    vi.mocked(prisma.mcpApiKey.findFirst).mockResolvedValue(null);
    await expect(revokeWorkspaceMcpKey(OTHER_ORG, KEY_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.mcpApiKey.updateMany).not.toHaveBeenCalled();
  });

  it('answers an already revoked key unchanged, writing nothing', async () => {
    vi.mocked(prisma.mcpApiKey.findFirst).mockResolvedValue(dbRow({ isActive: false }) as never);
    const { key, changed } = await revokeWorkspaceMcpKey(ORG, KEY_ID);
    expect(changed).toBe(false);
    expect(key.isActive).toBe(false);
    expect(prisma.mcpApiKey.updateMany).not.toHaveBeenCalled();
  });

  it('reports not found when the row vanished between the read and the write', async () => {
    vi.mocked(prisma.mcpApiKey.findFirst)
      .mockResolvedValueOnce(dbRow() as never)
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.mcpApiKey.updateMany).mockResolvedValue({ count: 0 });
    await expect(revokeWorkspaceMcpKey(ORG, KEY_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('answers unchanged when another revoke got there between the read and the write', async () => {
    vi.mocked(prisma.mcpApiKey.findFirst)
      .mockResolvedValueOnce(dbRow() as never)
      .mockResolvedValueOnce(dbRow({ isActive: false }) as never);
    vi.mocked(prisma.mcpApiKey.updateMany).mockResolvedValue({ count: 0 });
    const { key, changed } = await revokeWorkspaceMcpKey(ORG, KEY_ID);
    expect(changed).toBe(false);
    expect(key.isActive).toBe(false);
    expect(vi.mocked(prisma.mcpApiKey.findFirst).mock.calls[1]?.[0]?.where).toEqual({
      id: KEY_ID,
      orgId: ORG,
    });
  });
});

describe('createWorkspaceMcpKeySchema', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();

  it('accepts a name alone, a null expiry and a future expiry, trimming the name', () => {
    expect(createWorkspaceMcpKeySchema.parse({ name: '  Laptop ' })).toEqual({ name: 'Laptop' });
    expect(createWorkspaceMcpKeySchema.parse({ name: 'a', expiresAt: null }).expiresAt).toBeNull();
    expect(createWorkspaceMcpKeySchema.parse({ name: 'a', expiresAt: future }).expiresAt).toBe(
      future
    );
  });

  it('refuses scopes, or any other field, in the body', () => {
    expect(createWorkspaceMcpKeySchema.safeParse({ name: 'a', scopes: ['admin'] }).success).toBe(
      false
    );
    expect(createWorkspaceMcpKeySchema.safeParse({ name: 'a', scopedAgentId: 'x' }).success).toBe(
      false
    );
  });

  it('refuses an empty or over-long name, a past expiry and a non-ISO expiry', () => {
    const bad = [
      { name: '   ' },
      { name: 'x'.repeat(101) },
      { name: 'a', expiresAt: '2020-01-01T00:00:00.000Z' },
      { name: 'a', expiresAt: 'tomorrow' },
    ];
    for (const body of bad) {
      expect(createWorkspaceMcpKeySchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('workspaceMcpKeyParamsSchema', () => {
  it('requires a workspace id and a cuid key id', () => {
    expect(workspaceMcpKeyParamsSchema.safeParse({ id: ORG, keyId: KEY_ID }).success).toBe(true);
    expect(workspaceMcpKeyParamsSchema.safeParse({ id: ORG, keyId: 'nope' }).success).toBe(false);
    expect(workspaceMcpKeyParamsSchema.safeParse({ id: ORG }).success).toBe(false);
  });
});

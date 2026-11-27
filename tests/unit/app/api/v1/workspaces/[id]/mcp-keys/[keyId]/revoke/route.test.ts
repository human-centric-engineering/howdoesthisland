/**
 * Tests: POST /api/v1/workspaces/[id]/mcp-keys/[keyId]/revoke (t-95).
 *
 * Admission is the authorization policy's, exercised for real through the
 * guard; only prisma, the logger and the audit writer are mocked.
 *
 * @see app/api/v1/workspaces/[id]/mcp-keys/[keyId]/revoke/route.ts
 */
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { DEFAULT_ORG_ROLE, ORG_ADMIN_ROLE } from '@/lib/tenancy/roles';

const mockEnv = vi.hoisted(() => ({
  TENANCY_MODE: 'multi',
  NEXT_PUBLIC_APP_URL: 'http://app.test',
  BETTER_AUTH_URL: 'http://app.test',
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: mockGetSession } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    org: { findUnique: vi.fn() },
    orgMembership: { findUnique: vi.fn(), findMany: vi.fn() },
    aiApiKey: { findFirst: vi.fn(), update: vi.fn() },
    mcpApiKey: { findFirst: vi.fn(), updateMany: vi.fn() },
  },
}));
const mockIsApiKey = vi.hoisted(() => ({ fn: null as null | ((s: unknown) => boolean) }));
vi.mock('@/lib/auth/api-keys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/api-keys')>();
  return {
    ...actual,
    isApiKeySession: vi.fn((s: Parameters<typeof actual.isApiKeySession>[0]) =>
      mockIsApiKey.fn ? mockIsApiKey.fn(s) : actual.isApiKeySession(s)
    ),
  };
});
vi.mock('@/lib/security/ip', () => ({ getClientIP: vi.fn(() => '127.0.0.1') }));
const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: vi.fn(async () => mockLog) }));
vi.mock('@/lib/logging', () => ({ logger: mockLog }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/orchestration/audit/admin-audit-logger')>()),
  logAdminAction: vi.fn(),
}));

import { POST } from '@/app/api/v1/workspaces/[id]/mcp-keys/[keyId]/revoke/route';
import { prisma } from '@/lib/db/client';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { createMockAuthSession } from '@/tests/helpers/auth';

const WS = 'cmorg000000000000000team1';
const OTHER = 'cmorg0000000000000000org2';
const KEY = 'cmkey000000000000000key01';

function session(activeOrgId: string | null, role = 'USER') {
  const base = createMockAuthSession();
  return { session: { ...base.session, activeOrgId }, user: { ...base.user, role } };
}
function memberOf(role: string) {
  vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue({
    role,
    org: { status: 'ACTIVE' },
  } as never);
}
function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: KEY,
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
function revoke(keyId = KEY, orgId = WS) {
  const request = new Request(
    `http://localhost/api/v1/workspaces/${orgId}/mcp-keys/${keyId}/revoke`,
    { method: 'POST' }
  ) as unknown as NextRequest;
  return POST(request, { params: Promise.resolve({ id: orgId, keyId }) });
}
const json = async (res: Response) => JSON.parse(await res.text());

beforeEach(() => {
  vi.resetAllMocks();
  mockIsApiKey.fn = null;
  mockEnv.TENANCY_MODE = 'multi';
  vi.mocked(prisma.aiApiKey.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.org.findUnique).mockResolvedValue({
    id: WS,
    name: 'Design Team',
    status: 'ACTIVE',
  } as never);
  mockGetSession.mockResolvedValue(session(WS));
  memberOf(ORG_ADMIN_ROLE);
  vi.mocked(prisma.mcpApiKey.findFirst).mockResolvedValue(dbRow() as never);
  vi.mocked(prisma.mcpApiKey.updateMany).mockResolvedValue({ count: 1 });
});

describe('POST /api/v1/workspaces/[id]/mcp-keys/[keyId]/revoke', () => {
  it('deactivates the key by id and workspace, answers it inactive, and audits the change', async () => {
    const res = await revoke();
    expect(res.status).toBe(200);
    const body = await json(res);

    expect(prisma.mcpApiKey.updateMany).toHaveBeenCalledWith({
      where: { id: KEY, orgId: WS, isActive: true },
      data: { isActive: false },
    });
    expect(body.data.key).toMatchObject({ id: KEY, isActive: false });
    expect(JSON.stringify(body)).not.toContain('keyHash');
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp_api_key.update',
        entityId: KEY,
        changes: { isActive: { from: true, to: false } },
      })
    );
    expect(mockLog.info).toHaveBeenCalledWith(
      'Workspace MCP key revoked',
      expect.objectContaining({ orgId: WS, keyId: KEY })
    );
  });

  it('answers an already revoked key unchanged, writing and auditing nothing', async () => {
    vi.mocked(prisma.mcpApiKey.findFirst).mockResolvedValue(dbRow({ isActive: false }) as never);
    const res = await revoke();
    expect(res.status).toBe(200);
    expect((await json(res)).data.key.isActive).toBe(false);
    expect(prisma.mcpApiKey.updateMany).not.toHaveBeenCalled();
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it('answers 404 for a key not in this workspace, looking it up by workspace', async () => {
    vi.mocked(prisma.mcpApiKey.findFirst).mockResolvedValue(null);
    const res = await revoke();
    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe('NOT_FOUND');
    expect(vi.mocked(prisma.mcpApiKey.findFirst).mock.calls[0]?.[0]?.where).toEqual({
      id: KEY,
      orgId: WS,
    });
    expect(prisma.mcpApiKey.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a malformed key id with a 400', async () => {
    const res = await revoke('nope');
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('VALIDATION_ERROR');
    expect(prisma.mcpApiKey.findFirst).not.toHaveBeenCalled();
  });

  it('refuses a MEMBER and a caller acting in another workspace', async () => {
    memberOf(DEFAULT_ORG_ROLE);
    expect((await revoke()).status).toBe(403);
    memberOf(ORG_ADMIN_ROLE);
    mockGetSession.mockResolvedValue(session(OTHER));
    expect((await revoke()).status).toBe(403);
    expect(prisma.mcpApiKey.updateMany).not.toHaveBeenCalled();
  });

  // Sunrise 0.21.0: a platform admin is one only in the install org, so that is
  // where one who has not entered the workspace is working from.
  it('refuses a platform admin who has not entered the workspace', async () => {
    mockGetSession.mockResolvedValue(session(INSTALL_ORG_ID, 'ADMIN'));
    const res = await revoke();
    expect(res.status).toBe(403);
    expect((await json(res)).error.message).toContain('Switch to this workspace');
    expect(prisma.mcpApiKey.updateMany).not.toHaveBeenCalled();
  });

  it('refuses an API-key session', async () => {
    mockIsApiKey.fn = () => true;
    expect((await revoke()).status).toBe(403);
    expect(prisma.mcpApiKey.updateMany).not.toHaveBeenCalled();
  });

  it('answers WORKSPACES_UNAVAILABLE at single tenancy', async () => {
    mockEnv.TENANCY_MODE = 'single';
    const res = await revoke();
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('WORKSPACES_UNAVAILABLE');
    expect(prisma.mcpApiKey.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * Tests: GET/POST /api/v1/workspaces/[id]/mcp-keys (t-95), and the access
 * helper in `lib/app/workspaces/mcp-keys-access.ts` they share.
 *
 * Admission is the authorization policy's, exercised for real through the
 * guard. Only prisma, the logger and the audit writer are mocked, so what is
 * written to `mcpApiKey` is what the route + lib really built.
 *
 * @see app/api/v1/workspaces/[id]/mcp-keys/route.ts
 * @see lib/app/workspaces/mcp-keys-access.ts
 */
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { DEFAULT_ORG_ROLE, ORG_ADMIN_ROLE, ORG_OWNER_ROLE } from '@/lib/tenancy/roles';

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
    mcpApiKey: { findMany: vi.fn(), create: vi.fn() },
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

import { GET, POST } from '@/app/api/v1/workspaces/[id]/mcp-keys/route';
import { prisma } from '@/lib/db/client';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { createMockAuthSession } from '@/tests/helpers/auth';

const WS = 'cmorg000000000000000team1';
const OTHER = 'cmorg0000000000000000org2';
const KEY_HEADERS = { authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef' };

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
    id: 'cmkey000000000000000key01',
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
function get(orgId = WS, headers: Record<string, string> = {}) {
  const request = new Request(`http://localhost/api/v1/workspaces/${orgId}/mcp-keys`, {
    headers,
  }) as unknown as NextRequest;
  return GET(request, { params: Promise.resolve({ id: orgId }) });
}
function post(body: unknown, orgId = WS, headers: Record<string, string> = {}) {
  const request = new Request(`http://localhost/api/v1/workspaces/${orgId}/mcp-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  return POST(request, { params: Promise.resolve({ id: orgId }) });
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
  vi.mocked(prisma.mcpApiKey.findMany).mockResolvedValue([dbRow()] as never);
  vi.mocked(prisma.mcpApiKey.create).mockResolvedValue(dbRow() as never);
});

describe('GET /api/v1/workspaces/[id]/mcp-keys', () => {
  it.each([ORG_ADMIN_ROLE, ORG_OWNER_ROLE])(
    'lists a workspace %s’s keys, scoped to the workspace, with no hash',
    async (role) => {
      memberOf(role);
      const res = await get();
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.data.keys).toEqual([
        expect.objectContaining({ id: 'cmkey000000000000000key01', createdByName: 'Sam' }),
      ]);
      expect(body.data.keys[0]).not.toHaveProperty('creator');
      expect(JSON.stringify(body)).not.toMatch(/keyHash|plaintext/);
      expect(vi.mocked(prisma.mcpApiKey.findMany).mock.calls[0]?.[0]?.where).toEqual({
        orgId: WS,
      });
    }
  );

  it('refuses a MEMBER, and someone acting in another workspace, reading nothing', async () => {
    memberOf(DEFAULT_ORG_ROLE);
    expect((await get()).status).toBe(403);
    memberOf(ORG_ADMIN_ROLE);
    mockGetSession.mockResolvedValue(session(OTHER));
    expect((await get()).status).toBe(403);
    expect(prisma.mcpApiKey.findMany).not.toHaveBeenCalled();
  });

  // Sunrise 0.21.0: a platform admin is one only in the install org, so that is
  // where one acting elsewhere is working from (in a customer org they are not).
  it('refuses a platform admin working from the install org, naming how to proceed', async () => {
    mockGetSession.mockResolvedValue(session(INSTALL_ORG_ID, 'ADMIN'));
    const res = await get();
    expect(res.status).toBe(403);
    expect((await json(res)).error.message).toContain('Switch to this workspace');
    expect(prisma.mcpApiKey.findMany).not.toHaveBeenCalled();
  });

  it('serves a platform admin who entered the workspace', async () => {
    mockGetSession.mockResolvedValue(session(WS, 'ADMIN'));
    expect((await get()).status).toBe(200);
  });

  it('refuses an API-key caller', async () => {
    vi.mocked(prisma.aiApiKey.findFirst).mockResolvedValue({
      id: 'cmkey000000000000000key1',
      userId: 'cmjbv4i3x00003wsloputgwul',
      scopes: ['admin'],
      rateLimitRpm: null,
      expiresAt: null,
      createdAt: new Date(),
      orgId: WS,
      user: {
        id: 'cmjbv4i3x00003wsloputgwul',
        name: 'Key Owner',
        email: 'owner@example.com',
        emailVerified: true,
        image: null,
        role: 'ADMIN',
        accountType: 'HUMAN',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as never);
    expect((await get(WS, KEY_HEADERS)).status).toBe(403);
    expect(prisma.mcpApiKey.findMany).not.toHaveBeenCalled();
  });

  it('refuses an API-key session itself, should a policy ever admit one', async () => {
    mockIsApiKey.fn = () => true;
    const res = await get();
    expect(res.status).toBe(403);
    expect((await json(res)).error.message).toContain('browser session');
    expect(prisma.mcpApiKey.findMany).not.toHaveBeenCalled();
  });

  it('answers WORKSPACES_UNAVAILABLE at single tenancy', async () => {
    mockEnv.TENANCY_MODE = 'single';
    const res = await get();
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('WORKSPACES_UNAVAILABLE');
    expect(prisma.mcpApiKey.findMany).not.toHaveBeenCalled();
  });

  it('answers 401 with no session', async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  it('refuses a workspace id that resolves to no workspace, reading nothing', async () => {
    expect((await get('not-an-org')).status).toBe(403);
    expect(prisma.mcpApiKey.findMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/workspaces/[id]/mcp-keys', () => {
  it('makes a key with the fixed scopes, org and maker, answering the plaintext once', async () => {
    const res = await post({ name: 'Sam’s Claude' });
    expect(res.status).toBe(201);
    const body = await json(res);

    const data = vi.mocked(prisma.mcpApiKey.create).mock.calls[0]?.[0].data;
    expect(data).toMatchObject({
      name: 'Sam’s Claude',
      scopes: ['tools:list', 'tools:execute'],
      orgId: WS,
      createdBy: createMockAuthSession().user.id,
      expiresAt: null,
    });
    expect(data?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data?.keyHash).not.toBe(body.data.key.plaintext);
    expect(body.data.key.plaintext).toMatch(/^smcp_/);
    expect(JSON.stringify(body)).not.toContain('keyHash');
    expect(body.data.key).not.toHaveProperty('creator');
  });

  it('stores the expiry the caller chose', async () => {
    const at = new Date(Date.now() + 86_400_000).toISOString();
    expect((await post({ name: 'a', expiresAt: at })).status).toBe(201);
    expect(vi.mocked(prisma.mcpApiKey.create).mock.calls[0]?.[0].data.expiresAt).toEqual(
      new Date(at)
    );
  });

  it('audits the creation without the value, and logs the key id and prefix', async () => {
    const res = await post({ name: 'Sam’s Claude' });
    const body = await json(res);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mcp_api_key.create',
        entityType: 'mcp_api_key',
        entityId: 'cmkey000000000000000key01',
        metadata: { keyPrefix: 'smcp_abcdefg', scopes: ['tools:list', 'tools:execute'] },
        clientIp: '127.0.0.1',
      })
    );
    expect(JSON.stringify(vi.mocked(logAdminAction).mock.calls)).not.toContain(
      body.data.key.plaintext
    );
    expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain(body.data.key.plaintext);
  });

  it('refuses scopes in the body, creating nothing', async () => {
    const res = await post({ name: 'a', scopes: ['admin'] });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('VALIDATION_ERROR');
    expect(prisma.mcpApiKey.create).not.toHaveBeenCalled();
  });

  it('refuses a missing name and an expiry in the past', async () => {
    expect((await post({ name: '' })).status).toBe(400);
    expect((await post({ name: 'a', expiresAt: '2020-01-01T00:00:00.000Z' })).status).toBe(400);
    expect(prisma.mcpApiKey.create).not.toHaveBeenCalled();
  });

  it('refuses a MEMBER and a caller acting in another workspace', async () => {
    memberOf(DEFAULT_ORG_ROLE);
    expect((await post({ name: 'a' })).status).toBe(403);
    memberOf(ORG_ADMIN_ROLE);
    mockGetSession.mockResolvedValue(session(OTHER));
    expect((await post({ name: 'a' })).status).toBe(403);
    expect(prisma.mcpApiKey.create).not.toHaveBeenCalled();
  });

  it('refuses a platform admin acting in another workspace', async () => {
    mockGetSession.mockResolvedValue(session(OTHER, 'ADMIN'));
    expect((await post({ name: 'a' })).status).toBe(403);
    expect(prisma.mcpApiKey.create).not.toHaveBeenCalled();
  });

  it('refuses an API-key session, so a key cannot mint keys', async () => {
    mockIsApiKey.fn = () => true;
    const res = await post({ name: 'a' });
    expect(res.status).toBe(403);
    expect(prisma.mcpApiKey.create).not.toHaveBeenCalled();
  });

  it('answers WORKSPACES_UNAVAILABLE at single tenancy, creating nothing', async () => {
    mockEnv.TENANCY_MODE = 'single';
    const res = await post({ name: 'a' });
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('WORKSPACES_UNAVAILABLE');
    expect(prisma.mcpApiKey.create).not.toHaveBeenCalled();
  });
});

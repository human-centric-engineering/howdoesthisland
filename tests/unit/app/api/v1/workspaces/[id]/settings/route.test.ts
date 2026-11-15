/**
 * Unit Tests: PATCH /api/v1/workspaces/[id]/settings (t-26)
 *
 * Runs the REAL `withAuth`, default policy, entry rule and `resolveOrgResource`
 * at `TENANCY_MODE=multi`, with Prisma mocked at the delegates. The write is
 * a spy: what it keeps and drops in `Org.settings` is tested against a
 * stateful fake in tests/unit/lib/app/workspaces/app-settings.test.ts.
 */
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
  },
}));

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: vi.fn(async () => mockLog) }));
vi.mock('@/lib/logging', () => ({ logger: mockLog }));

const mockWrite = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/retention/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/app/retention/settings')>();
  return { ...actual, writeAppRetention: mockWrite };
});

import { PATCH } from '@/app/api/v1/workspaces/[id]/settings/route';
import { prisma } from '@/lib/db/client';
import { createMockAuthSession } from '@/tests/helpers/auth';

const WS = 'cmorg000000000000000team1';
const OTHER_WS = 'cmorg0000000000000000org2';
const USER_ID = 'cmjbv4i3x00003wsloputgwul';

function session(activeOrgId: string | null, role: 'USER' | 'ADMIN' = 'USER') {
  const base = createMockAuthSession();
  return {
    session: { ...base.session, activeOrgId },
    user: { ...base.user, role },
  };
}

function memberOf(role: string) {
  vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue({
    role,
    org: { status: 'ACTIVE' },
  } as never);
}

function patch(body: unknown, orgId = WS, headers: Record<string, string> = {}) {
  const request = new Request(`http://localhost/api/v1/workspaces/${orgId}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
  return PATCH(request, { params: Promise.resolve({ id: orgId }) });
}

const json = async (res: Response) => JSON.parse(await res.text());

beforeEach(() => {
  vi.resetAllMocks();
  mockEnv.TENANCY_MODE = 'multi';
  vi.mocked(prisma.aiApiKey.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.org.findUnique).mockResolvedValue({
    id: WS,
    name: 'Design Team',
    status: 'ACTIVE',
  } as never);
  mockWrite.mockImplementation((_orgId: string, retention: unknown) =>
    Promise.resolve({ retention })
  );
  mockGetSession.mockResolvedValue(session(WS));
  memberOf(ORG_ADMIN_ROLE);
});

describe('PATCH /api/v1/workspaces/[id]/settings — who may set it', () => {
  it('lets a workspace ADMIN set a window: 200 with the settings as written', async () => {
    const res = await patch({ retention: { days: 30 } });

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ success: true, data: { retention: { days: 30 } } });
    expect(mockWrite).toHaveBeenCalledWith(WS, { days: 30 });
  });

  it('lets an OWNER clear it', async () => {
    memberOf(ORG_OWNER_ROLE);

    const res = await patch({ retention: null });

    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ retention: null });
    expect(mockWrite).toHaveBeenCalledWith(WS, null);
  });

  it('refuses an orgId in the body rather than reading it', async () => {
    const res = await patch({ retention: null, orgId: OTHER_WS });

    // An unknown key is refused outright rather than ignored.
    expect(res.status).toBe(400);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('refuses a plain MEMBER with 403', async () => {
    memberOf(DEFAULT_ORG_ROLE);

    const res = await patch({ retention: { days: 30 } });

    expect(res.status).toBe(403);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('refuses someone who is not a member of the workspace', async () => {
    vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue(null);

    const res = await patch({ retention: { days: 30 } });

    expect(res.status).toBe(403);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('refuses an ADMIN of workspace B who names workspace A in the URL', async () => {
    mockGetSession.mockResolvedValue(session(OTHER_WS));

    const res = await patch({ retention: { days: 30 } }, WS);

    expect(res.status).toBe(403);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('answers 403 for a workspace that does not exist, as for one the caller is not in', async () => {
    vi.mocked(prisma.org.findUnique).mockResolvedValue(null);

    const res = await patch({ retention: { days: 30 } });

    expect(res.status).toBe(403);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await patch({ retention: { days: 30 } });

    expect(res.status).toBe(401);
    expect((await json(res)).error.code).toBe('UNAUTHORIZED');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('refuses an API-key caller with 403', async () => {
    vi.mocked(prisma.aiApiKey.findFirst).mockResolvedValue({
      id: 'cmkey000000000000000key1',
      userId: USER_ID,
      scopes: ['admin'],
      rateLimitRpm: null,
      expiresAt: null,
      createdAt: new Date(),
      orgId: WS,
      user: {
        id: USER_ID,
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

    const res = await patch({ retention: { days: 30 } }, WS, {
      authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef',
    });

    expect(res.status).toBe(403);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('answers 400 WORKSPACES_UNAVAILABLE at single, writing nothing', async () => {
    mockEnv.TENANCY_MODE = 'single';

    const res = await patch({ retention: { days: 30 } });

    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('WORKSPACES_UNAVAILABLE');
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/workspaces/[id]/settings — the body', () => {
  it.each([
    ['no retention key', {}],
    ['zero days', { retention: { days: 0 } }],
    ['a fraction of a day', { retention: { days: 1.5 } }],
    ['more than ten years', { retention: { days: 3651 } }],
    ['a bare number', { retention: 30 }],
    ['an unknown key in the window', { retention: { days: 30, hours: 2 } }],
    ['an unknown top-level key', { retention: null, quotas: { monthlyBudgetUsd: 0 } }],
  ])('rejects %s with 400 VALIDATION_ERROR before writing', async (_l, bad) => {
    const res = await patch(bad);

    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('VALIDATION_ERROR');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('accepts the edges of the range', async () => {
    expect((await patch({ retention: { days: 1 } })).status).toBe(200);
    expect((await patch({ retention: { days: 3650 } })).status).toBe(200);
  });

  it('answers 404 when the workspace is gone by the time of the write', async () => {
    mockWrite.mockResolvedValue(null);

    const res = await patch({ retention: { days: 30 } });

    expect(res.status).toBe(404);
    expect((await json(res)).error.code).toBe('NOT_FOUND');
  });
});

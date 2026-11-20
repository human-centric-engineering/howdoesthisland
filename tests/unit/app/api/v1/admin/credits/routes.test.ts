/**
 * The admin CopyCredits routes (t-57), through the real `withAdminAuth`: a
 * platform admin is admitted, a USER and an org OWNER who is not a platform
 * admin are refused before any read or write (every signup owns a workspace,
 * so the OWNER case is the one that matters), the actor is the session's
 * user, and a body outside the schema never reaches the service. The page is
 * refused to a non-admin by the admin layout's tier rule, checked here too.
 *
 * The service is mocked: `tests/unit/lib/app/credits/admin.test.ts` runs it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { ORG_OWNER_ROLE } from '@/lib/tenancy/roles';

const mockEnv = vi.hoisted(() => ({ TENANCY_MODE: 'single' }));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: mockGetSession } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    orgMembership: { findUnique: vi.fn() },
    aiApiKey: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

const service = vi.hoisted(() => ({
  listWorkspaceCredits: vi.fn(),
  changeWorkspaceCredits: vi.fn(),
}));
vi.mock('@/lib/app/credits/admin', () => service);

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: vi.fn(async () => mockLog) }));
vi.mock('@/lib/logging', () => ({ logger: mockLog }));

import { GET } from '@/app/api/v1/admin/credits/route';
import { POST } from '@/app/api/v1/admin/credits/[id]/entries/route';
import { NotFoundError } from '@/lib/api/errors';
import { adminPageTierOf, reachesAdminPage } from '@/lib/auth/admin-tier';
import { namedTierAdminPages, orgTierAdminPages } from '@/lib/auth/org-tier-admin-pages';
import { prisma } from '@/lib/db/client';
import { createMockAuthSession } from '@/tests/helpers/auth';

const ORG_ID = 'cmorg00000000000000000001';

function session(role: 'USER' | 'ADMIN') {
  const base = createMockAuthSession();
  return { session: { ...base.session, activeOrgId: null }, user: { ...base.user, role } };
}

const get = (query = '') =>
  GET(new Request(`http://localhost/api/v1/admin/credits${query}`) as unknown as NextRequest);

const post = (body: unknown, id = ORG_ID) =>
  POST(
    new Request(`http://localhost/api/v1/admin/credits/${id}/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) }
  );

const GRANT = { kind: 'grant', amount: 500, reason: 'Pilot workspace' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.aiApiKey.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue(null);
  service.listWorkspaceCredits.mockResolvedValue({ workspaces: [], truncated: false });
});

describe('who may call them', () => {
  it('refuses a request with no session', async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect((await post(GRANT)).status).toBe(401);
    expect(service.listWorkspaceCredits).not.toHaveBeenCalled();
    expect(service.changeWorkspaceCredits).not.toHaveBeenCalled();
  });

  it('refuses a USER, before any read or write', async () => {
    mockGetSession.mockResolvedValue(session('USER'));
    expect((await get()).status).toBe(403);
    expect((await post(GRANT)).status).toBe(403);
    expect(service.listWorkspaceCredits).not.toHaveBeenCalled();
    expect(service.changeWorkspaceCredits).not.toHaveBeenCalled();
  });

  it('refuses a workspace OWNER who is not a platform admin, so no one grants themselves credits', async () => {
    mockGetSession.mockResolvedValue(session('USER'));
    vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue({
      role: ORG_OWNER_ROLE,
    } as never);
    expect((await get()).status).toBe(403);
    expect((await post(GRANT)).status).toBe(403);
    expect(service.changeWorkspaceCredits).not.toHaveBeenCalled();
  });

  it('keeps the page from anyone but a platform admin', () => {
    const tier = adminPageTierOf('/admin/credits', orgTierAdminPages(), namedTierAdminPages());
    expect(tier).toBeNull();
    expect(reachesAdminPage({ tiers: ['org'], landing: null }, '/admin/credits', tier)).toBe(false);
    expect(reachesAdminPage('platform', '/admin/credits', tier)).toBe(true);
  });
});

describe('GET /api/v1/admin/credits', () => {
  it('answers a platform admin with the list, passing the search through', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    const res = await get('?q=acme');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { workspaces: [], truncated: false } });
    expect(service.listWorkspaceCredits).toHaveBeenCalledWith('acme');
  });

  it('treats an empty search as none', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    await get('?q=');
    expect(service.listWorkspaceCredits).toHaveBeenCalledWith(undefined);
  });

  it('counts an emoji once, as the page does when it cuts a search', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    // 60 emoji: 60 characters, though 120 UTF-16 units.
    const q = encodeURIComponent('😀'.repeat(60));
    expect((await get(`?q=${q}`)).status).toBe(200);
  });

  it('refuses a search over 100 characters', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    expect((await get(`?q=${'a'.repeat(101)}`)).status).toBe(400);
    expect(service.listWorkspaceCredits).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/admin/credits/{id}/entries', () => {
  it('records the change as the session’s user and answers 201', async () => {
    const admin = session('ADMIN');
    mockGetSession.mockResolvedValue(admin);
    const result = {
      entry: {
        id: 'e1',
        amount: 500,
        kind: 'GRANT',
        reason: 'Pilot workspace',
        createdAt: '2026-11-20T12:00:00.000Z',
      },
      balance: 500,
      capWarning: null,
    };
    service.changeWorkspaceCredits.mockResolvedValue(result);

    const res = await post(GRANT);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, data: result });
    expect(service.changeWorkspaceCredits).toHaveBeenCalledWith(ORG_ID, GRANT, admin.user.id);
  });

  it.each([
    ['a grant of nothing', { kind: 'grant', amount: 0, reason: 'x' }],
    ['a negative grant', { kind: 'grant', amount: -10, reason: 'x' }],
    ['an adjustment of nothing', { kind: 'adjust', amount: 0, reason: 'x' }],
    ['a fraction of a credit', { kind: 'grant', amount: 1.5, reason: 'x' }],
    ['more than the cap on one change', { kind: 'grant', amount: 1_000_001, reason: 'x' }],
    ['no reason', { kind: 'grant', amount: 10, reason: '   ' }],
    ['an unknown kind', { kind: 'charge', amount: -10, reason: 'x' }],
    ['an extra key', { ...GRANT, actorUserId: 'someone-else' }],
  ])('refuses %s before the service', async (_name, body) => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    expect((await post(body)).status).toBe(400);
    expect(service.changeWorkspaceCredits).not.toHaveBeenCalled();
  });

  it('accepts an adjustment that takes credits away', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    service.changeWorkspaceCredits.mockResolvedValue({});
    const body = { kind: 'adjust', amount: -40, reason: 'Refunded twice by mistake' };
    expect((await post(body)).status).toBe(201);
    expect(service.changeWorkspaceCredits).toHaveBeenCalledWith(ORG_ID, body, expect.any(String));
  });

  it('answers 404 for an id that is not a workspace id, or one the service cannot find', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    expect((await post(GRANT, 'not an id!')).status).toBe(404);
    expect(service.changeWorkspaceCredits).not.toHaveBeenCalled();

    service.changeWorkspaceCredits.mockRejectedValue(new NotFoundError('Workspace not found'));
    expect((await post(GRANT)).status).toBe(404);
  });
});

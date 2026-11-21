/**
 * The admin review code routes (t-59), through the real `withAdminAuth`: a
 * platform admin is admitted, a USER and an org OWNER who is not a platform
 * admin are refused before any read or write, the maker is the session's
 * user, a body outside the schema never reaches the service, a replayed mint
 * answers 200 where a new one answers 201, and a revoke reaches the service
 * with the id. The page is refused to a non-admin by the admin layout's tier
 * rule, checked here too.
 *
 * The service is mocked: `tests/unit/lib/app/credits/codes/service.test.ts`
 * runs it, idempotency included.
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
  issueCodes: vi.fn(),
  listCodes: vi.fn(),
  revokeCode: vi.fn(),
}));
vi.mock('@/lib/app/credits/codes/service', () => service);

const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: vi.fn(async () => mockLog) }));
vi.mock('@/lib/logging', () => ({ logger: mockLog }));

import { GET, POST } from '@/app/api/v1/admin/codes/route';
import { DELETE } from '@/app/api/v1/admin/codes/[id]/route';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { adminPageTierOf, reachesAdminPage } from '@/lib/auth/admin-tier';
import { namedTierAdminPages, orgTierAdminPages } from '@/lib/auth/org-tier-admin-pages';
import { prisma } from '@/lib/db/client';
import { createMockAuthSession } from '@/tests/helpers/auth';

const CODE_ID = 'cmcode0000000000000000001';

function session(role: 'USER' | 'ADMIN') {
  const base = createMockAuthSession();
  return { session: { ...base.session, activeOrgId: null }, user: { ...base.user, role } };
}

const get = (query = '') =>
  GET(new Request(`http://localhost/api/v1/admin/codes${query}`) as unknown as NextRequest);

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/v1/admin/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  );

const del = (id = CODE_ID) =>
  DELETE(
    new Request(`http://localhost/api/v1/admin/codes/${id}`, {
      method: 'DELETE',
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) }
  );

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const ISSUE = {
  count: 1,
  creditsPerRedemption: 300,
  maxRedemptions: 25,
  expiresAt: inDays(90),
  campaign: 'Spring stand card',
  idempotencyKey: 'lead-42',
};

const VIEW = {
  id: CODE_ID,
  code: 'ABCDEFGHJKMN',
  link: 'https://app.test/redeem?code=ABCDEFGHJKMN',
  campaign: 'Spring stand card',
  creditsPerRedemption: 300,
  maxRedemptions: 25,
  redemptionsUsed: 0,
  redemptionsLeft: 25,
  status: 'active',
  expiresAt: '2027-02-19T23:59:59.999Z',
  revokedAt: null,
  createdAt: '2026-11-21T09:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.aiApiKey.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue(null);
  service.listCodes.mockResolvedValue({ codes: [], truncated: false });
});

describe('who may call them', () => {
  it('refuses a request with no session', async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect((await post(ISSUE)).status).toBe(401);
    expect((await del()).status).toBe(401);
    expect(service.listCodes).not.toHaveBeenCalled();
    expect(service.issueCodes).not.toHaveBeenCalled();
    expect(service.revokeCode).not.toHaveBeenCalled();
  });

  it('refuses a USER, before any read or write', async () => {
    mockGetSession.mockResolvedValue(session('USER'));
    expect((await get()).status).toBe(403);
    expect((await post(ISSUE)).status).toBe(403);
    expect((await del()).status).toBe(403);
    expect(service.listCodes).not.toHaveBeenCalled();
    expect(service.issueCodes).not.toHaveBeenCalled();
    expect(service.revokeCode).not.toHaveBeenCalled();
  });

  it('refuses a workspace OWNER who is not a platform admin, so no one mints themselves credits', async () => {
    mockGetSession.mockResolvedValue(session('USER'));
    vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue({
      role: ORG_OWNER_ROLE,
    } as never);
    expect((await get()).status).toBe(403);
    expect((await post(ISSUE)).status).toBe(403);
    expect((await del()).status).toBe(403);
    expect(service.issueCodes).not.toHaveBeenCalled();
    expect(service.revokeCode).not.toHaveBeenCalled();
  });

  it('keeps the page from anyone but a platform admin', () => {
    const tier = adminPageTierOf('/admin/codes', orgTierAdminPages(), namedTierAdminPages());
    expect(tier).toBeNull();
    expect(reachesAdminPage({ tiers: ['org'], landing: null }, '/admin/codes', tier)).toBe(false);
    expect(reachesAdminPage('platform', '/admin/codes', tier)).toBe(true);
  });
});

describe('GET /api/v1/admin/codes', () => {
  it('answers a platform admin with the list, passing the search through', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    const res = await get('?q=spring');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { codes: [], truncated: false } });
    expect(service.listCodes).toHaveBeenCalledWith('spring');
  });

  it('treats an empty search as none', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    await get('?q=');
    expect(service.listCodes).toHaveBeenCalledWith(undefined);
  });

  it('refuses a search over 100 characters', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    expect((await get(`?q=${'a'.repeat(101)}`)).status).toBe(400);
    expect(service.listCodes).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/admin/codes', () => {
  it('mints as the session’s user and answers 201', async () => {
    const admin = session('ADMIN');
    mockGetSession.mockResolvedValue(admin);
    service.issueCodes.mockResolvedValue({ codes: [VIEW], replayed: false });

    const res = await post(ISSUE);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, data: { codes: [VIEW], replayed: false } });
    expect(service.issueCodes).toHaveBeenCalledWith(ISSUE, admin.user.id);
  });

  it('answers a replayed idempotency key 200 with the codes first minted', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    service.issueCodes.mockResolvedValue({ codes: [VIEW], replayed: true });

    const res = await post(ISSUE);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ codes: [VIEW], replayed: true });
  });

  it('answers 409 when the key was used for a different request', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    service.issueCodes.mockRejectedValue(new ConflictError('used for a different request'));
    const res = await post(ISSUE);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONFLICT');
  });

  it('trims the campaign and accepts a call without a key', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    service.issueCodes.mockResolvedValue({ codes: [VIEW], replayed: false });
    const { idempotencyKey: _key, ...withoutKey } = ISSUE;
    expect((await post({ ...withoutKey, campaign: '  Spring  ' })).status).toBe(201);
    expect(service.issueCodes).toHaveBeenCalledWith(
      { ...withoutKey, campaign: 'Spring' },
      expect.any(String)
    );
  });

  it.each([
    ['no codes', { ...ISSUE, count: 0 }],
    ['more codes than a batch holds', { ...ISSUE, count: 201 }],
    ['a fraction of a credit', { ...ISSUE, creditsPerRedemption: 1.5 }],
    ['no credits', { ...ISSUE, creditsPerRedemption: 0 }],
    ['more credits than one redemption may give', { ...ISSUE, creditsPerRedemption: 100_001 }],
    ['no redemptions', { ...ISSUE, maxRedemptions: 0 }],
    ['an expiry in the past', { ...ISSUE, expiresAt: inDays(-1) }],
    ['an expiry over three years ahead', { ...ISSUE, expiresAt: inDays(4 * 366) }],
    ['an expiry that is not a time', { ...ISSUE, expiresAt: '2027-02-19' }],
    ['no campaign', { ...ISSUE, campaign: '   ' }],
    ['a campaign over 100 characters', { ...ISSUE, campaign: 'x'.repeat(101) }],
    ['a key with a space', { ...ISSUE, idempotencyKey: 'lead 42' }],
    ['a key over 200 characters', { ...ISSUE, idempotencyKey: 'k'.repeat(201) }],
    ['an extra key', { ...ISSUE, createdByUserId: 'someone-else' }],
  ])('refuses %s before the service', async (_name, body) => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    expect((await post(body)).status).toBe(400);
    expect(service.issueCodes).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/admin/codes/{id}', () => {
  it('revokes the code and answers with it', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    const revoked = { ...VIEW, status: 'revoked', revokedAt: '2026-11-21T10:00:00.000Z' };
    service.revokeCode.mockResolvedValue(revoked);

    const res = await del();

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(revoked);
    expect(service.revokeCode).toHaveBeenCalledWith(CODE_ID);
  });

  it('answers 404 for an id that is not a code id, or one the service cannot find', async () => {
    mockGetSession.mockResolvedValue(session('ADMIN'));
    expect((await del('not an id!')).status).toBe(404);
    expect(service.revokeCode).not.toHaveBeenCalled();

    service.revokeCode.mockRejectedValue(new NotFoundError('Code not found'));
    expect((await del()).status).toBe(404);
  });
});

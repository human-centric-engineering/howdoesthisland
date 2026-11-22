/**
 * Tests: the share-link routes (t-32).
 *
 * POST, GET /api/v1/assessments/{id}/shares · DELETE /api/v1/shares/{id} ·
 * GET /api/v1/shared-reports/{token}
 *
 * Real: the guard (session, API key and its scope, org entry at `multi`)
 * and the routes' parsing and answers. Replaced: the share service, whose
 * own tests (`tests/unit/lib/app/reports/share/`) cover the links themselves,
 * so these assert what reaches it and what the caller is sent.
 *
 * FORK NOTE — the per-IP cap case reads `@/lib/app/rate-limit` for real on
 * purpose: it is this fork's `shared-report` rule under test. A change to that
 * rule should change it; the seam's pinned rules are in
 * tests/unit/lib/app/defaults.test.ts (ledger row 2).
 *
 * @see app/api/v1/assessments/[id]/shares/route.ts
 * @see app/api/v1/shares/[id]/route.ts
 * @see app/api/v1/shared-reports/[token]/route.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/env', () => ({
  env: {
    NODE_ENV: 'test',
    TENANCY_MODE: 'multi',
    NEXT_PUBLIC_APP_URL: 'http://app.test',
    BETTER_AUTH_URL: 'http://app.test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  },
}));

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  membership: vi.fn(),
  apiKey: vi.fn(),
  createShare: vi.fn(),
  listShares: vi.fn(),
  revokeShare: vi.fn(),
  readSharedReport: vi.fn(),
}));
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    orgMembership: { findUnique: mocks.membership, findMany: vi.fn(async () => []) },
    orgSupportGrant: { findFirst: vi.fn(async () => null) },
    aiApiKey: { findFirst: mocks.apiKey, update: vi.fn(async () => ({})) },
    user: { findUnique: vi.fn(async () => null) },
    org: { findUnique: vi.fn(async () => null) },
  },
}));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: log }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: vi.fn(async () => log) }));
vi.mock('@/lib/app/reports/share/service', () => ({
  createShare: mocks.createShare,
  listShares: mocks.listShares,
  revokeShare: mocks.revokeShare,
  readSharedReport: mocks.readSharedReport,
}));

import { GET as list, POST as create } from '@/app/api/v1/assessments/[id]/shares/route';
import { DELETE as revoke } from '@/app/api/v1/shares/[id]/route';
import { GET as open } from '@/app/api/v1/shared-reports/[token]/route';
import { NotFoundError } from '@/lib/api/errors';
import { getTenantContext } from '@/lib/tenancy/context';
import { createMockAuthSession } from '@/tests/helpers/auth';
import { SHARED_REPORT_PATH } from '@/lib/app/rate-limit';
import { SHARED_REPORT_VIEWS_PER_MINUTE } from '@/lib/app/reports/share/limits';

const WS = 'org-a';
const ALICE = 'cmuser0000000000000alice1';
const KEY_ID = 'cmkey000000000000000key1';
const ID = 'cmassess000000000000000001';

const SHARE_VIEW = {
  id: 'share-1',
  state: 'active',
  expiresAt: new Date('2026-12-16T09:00:00.000Z'),
  revokedAt: null,
  viewCount: 0,
  createdAt: new Date('2026-11-16T09:00:00.000Z'),
};

function signedIn() {
  const base = createMockAuthSession();
  mocks.getSession.mockResolvedValue({
    session: { ...base.session, userId: ALICE, activeOrgId: WS },
    user: { ...base.user, id: ALICE },
  });
}

/** An API key of Alice's, bound to the workspace, with `scopes`. */
function withKey(scopes: string[]) {
  mocks.getSession.mockResolvedValue(null);
  mocks.apiKey.mockResolvedValue({
    id: KEY_ID,
    userId: ALICE,
    scopes,
    rateLimitRpm: null,
    expiresAt: null,
    createdAt: new Date(),
    orgId: WS,
    user: {
      id: ALICE,
      name: 'Alice',
      email: 'alice@example.com',
      emailVerified: true,
      image: null,
      role: 'USER',
      accountType: 'HUMAN',
      erasureRequestedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}
const KEY = { authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef' };

const sharesUrl = `http://localhost/api/v1/assessments/${ID}/shares`;
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body?: string, headers: Record<string, string> = {}) =>
  create(
    new NextRequest(sharesUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body }),
    }),
    idParams(ID)
  );

async function json(res: Response) {
  return (await res.json()) as {
    success: boolean;
    data?: Record<string, unknown>;
    error?: { code: string };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.membership.mockImplementation(
    async ({ where }: { where: { orgId_userId: { userId: string; orgId: string } } }) =>
      where.orgId_userId.userId === ALICE && where.orgId_userId.orgId === WS
        ? { role: 'MEMBER', org: { status: 'ACTIVE' } }
        : null
  );
  mocks.apiKey.mockResolvedValue(null);
  signedIn();
});

describe('POST /api/v1/assessments/{id}/shares', () => {
  it('makes a link in the caller’s workspace, 30 days by default', async () => {
    mocks.createShare.mockImplementation(async () => ({
      ...SHARE_VIEW,
      orgSeen: getTenantContext()?.orgId,
      token: 'tok',
      url: 'http://app.test/r/tok',
    }));

    const res = await post();

    expect(res.status).toBe(201);
    expect(mocks.createShare).toHaveBeenCalledWith(ID, { expiresInDays: 30 }, ALICE);
    const body = await json(res);
    expect(body.data).toMatchObject({ token: 'tok', url: 'http://app.test/r/tok', orgSeen: WS });
  });

  it('takes a lifetime, and refuses one out of range', async () => {
    mocks.createShare.mockResolvedValue({ ...SHARE_VIEW, token: 't', url: 'u' });
    expect((await post(JSON.stringify({ expiresInDays: 7 }))).status).toBe(201);
    expect(mocks.createShare).toHaveBeenCalledWith(ID, { expiresInDays: 7 }, ALICE);

    for (const bad of [
      '{"expiresInDays":0}',
      '{"expiresInDays":366}',
      '{"expiresInDays":1.5}',
      '{',
    ]) {
      const res = await post(bad);
      expect(res.status).toBe(400);
      expect((await json(res)).error?.code).toBe('VALIDATION_ERROR');
    }
    expect(mocks.createShare).toHaveBeenCalledTimes(1);
  });

  it('needs the `assess` scope on an API key: a read-only `reports` key cannot publish a report', async () => {
    mocks.createShare.mockResolvedValue({ ...SHARE_VIEW, token: 't', url: 'u' });

    withKey(['reports']);
    expect((await post(undefined, KEY)).status).toBe(403);
    expect(mocks.createShare).not.toHaveBeenCalled();

    withKey(['assess']);
    expect((await post(undefined, KEY)).status).toBe(201);
  });

  it('takes an empty body as every default', async () => {
    mocks.createShare.mockResolvedValue({ ...SHARE_VIEW, token: 't', url: 'u' });
    expect((await post('')).status).toBe(201);
    expect(mocks.createShare).toHaveBeenCalledWith(ID, { expiresInDays: 30 }, ALICE);
  });

  it('needs someone signed in', async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
  });
});

describe('GET /api/v1/assessments/{id}/shares', () => {
  it("lists the report's links", async () => {
    mocks.listShares.mockResolvedValue([SHARE_VIEW]);
    const res = await list(new NextRequest(sharesUrl), idParams(ID));
    expect(res.status).toBe(200);
    expect(mocks.listShares).toHaveBeenCalledWith(ID);
    expect((await json(res)).data).toEqual([
      {
        ...SHARE_VIEW,
        expiresAt: '2026-12-16T09:00:00.000Z',
        createdAt: '2026-11-16T09:00:00.000Z',
      },
    ]);
  });

  it('needs the `reports` scope on an API key', async () => {
    withKey(['assess']);
    expect((await list(new NextRequest(sharesUrl, { headers: KEY }), idParams(ID))).status).toBe(
      403
    );
  });
});

describe('DELETE /api/v1/shares/{id}', () => {
  const del = (headers: Record<string, string> = {}) =>
    revoke(
      new NextRequest('http://localhost/api/v1/shares/share-1', { method: 'DELETE', headers }),
      idParams('share-1')
    );

  it('revokes the link', async () => {
    mocks.revokeShare.mockResolvedValue({ ...SHARE_VIEW, state: 'revoked' });
    const res = await del();
    expect(res.status).toBe(200);
    expect(mocks.revokeShare).toHaveBeenCalledWith('share-1');
    expect((await json(res)).data).toMatchObject({ state: 'revoked' });
  });

  it('answers 404 for a link the service cannot find in the workspace', async () => {
    mocks.revokeShare.mockRejectedValue(new NotFoundError('Share link not found'));
    expect((await del()).status).toBe(404);
  });

  it('needs the `assess` scope on an API key: a read-only `reports` key cannot revoke', async () => {
    withKey(['reports']);
    expect((await del(KEY)).status).toBe(403);
    expect(mocks.revokeShare).not.toHaveBeenCalled();

    mocks.revokeShare.mockResolvedValue({ ...SHARE_VIEW, state: 'revoked' });
    withKey(['assess']);
    expect((await del(KEY)).status).toBe(200);
  });
});

describe('GET /api/v1/shared-reports/{token}', () => {
  const openToken = (token: string) =>
    open(new NextRequest(`http://localhost/api/v1/shared-reports/${token}`), {
      params: Promise.resolve({ token }),
    });
  const REPORT = {
    assessment: {
      status: 'completed',
      title: 'Spring',
      framework: { slug: 'howdoesthisland', version: '0.5.1' },
    },
    model: { meta: { name: 'HDTL' }, scoring: { integrity_caps: [{ cap: 40 }] } },
    catalogue: { request: { contentTypes: [] }, result: { appeals: [] } },
    expiresAt: new Date('2026-12-16T09:00:00.000Z'),
  };
  const CATALOGUE = REPORT.catalogue;

  it('answers the report to anyone with the token, and lets nothing keep a copy', async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.readSharedReport.mockResolvedValue({ ok: true, shareId: 'share-1', report: REPORT });

    const res = await openToken('tok');

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.readSharedReport).toHaveBeenCalledWith('tok', expect.any(Date), 'api');
    const body = await json(res);
    // The version's catalogue, never the model: a link is public, the model IP (t-67).
    expect(body.data).toEqual({
      assessment: REPORT.assessment,
      catalogue: CATALOGUE,
      expiresAt: '2026-12-16T09:00:00.000Z',
    });
    expect(JSON.stringify(body)).not.toContain('integrity_caps');
    // The share's id is the service's, not the reader's.
    expect(JSON.stringify(body)).not.toContain('share-1');
  });

  it.each(['malformed', 'missing', 'org', 'closed', 'no-report'])(
    'answers a link refused as %s with the same 404',
    async (refused) => {
      mocks.readSharedReport.mockResolvedValue({ ok: false, refused });
      const res = await openToken('tok');
      expect(res.status).toBe(404);
      // One answer for every reason, so a caller learns nothing about which.
      expect(await res.json()).toEqual({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Shared report not found' },
      });
    }
  );

  it('hands a token of any length to the service, so a long one is a 404 like any other', async () => {
    mocks.readSharedReport.mockResolvedValue({ ok: false, refused: 'malformed' });
    const res = await openToken('x'.repeat(200));
    expect(res.status).toBe(404);
    expect(mocks.readSharedReport).toHaveBeenCalledWith('x'.repeat(200), expect.any(Date), 'api');
  });

  it('answers 422 when the model it ran on no longer resolves', async () => {
    mocks.readSharedReport.mockResolvedValue({
      ok: true,
      shareId: 'share-1',
      report: { ...REPORT, model: null, catalogue: null },
    });
    const res = await openToken('tok');
    expect(res.status).toBe(422);
    expect((await json(res)).error?.code).toBe('REPORT_UNREADABLE');
  });
});

describe('the per-IP cap on opening a link (lib/app/rate-limit.ts)', () => {
  it(`lets ${SHARED_REPORT_VIEWS_PER_MINUTE} opens a minute through from one IP, page and API together, then answers 429`, async () => {
    // tests/setup.ts bypasses rate limiting; run the dispatcher for real.
    vi.stubEnv('RATE_LIMIT_BYPASS', '');
    const { applyRateLimit } = await import('@/lib/security/rate-limit-middleware');
    // No session: this is the anonymous reader the cap is for.
    const make = (path: string, ip: string) =>
      new NextRequest(`http://localhost${path}`, { headers: { 'x-forwarded-for': ip } });

    for (let i = 0; i < SHARED_REPORT_VIEWS_PER_MINUTE; i += 1) {
      const path = i % 2 === 0 ? `/r/tok${i}` : `/api/v1/shared-reports/tok${i}`;
      expect(await applyRateLimit(make(path, '198.51.100.7'))).toBeNull();
    }
    for (const path of ['/r/another', '/api/v1/shared-reports/another']) {
      const blocked = await applyRateLimit(make(path, '198.51.100.7'));
      expect(blocked?.status).toBe(429);
      expect(blocked?.headers.get('X-RateLimit-Limit')).toBe(
        String(SHARED_REPORT_VIEWS_PER_MINUTE)
      );
    }
    // Another IP has its own allowance.
    expect(await applyRateLimit(make('/r/tok', '198.51.100.8'))).toBeNull();
    vi.unstubAllEnvs();
  });

  it('covers only the link paths, not the routes that manage links', () => {
    for (const path of ['/r/abc', '/r/abc/', '/api/v1/shared-reports/abc']) {
      expect(SHARED_REPORT_PATH.test(path), path).toBe(true);
    }
    for (const path of ['/r', '/r/abc/more', '/api/v1/shares/abc', '/report/abc', '/rx/abc']) {
      expect(SHARED_REPORT_PATH.test(path), path).toBe(false);
    }
  });
});

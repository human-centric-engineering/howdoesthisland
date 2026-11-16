/**
 * Tests: the report's PDF (t-31), and its cleanup when the assessment goes.
 *
 * GET /api/v1/assessments/{id}/report.pdf · DELETE /api/v1/assessments/{id}
 *
 * Real: the guard (session, API key and its scope, org entry at `multi`),
 * the PDF service, its cache keys and the per-caller render cap. Replaced:
 * Prisma by the assessments' stateful fake (`fake-db.ts`); storage by an
 * in-memory provider that can keep private objects and read them back; and
 * the browser render (`renderReportPdf`), which records the token it was
 * handed and returns bytes naming the assessment. The render itself, against
 * the real print page, was checked on the dev server (PR description).
 *
 * @see app/api/v1/assessments/[id]/report.pdf/route.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeDb, type FakeDb } from '@/tests/unit/lib/app/assessments/fake-db';

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test' as const,
  TENANCY_MODE: 'multi',
  NEXT_PUBLIC_APP_URL: 'http://app.test',
  BETTER_AUTH_URL: 'http://app.test',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  membership: vi.fn(),
  apiKey: vi.fn(),
  render: vi.fn(),
}));
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }));

let fake: FakeDb;
vi.mock('@/lib/db/client', () => ({
  get prisma() {
    return {
      ...fake.db,
      orgMembership: { findUnique: mocks.membership, findMany: vi.fn(async () => []) },
      orgSupportGrant: { findFirst: vi.fn(async () => null) },
      aiApiKey: { findFirst: mocks.apiKey, update: vi.fn(async () => ({})) },
      user: { findUnique: vi.fn(async () => null) },
      org: { findUnique: vi.fn(async () => null) },
    };
  },
}));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: log }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: vi.fn(async () => log) }));
vi.mock('@/lib/orchestration/maintenance/idle-gate', () => ({ noteMaintenanceWork: vi.fn() }));
vi.mock('@/lib/app/reports/pdf/render', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/reports/pdf/render')>()),
  renderReportPdf: mocks.render,
}));

/** Private storage in memory, wrapped by the real org-bound client. */
const store = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  failPrefixDelete: false,
}));
vi.mock('@/lib/storage/client', async () => {
  const { scopeStorageToOrg } = await import('@/lib/storage/org-scoped');
  const provider = {
    name: 'memory',
    capabilities: { privateObjects: true, download: true, signedUrls: false },
    upload: vi.fn(async (file: Buffer, { key }: { key: string }) => {
      store.objects.set(key, file);
      return { key, url: key, size: file.length };
    }),
    download: vi.fn(async (key: string) => {
      const body = store.objects.get(key);
      if (!body) throw new Error(`Object not found: ${key}`);
      return { key, body, size: body.length };
    }),
    delete: vi.fn(async (key: string) => ({ success: store.objects.delete(key), key })),
    deletePrefix: vi.fn(async (prefix: string) => {
      if (store.failPrefixDelete) return { success: false, key: prefix };
      for (const key of [...store.objects.keys()]) {
        if (key.startsWith(prefix)) store.objects.delete(key);
      }
      return { success: true, key: prefix };
    }),
  };
  return {
    getStorageClient: ({ orgId }: { orgId?: string } = {}) =>
      orgId ? scopeStorageToOrg(provider, orgId) : provider,
  };
});

import { GET as pdf } from '@/app/api/v1/assessments/[id]/report.pdf/route';
import { DELETE as remove } from '@/app/api/v1/assessments/[id]/route';
import { createMockAuthSession } from '@/tests/helpers/auth';
import { reportPdfLimiter, PDF_RENDERS_PER_MINUTE } from '@/lib/app/reports/pdf/limiter';
import { PdfRenderError } from '@/lib/app/reports/pdf/render';
import { verifyRenderToken } from '@/lib/app/reports/pdf/render-token';

const WS_A = 'org-a';
const WS_B = 'org-b';
const ALICE = 'cmuser0000000000000alice1';
const KEY_ID = 'cmkey000000000000000key1';
const DONE = new Date('2026-11-15T10:00:00.000Z');

function signedIn(userId: string, orgId: string) {
  const base = createMockAuthSession();
  mocks.getSession.mockResolvedValue({
    session: { ...base.session, userId, activeOrgId: orgId },
    user: { ...base.user, id: userId },
  });
}

/** An API key of Alice's, bound to workspace A, with `scopes`. */
function withKey(scopes: string[]) {
  mocks.getSession.mockResolvedValue(null);
  mocks.apiKey.mockResolvedValue({
    id: KEY_ID,
    userId: ALICE,
    scopes,
    rateLimitRpm: null,
    expiresAt: null,
    createdAt: new Date(),
    orgId: WS_A,
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
const KEY_HEADERS = { authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef' };

const BASE = 'http://localhost/api/v1/assessments';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string, headers: Record<string, string> = {}) =>
  pdf(new NextRequest(`${BASE}/${id}/report.pdf`, { headers }), params(id));
const del = (id: string) =>
  remove(new NextRequest(`${BASE}/${id}`, { method: 'DELETE' }), params(id));

async function errorOf(res: Response) {
  const body = (await res.json()) as { error?: { code: string; details?: unknown } };
  return { status: res.status, code: body.error?.code, details: body.error?.details };
}

/** A finished review in workspace A. */
const done = (over: Record<string, unknown> = {}) =>
  fake.seed({ status: 'COMPLETED', completedAt: DONE, ...over });

const cacheKey = (id: unknown, orgId = WS_A) =>
  `orgs/${orgId}/reports/${String(id)}/${DONE.getTime()}.pdf`;

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeDb();
  store.objects.clear();
  store.failPrefixDelete = false;
  mocks.membership.mockImplementation(
    async ({ where }: { where: { orgId_userId: { userId: string; orgId: string } } }) => {
      const { userId, orgId } = where.orgId_userId;
      return userId === ALICE && orgId === WS_A
        ? { role: 'MEMBER', org: { status: 'ACTIVE' } }
        : null;
    }
  );
  mocks.apiKey.mockResolvedValue(null);
  mocks.render.mockImplementation(async (id: string) => Buffer.from(`%PDF-1.7 ${id}`));
  reportPdfLimiter.reset(`user:${ALICE}`);
  signedIn(ALICE, WS_A);
});

describe('GET /api/v1/assessments/{id}/report.pdf', () => {
  it('renders the PDF once, keeps it, and serves it from the cache after that', async () => {
    const a = done();

    const first = await get(String(a.id));
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('application/pdf');
    expect(first.headers.get('content-disposition')).toBe(
      `attachment; filename="review-2026-11-15-${String(a.id)}.pdf"`
    );
    expect(first.headers.get('x-report-cache')).toBe('miss');
    expect(Buffer.from(await first.arrayBuffer()).toString()).toBe(`%PDF-1.7 ${String(a.id)}`);
    expect([...store.objects.keys()]).toEqual([cacheKey(a.id)]);

    const second = await get(String(a.id));
    expect(second.status).toBe(200);
    expect(second.headers.get('x-report-cache')).toBe('hit');
    expect(Buffer.from(await second.arrayBuffer()).toString()).toBe(`%PDF-1.7 ${String(a.id)}`);
    expect(mocks.render).toHaveBeenCalledTimes(1);
  });

  it('hands the renderer a token for this assessment in this workspace', async () => {
    const a = done();
    await get(String(a.id));
    const [id, mint] = mocks.render.mock.calls[0] as [string, () => string];
    expect(id).toBe(a.id);
    expect(verifyRenderToken(mint(), String(a.id)).orgId).toBe(WS_A);
  });

  it('renders again for a new run of the same id, under its own key', async () => {
    const a = done();
    await get(String(a.id));
    const later = new Date(DONE.getTime() + 60_000);
    a.completedAt = later;

    const res = await get(String(a.id));
    expect(res.headers.get('x-report-cache')).toBe('miss');
    expect(mocks.render).toHaveBeenCalledTimes(2);
    expect(store.objects.has(`orgs/${WS_A}/reports/${String(a.id)}/${later.getTime()}.pdf`)).toBe(
      true
    );
  });

  it('shares one render between two requests for the same uncached PDF', async () => {
    const a = done();
    let finish!: (b: Buffer) => void;
    mocks.render.mockImplementationOnce(() => new Promise<Buffer>((r) => (finish = r)));

    const both = Promise.all([get(String(a.id)), get(String(a.id))]);
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalled());
    finish(Buffer.from('%PDF shared'));
    const [one, two] = await both;

    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
  });

  it('409 REPORT_NOT_READY for a review with no report, naming its state', async () => {
    for (const status of ['QUEUED', 'RUNNING', 'FAILED', 'CANCELLED']) {
      const a = fake.seed({ status, completedAt: status === 'FAILED' ? DONE : null });
      expect(await errorOf(await get(String(a.id)))).toEqual({
        status: 409,
        code: 'REPORT_NOT_READY',
        details: { status: status.toLowerCase() },
      });
    }
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it('a partial review has a report', async () => {
    const a = done({ status: 'PARTIAL' });
    expect((await get(String(a.id))).status).toBe(200);
  });

  it("404 for another workspace's review, rendering nothing", async () => {
    const theirs = done({ orgId: WS_B });
    expect(await errorOf(await get(String(theirs.id)))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it('401 with no session or key', async () => {
    mocks.getSession.mockResolvedValue(null);
    const a = done();
    expect((await get(String(a.id))).status).toBe(401);
  });

  it('an API key needs the reports scope: assess alone is refused', async () => {
    const a = done();
    withKey(['assess']);
    expect((await get(String(a.id), KEY_HEADERS)).status).toBe(403);

    withKey(['reports']);
    const res = await get(String(a.id), KEY_HEADERS);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('500 PDF_RENDER_FAILED when the renderer fails, caching nothing', async () => {
    const a = done();
    mocks.render.mockRejectedValueOnce(new PdfRenderError('failed', 'Chromium died'));
    expect(await errorOf(await get(String(a.id)))).toMatchObject({
      status: 500,
      code: 'PDF_RENDER_FAILED',
    });
    expect(store.objects.size).toBe(0);
  });

  it('caps renders per caller, but not cache hits', async () => {
    const cached = done();
    await get(String(cached.id));
    for (let i = 1; i < PDF_RENDERS_PER_MINUTE; i += 1) {
      expect((await get(String(done().id))).status).toBe(200);
    }
    // The cap is spent: a new render is refused...
    const res = await get(String(done().id));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
    // ...and a cached PDF is still served.
    expect((await get(String(cached.id))).status).toBe(200);
  });

  it('404 for a review deleted while it rendered, removing the file it wrote', async () => {
    const a = done();
    mocks.render.mockImplementationOnce(async (id: string) => {
      fake.assessments.splice(fake.assessments.indexOf(a), 1);
      return Buffer.from(`%PDF ${id}`);
    });
    expect(await errorOf(await get(String(a.id)))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(store.objects.size).toBe(0);
  });

  it('422 REPORT_UNREADABLE for a review whose result cannot be read, caching nothing', async () => {
    const a = done();
    mocks.render.mockRejectedValueOnce(new PdfRenderError('unreadable', 'cannot read'));
    expect(await errorOf(await get(String(a.id)))).toMatchObject({
      status: 422,
      code: 'REPORT_UNREADABLE',
    });
    expect(store.objects.size).toBe(0);
  });

  it('503 PDF_RENDER_BUSY, with Retry-After, when the render queue is full', async () => {
    const a = done();
    mocks.render.mockRejectedValueOnce(new PdfRenderError('busy', 'full'));
    const res = await get(String(a.id));
    expect(res.headers.get('retry-after')).toBe('10');
    expect(await errorOf(res)).toMatchObject({ status: 503, code: 'PDF_RENDER_BUSY' });
  });
});

describe('DELETE /api/v1/assessments/{id} and the cached PDF', () => {
  it('a malformed id is still 404, touching no storage', async () => {
    const res = await remove(new NextRequest(`${BASE}/..`, { method: 'DELETE' }), params('..'));
    expect(await errorOf(res)).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it("deletes the review's cached PDFs with it, and no one else's", async () => {
    const a = done();
    const b = done();
    await get(String(a.id));
    await get(String(b.id));

    expect((await del(String(a.id))).status).toBe(200);
    expect([...store.objects.keys()]).toEqual([cacheKey(b.id)]);
  });

  it('keeps the review when storage will not delete its PDFs, so a retry can finish', async () => {
    const a = done();
    await get(String(a.id));
    store.failPrefixDelete = true;

    expect((await del(String(a.id))).status).toBe(500);
    expect(fake.assessments.map((r) => r.id)).toEqual([a.id]);

    store.failPrefixDelete = false;
    expect((await del(String(a.id))).status).toBe(200);
    expect(store.objects.size).toBe(0);
    expect(fake.assessments).toEqual([]);
  });
});

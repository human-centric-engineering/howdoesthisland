/**
 * Tests: who may read the `frameworks` routes (t-67).
 *
 * The model is HowDoesThisLand's IP: whole or by kind, platform admins only.
 * The list, a framework's versions and a version's catalogue need a browser
 * session or an API key with the `assess` scope. Nothing is served signed out.
 *
 * Real: the guards (session, API key and its scope, the platform-admin
 * check), the routes and the service, over 0.5.1 in the in-memory repo.
 * Replaced: the Prisma reads the guards make, and the framework store's two
 * Prisma-backed objects.
 *
 * @see lib/app/frameworks/api/route-auth.ts
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test' as const,
  TENANCY_MODE: 'single',
  CULTURE_MODULE_ENABLED: true,
  NEXT_PUBLIC_APP_URL: 'http://app.test',
  BETTER_AUTH_URL: 'http://app.test',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), apiKey: vi.fn() }));
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    orgMembership: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    orgSupportGrant: { findFirst: vi.fn(async () => null) },
    aiApiKey: { findFirst: mocks.apiKey, update: vi.fn(async () => ({})) },
    user: { findUnique: vi.fn(async () => null) },
    org: { findUnique: vi.fn(async () => null) },
  },
}));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: log }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: vi.fn(async () => log) }));
vi.mock('@/lib/orchestration/maintenance/idle-gate', () => ({ noteMaintenanceWork: vi.fn() }));

vi.mock('@/lib/app/frameworks/repo', async () => {
  const { FakeFrameworkRepo: Fake } = await import('@/tests/unit/lib/app/frameworks/fake-repo');
  return { prismaFrameworkRepo: new Fake() };
});
vi.mock('@/lib/app/frameworks/api/catalog', async () => {
  const { fakeCatalog, FakeFrameworkRepo: Fake } =
    await import('@/tests/unit/lib/app/frameworks/fake-repo');
  const { prismaFrameworkRepo: repo } = await import('@/lib/app/frameworks/repo');
  if (!(repo instanceof Fake)) throw new Error('the repo mock did not apply');
  return { prismaFrameworkCatalog: fakeCatalog(repo) };
});

import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import { importVersion, publishVersion } from '@/lib/app/frameworks/store';
import { prismaFrameworkRepo } from '@/lib/app/frameworks/repo';
import { FakeFrameworkRepo, OPEN_GATE } from '@/tests/unit/lib/app/frameworks/fake-repo';
import { createMockAuthSession } from '@/tests/helpers/auth';
import { GET as listRoute } from '@/app/api/v1/frameworks/route';
import { GET as frameworkRoute } from '@/app/api/v1/frameworks/[slug]/route';
import { GET as versionRoute } from '@/app/api/v1/frameworks/[slug]/versions/[version]/route';
import { GET as kindRoute } from '@/app/api/v1/frameworks/[slug]/versions/[version]/[kind]/route';
import { GET as catalogueRoute } from '@/app/api/v1/frameworks/[slug]/versions/[version]/catalogue/route';

const SLUG = 'howdoesthisland';
const V = '0.5.1';
const BASE = 'http://localhost/api/v1/frameworks';
const KEY_HEADERS = { authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef' };
const ctx = <T>(params: T) => ({ params: Promise.resolve(params) });
const req = (path: string, headers: Record<string, string>) =>
  new NextRequest(`${BASE}${path}`, { headers });

/** Each route, called as the given caller. */
const ROUTES = {
  list: (h: Record<string, string>) => listRoute(req('', h)),
  framework: (h: Record<string, string>) => frameworkRoute(req(`/${SLUG}`, h), ctx({ slug: SLUG })),
  catalogue: (h: Record<string, string>) =>
    catalogueRoute(req(`/${SLUG}/versions/${V}/catalogue`, h), ctx({ slug: SLUG, version: V })),
  model: (h: Record<string, string>) =>
    versionRoute(req(`/${SLUG}/versions/${V}`, h), ctx({ slug: SLUG, version: V })),
  kind: (h: Record<string, string>) =>
    kindRoute(
      req(`/${SLUG}/versions/${V}/rubric`, h),
      ctx({ slug: SLUG, version: V, kind: 'dimension' })
    ),
} as const;
const READERS = ['list', 'framework', 'catalogue'] as const;
const MODEL_ROUTES = ['model', 'kind'] as const;

function signedIn(role: 'USER' | 'ADMIN') {
  const base = createMockAuthSession();
  mocks.getSession.mockResolvedValue({
    session: { ...base.session, activeOrgId: null },
    user: { ...base.user, role },
  });
}

function withKey(scopes: string[]) {
  mocks.getSession.mockResolvedValue(null);
  const userId = 'cmuser0000000000000alice1';
  mocks.apiKey.mockResolvedValue({
    id: 'cmkey000000000000000key1',
    userId,
    scopes,
    rateLimitRpm: null,
    expiresAt: null,
    createdAt: new Date(),
    orgId: null,
    user: {
      id: userId,
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

beforeAll(async () => {
  if (!(prismaFrameworkRepo instanceof FakeFrameworkRepo)) throw new Error('repo not mocked');
  const raw = readFileSync('lib/app/frameworks/howdoesthisland/data/model-0.5.1.json', 'utf8');
  await importVersion(prismaFrameworkRepo, howDoesThisLand, raw);
  await publishVersion(prismaFrameworkRepo, SLUG, V, OPEN_GATE, new Date('2026-11-12T00:00:00Z'));
});

beforeEach(() => {
  mocks.getSession.mockReset();
  mocks.apiKey.mockReset();
  mocks.apiKey.mockResolvedValue(null);
});

describe('signed out', () => {
  it.each([...READERS, ...MODEL_ROUTES])('%s is refused with 401', async (route) => {
    mocks.getSession.mockResolvedValue(null);
    expect((await ROUTES[route]({})).status).toBe(401);
  });
});

describe('a signed-in user who is not a platform admin', () => {
  it.each(READERS)('may read %s', async (route) => {
    signedIn('USER');
    expect((await ROUTES[route]({})).status).toBe(200);
  });

  it.each(MODEL_ROUTES)('is refused the model (%s) with 403', async (route) => {
    signedIn('USER');
    expect((await ROUTES[route]({})).status).toBe(403);
  });
});

describe('an API key', () => {
  it.each(READERS)('with `assess` may read %s', async (route) => {
    withKey(['assess']);
    expect((await ROUTES[route](KEY_HEADERS)).status).toBe(200);
  });

  it.each(READERS)('without `assess` is refused %s with 403', async (route) => {
    withKey(['reports']);
    expect((await ROUTES[route](KEY_HEADERS)).status).toBe(403);
  });

  it.each(MODEL_ROUTES)('with `assess` is refused the model (%s) with 403', async (route) => {
    withKey(['assess']);
    expect((await ROUTES[route](KEY_HEADERS)).status).toBe(403);
  });
});

describe('a platform admin', () => {
  it.each([...READERS, ...MODEL_ROUTES])('may read %s', async (route) => {
    signedIn('ADMIN');
    expect((await ROUTES[route]({})).status).toBe(200);
  });
});

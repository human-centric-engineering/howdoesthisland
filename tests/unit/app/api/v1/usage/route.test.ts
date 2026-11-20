/**
 * Tests: GET /api/v1/usage (t-48) — who may read it, and that it reads the
 * workspace the guard entered.
 *
 * Real: the guard (session, API key and its scope, org entry at `multi`).
 * Replaced: the usage service, which records the org it was asked for (its
 * figures are tested in `tests/unit/lib/app/usage/service.test.ts`), and the
 * Prisma reads the guard makes.
 *
 * @see app/api/v1/usage/route.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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
  usage: vi.fn(),
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
vi.mock('@/lib/orchestration/maintenance/idle-gate', () => ({ noteMaintenanceWork: vi.fn() }));
vi.mock('@/lib/app/usage/service', () => ({
  getMonthUsage: mocks.usage,
}));

import { GET } from '@/app/api/v1/usage/route';
import { getTenantContext } from '@/lib/tenancy/context';
import { createMockAuthSession } from '@/tests/helpers/auth';
import { monthUsageSchema, type MonthUsage } from '@/lib/app/usage/wire';

const WS_A = 'org-a';
const ALICE = 'cmuser0000000000000alice1';
const KEY_ID = 'cmkey000000000000000key1';
const KEY_HEADERS = { authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef' };

const USAGE: MonthUsage = {
  month: { start: '2026-11-01T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z' },
  reviews: 1,
  calls: 4,
  spendUsd: 0.4,
  cap: { limitUsd: 10, remainingUsd: 9.6, exceeded: false },
  credits: { balance: 250, spentThisMonth: 0 },
  lines: [{ kind: 'no-project', projectId: null, reviews: 1, calls: 4, spendUsd: 0.4 }],
};

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

const get = (headers: Record<string, string> = {}) =>
  GET(new NextRequest('http://localhost/api/v1/usage', { headers }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.membership.mockImplementation(
    async ({ where }: { where: { orgId_userId: { userId: string; orgId: string } } }) =>
      where.orgId_userId.userId === ALICE && where.orgId_userId.orgId === WS_A
        ? { role: 'MEMBER', org: { status: 'ACTIVE' } }
        : null
  );
  mocks.apiKey.mockResolvedValue(null);
  // Records the org the guard entered, as the real service reads it.
  mocks.usage.mockImplementation(async (orgId: string) => {
    expect(getTenantContext()?.orgId).toBe(orgId);
    return USAGE;
  });
  signedIn(ALICE, WS_A);
});

describe('GET /api/v1/usage', () => {
  it('answers a member with the usage of the workspace they act in', async () => {
    const res = await get();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown };
    expect(body.success).toBe(true);
    expect(monthUsageSchema.parse(body.data)).toEqual(USAGE);
    expect(mocks.usage).toHaveBeenCalledWith(WS_A);
  });

  it('answers an API key with the reports scope, for its workspace', async () => {
    withKey(['reports']);

    const res = await get(KEY_HEADERS);

    expect(res.status).toBe(200);
    expect(mocks.usage).toHaveBeenCalledWith(WS_A);
  });

  it('refuses an API key without the reports scope', async () => {
    withKey(['assess']);

    const res = await get(KEY_HEADERS);

    expect(res.status).toBe(403);
    expect(mocks.usage).not.toHaveBeenCalled();
  });

  it('refuses a caller with no session or key', async () => {
    mocks.getSession.mockResolvedValue(null);

    const res = await get();

    expect(res.status).toBe(401);
    expect(mocks.usage).not.toHaveBeenCalled();
  });
});

/**
 * Tests: the code routes (t-60) — `POST /api/v1/codes/check` and
 * `POST /api/v1/codes/redeem`.
 *
 * Real: the guard (session, API key and its scope, org entry at `multi`),
 * the body validation, the error envelope, and the `redeem` proxy rule's path.
 * Replaced: the redeem service (tested in
 * `tests/unit/lib/app/credits/codes/redeem.test.ts`), the per-person limiter,
 * and the Prisma reads the guard makes.
 *
 * FORK NOTE — the proxy-rule case reads `@/lib/app/rate-limit` for real on
 * purpose: it is this fork's `redeem` rule under test. A change to that rule
 * should change it; the seam's pinned rules are in
 * tests/unit/lib/app/defaults.test.ts (ledger row 2).
 *
 * @see app/api/v1/codes/check/route.ts · app/api/v1/codes/redeem/route.ts
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
  checkCode: vi.fn(),
  redeemCode: vi.fn(),
  limit: vi.fn(),
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
vi.mock('@/lib/app/credits/codes/redeem', async () => {
  const actual = await vi.importActual<typeof import('@/lib/app/credits/codes/redeem')>(
    '@/lib/app/credits/codes/redeem'
  );
  return { ...actual, checkCode: mocks.checkCode, redeemCode: mocks.redeemCode };
});
vi.mock('@/lib/app/credits/codes/limiter', () => ({ redeemLimiter: { check: mocks.limit } }));

import { POST as check } from '@/app/api/v1/codes/check/route';
import { POST as redeem } from '@/app/api/v1/codes/redeem/route';
import { CodeRefusedError } from '@/lib/app/credits/codes/redeem';
import { codeCheckSchema, redemptionSchema, type Redemption } from '@/lib/app/credits/codes/wire';
import { REDEEM_PATH, REDEEM_TIER } from '@/lib/app/rate-limit';
import { getTenantContext } from '@/lib/tenancy/context';
import { createMockAuthSession } from '@/tests/helpers/auth';

const WS_A = 'org-a';
const ALICE = 'cmuser0000000000000alice1';
const KEY_ID = 'cmkey000000000000000key1';
const KEY_HEADERS = { authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef' };

const REDEMPTION: Redemption = {
  redemptionId: 'cmredemption0000000000001',
  code: 'ABCD-EFGH-JKMN',
  credits: 500,
  balance: 750,
  workspace: { id: WS_A, name: 'Alice’s workspace' },
};

function signedIn(userId: string, orgId: string) {
  const base = createMockAuthSession();
  mocks.getSession.mockResolvedValue({
    session: { ...base.session, userId, activeOrgId: orgId },
    user: { ...base.user, id: userId },
  });
}

function signedOut() {
  mocks.getSession.mockResolvedValue(null);
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

function post(
  handler: (req: NextRequest) => Promise<Response>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return handler(
    new NextRequest(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );
}

const checkCall = (body: unknown) => post(check, '/api/v1/codes/check', body);
const redeemCall = (body: unknown, headers?: Record<string, string>) =>
  post(redeem, '/api/v1/codes/redeem', body, headers);

async function errorOf(res: Response): Promise<{ code: string; message: string }> {
  const body = (await res.json()) as { success: false; error: { code: string; message: string } };
  expect(body.success).toBe(false);
  return body.error;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.membership.mockImplementation(
    async ({ where }: { where: { orgId_userId: { userId: string; orgId: string } } }) =>
      where.orgId_userId.userId === ALICE && where.orgId_userId.orgId === WS_A
        ? { role: 'MEMBER', org: { status: 'ACTIVE' } }
        : null
  );
  mocks.apiKey.mockResolvedValue(null);
  mocks.limit.mockReturnValue({ success: true, limit: 10, remaining: 9, reset: 0 });
  // Records the org the guard entered, as the real service is handed it.
  mocks.redeemCode.mockImplementation(async (_code: string, who: { orgId: string }) => {
    expect(getTenantContext()?.orgId).toBe(who.orgId);
    return REDEMPTION;
  });
  signedIn(ALICE, WS_A);
});

describe('POST /api/v1/codes/check', () => {
  it('answers anyone, signed out, with what the code gives', async () => {
    signedOut();
    mocks.checkCode.mockResolvedValue({
      status: 'active',
      code: 'ABCD-EFGH-JKMN',
      credits: 500,
      expiresAt: '2027-02-19T23:59:59.999Z',
      alreadyRedeemed: false,
    });

    const res = await checkCall({ code: 'abcd efgh jkmn' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    expect(codeCheckSchema.parse(body.data)).toEqual({
      status: 'active',
      code: 'ABCD-EFGH-JKMN',
      credits: 500,
      expiresAt: '2027-02-19T23:59:59.999Z',
    });
    // The public check asks about the code alone, for no one.
    expect(mocks.checkCode).toHaveBeenCalledWith('abcd efgh jkmn');
  });

  it('never says whether the caller redeemed it', async () => {
    mocks.checkCode.mockResolvedValue({ status: 'used-up', code: 'X', alreadyRedeemed: true });

    const body = (await (await checkCall({ code: 'X' })).json()) as {
      data: Record<string, unknown>;
    };

    expect(body.data).toEqual({ status: 'used-up', code: 'X' });
  });

  it('refuses a body outside the schema before any lookup', async () => {
    for (const body of [{}, { code: 'A'.repeat(65) }, { code: 'X', extra: 1 }, 'not json']) {
      const res = await checkCall(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await errorOf(res)).code).toBe('VALIDATION_ERROR');
    }
    expect(mocks.checkCode).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/codes/redeem', () => {
  it('redeems into the workspace the member acts in, as them', async () => {
    const res = await redeemCall({ code: 'ABCD-EFGH-JKMN' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    expect(redemptionSchema.parse(body.data)).toEqual(REDEMPTION);
    expect(mocks.redeemCode).toHaveBeenCalledWith('ABCD-EFGH-JKMN', {
      orgId: WS_A,
      userId: ALICE,
    });
  });

  it('answers an API key with the assess scope, for its workspace and owner', async () => {
    withKey(['assess']);

    const res = await redeemCall({ code: 'ABCD-EFGH-JKMN' }, KEY_HEADERS);

    expect(res.status).toBe(200);
    expect(mocks.redeemCode).toHaveBeenCalledWith('ABCD-EFGH-JKMN', {
      orgId: WS_A,
      userId: ALICE,
    });
  });

  it('refuses a read-only reports key', async () => {
    withKey(['reports']);

    const res = await redeemCall({ code: 'ABCD-EFGH-JKMN' }, KEY_HEADERS);

    expect(res.status).toBe(403);
    expect(mocks.redeemCode).not.toHaveBeenCalled();
  });

  it('refuses someone signed out', async () => {
    signedOut();

    const res = await redeemCall({ code: 'ABCD-EFGH-JKMN' });

    expect(res.status).toBe(401);
    expect(mocks.redeemCode).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it('counts every attempt against the person, and refuses one over the cap untried', async () => {
    mocks.limit.mockReturnValue({ success: false, limit: 10, remaining: 0, reset: Date.now() });

    const res = await redeemCall({ code: 'ABCD-EFGH-JKMN' });

    expect(res.status).toBe(429);
    expect(mocks.limit).toHaveBeenCalledWith(`user:${ALICE}`);
    expect(mocks.redeemCode).not.toHaveBeenCalled();
  });

  it('counts an attempt with a bad body too, so malformed tries are not free', async () => {
    const res = await redeemCall({ nope: true });

    expect(res.status).toBe(400);
    expect(mocks.limit).toHaveBeenCalledTimes(1);
    expect(mocks.redeemCode).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', 404, 'CODE_UNKNOWN'],
    ['expired', 410, 'CODE_EXPIRED'],
    ['used-up', 410, 'CODE_USED_UP'],
    ['revoked', 410, 'CODE_REVOKED'],
  ] as const)('answers a %s code %i %s', async (reason, status, code) => {
    mocks.redeemCode.mockRejectedValue(new CodeRefusedError(reason));

    const res = await redeemCall({ code: 'ABCD-EFGH-JKMN' });

    expect(res.status).toBe(status);
    expect((await errorOf(res)).code).toBe(code);
  });
});

describe('the redeem proxy rule', () => {
  it('covers the page and both code routes, and nothing else', () => {
    expect(REDEEM_TIER).toBe('redeem');
    for (const path of ['/redeem', '/redeem/', '/api/v1/codes/check', '/api/v1/codes/redeem']) {
      expect(REDEEM_PATH.test(path), path).toBe(true);
    }
    for (const path of [
      '/redeemed',
      '/redeem/x',
      '/api/v1/codes',
      '/api/v1/codes/other',
      '/api/v1/admin/codes',
      '/admin/codes',
    ]) {
      expect(REDEEM_PATH.test(path), path).toBe(false);
    }
  });
});

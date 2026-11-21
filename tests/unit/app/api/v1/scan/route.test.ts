/**
 * Tests: POST /api/v1/scan — the quick scan (t-24, D14), behind its switch
 * and open only to a session, an `assess` key or a free review code (t-61).
 *
 * The guard is real: a session or key goes through `withAuth`, which looks
 * the key up and enters its workspace, so a refused workspace is refused
 * here too. Only the Prisma reads it makes are stood in for.
 *
 * At `TENANCY_MODE=multi`, with no tenant context: the reconciliation's
 * hypothesis was that the scan needs no org because it reads only the
 * framework tables, which are shared config. The route, the service, the
 * store and the engine run for real, on the committed 0.5.1 file in the
 * framework store's in-memory repo. Prisma is a stand-in that records any
 * model it is asked for, so "stores nothing" is checked as "touched nothing
 * but the code it checked". A code is checked by t-60's real `checkCode`,
 * reading the rows `CODES` holds.
 *
 * The per-IP cap is checked through the real rate-limit dispatcher, which
 * loads `lib/app/rate-limit.ts` the way the proxy does.
 *
 * @see app/api/v1/scan/route.ts
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

interface MockEnv {
  NODE_ENV: 'test' | 'production';
  TENANCY_MODE: string;
  CULTURE_MODULE_ENABLED: boolean;
  QUICK_SCAN_ENABLED: boolean | undefined;
}
const mockEnv = vi.hoisted((): MockEnv => ({
  NODE_ENV: 'test',
  TENANCY_MODE: 'multi',
  CULTURE_MODULE_ENABLED: true,
  QUICK_SCAN_ENABLED: true,
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

/** Every Prisma model the code under test asked for. */
const touched = vi.hoisted(() => [] as string[]);
/** Review code rows by their canonical code, for `checkCode`. */
const CODES = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), membership: vi.fn(), apiKey: vi.fn() }));
vi.mock('@/lib/db/client', () => {
  // The reads the guard makes, and the code `checkCode` reads; any other
  // model is recorded and answers nothing.
  const models: Record<string, unknown> = {
    reviewCode: {
      findUnique: vi.fn(({ where }: { where: { code: string } }) =>
        Promise.resolve(CODES.get(where.code) ?? null)
      ),
    },
    orgMembership: { findUnique: mocks.membership, findMany: vi.fn(async () => []) },
    orgSupportGrant: { findFirst: vi.fn(async () => null) },
    aiApiKey: { findFirst: mocks.apiKey, update: vi.fn(async () => ({})) },
    user: { findUnique: vi.fn(async () => null) },
    org: { findUnique: vi.fn(async () => null) },
  };
  return {
    prisma: new Proxy(
      {},
      {
        get(_target, model) {
          touched.push(String(model));
          return models[String(model)] ?? new Proxy({}, { get: () => vi.fn() });
        },
      }
    ),
  };
});
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }));
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

import { POST } from '@/app/api/v1/scan/route';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import { importVersion, publishVersion } from '@/lib/app/frameworks/store';
import { prismaFrameworkRepo } from '@/lib/app/frameworks/repo';
import { FakeFrameworkRepo, OPEN_GATE } from '@/tests/unit/lib/app/frameworks/fake-repo';
import { getTenantContext } from '@/lib/tenancy/context';
import { MAX_CONTENT_CHARS, SCANS_PER_MINUTE } from '@/lib/app/assessments/limits';
import { quickScanViewSchema } from '@/lib/app/api/registry';
import { createMockAuthSession } from '@/tests/helpers/auth';

const RAW = readFileSync('lib/app/frameworks/howdoesthisland/data/model-0.5.1.json', 'utf8');
const TEXT =
  'We cut onboarding from two weeks to two days. Teams like yours save forty hours a month. Book a demo this week.';

function repo(): FakeFrameworkRepo {
  if (!(prismaFrameworkRepo instanceof FakeFrameworkRepo)) throw new Error('repo not mocked');
  return prismaFrameworkRepo;
}

const DAY = 24 * 60 * 60 * 1000;

const WS_A = 'org-a';
const WS_SUSPENDED = 'org-suspended';
const ALICE = 'cmuser0000000000000alice1';
const KEY_HEADERS = { Authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef' };

/** Alice signed in, acting in `orgId`. */
function signedIn(orgId: string = WS_A): void {
  const base = createMockAuthSession();
  mocks.getSession.mockResolvedValue({
    session: { ...base.session, userId: ALICE, activeOrgId: orgId },
    user: { ...base.user, id: ALICE },
  });
}

/** An API key of Alice's, minted in `orgId`, with `scopes`. */
function withKey(scopes: string[], orgId: string = WS_A): void {
  mocks.apiKey.mockResolvedValue({
    id: 'cmkey000000000000000key1',
    userId: ALICE,
    scopes,
    rateLimitRpm: null,
    expiresAt: null,
    createdAt: new Date(),
    orgId,
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

/** A review code row as `checkCode` reads it. */
function codeRow(code: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `id-${code}`,
    code,
    creditsPerRedemption: 500,
    maxRedemptions: 3,
    expiresAt: new Date(Date.now() + 30 * DAY),
    revokedAt: null,
    _count: { redemptions: 0 },
    ...over,
  };
}

/** Codes as people type them, and their rows. */
const ACTIVE = 'abcd-efgh-jkmn';
const EXPIRED = 'BCDE-FGHJ-KMNP';
const REVOKED = 'CDEF-GHJK-MNPQ';
const USED_UP = 'DEFG-HJKM-NPQR';
const UNKNOWN = 'EFGH-JKMN-PQRS';

function seedCodes(): void {
  CODES.clear();
  CODES.set('ABCDEFGHJKMN', codeRow('ABCDEFGHJKMN'));
  CODES.set('BCDEFGHJKMNP', codeRow('BCDEFGHJKMNP', { expiresAt: new Date(Date.now() - DAY) }));
  CODES.set('CDEFGHJKMNPQ', codeRow('CDEFGHJKMNPQ', { revokedAt: new Date(Date.now() - DAY) }));
  CODES.set('DEFGHJKMNPQR', codeRow('DEFGHJKMNPQR', { _count: { redemptions: 3 } }));
}

/**
 * POST a scan. Unless `body` names its own `code` (or is sent raw), it
 * carries `ACTIVE`: the caller holding a free review code and no account.
 */
function scan(body: unknown, raw = false, headers: Record<string, string> = {}): Promise<Response> {
  const withCode =
    !raw && typeof body === 'object' && body !== null && !('code' in body)
      ? { ...body, code: ACTIVE }
      : body;
  return POST(
    new NextRequest('http://localhost/api/v1/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: raw ? String(body) : JSON.stringify(withCode),
    })
  );
}

/** A scan by a caller sending only what `body` holds: no code added. */
const scanAs = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  scan({ code: undefined, ...body }, false, headers);

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}
const read = async (res: Response) => (await res.json()) as Envelope;

async function refusal(res: Response) {
  const body = await read(res);
  expect(body.success).toBe(false);
  return { status: res.status, code: body.error?.code, details: body.error?.details };
}

beforeAll(async () => {
  await importVersion(repo(), howDoesThisLand, RAW);
  await publishVersion(
    repo(),
    howDoesThisLand.slug,
    '0.5.1',
    OPEN_GATE,
    new Date('2026-11-12T21:50:46Z')
  );
});

beforeEach(() => {
  touched.length = 0;
  mocks.getSession.mockReset();
  mocks.getSession.mockResolvedValue(null);
  mocks.apiKey.mockReset();
  mocks.apiKey.mockResolvedValue(null);
  // Alice is a member of workspace A, which is active, and of one that is suspended.
  mocks.membership.mockReset();
  mocks.membership.mockImplementation(
    async ({ where }: { where: { orgId_userId: { userId: string; orgId: string } } }) => {
      const { userId, orgId } = where.orgId_userId;
      if (userId !== ALICE) return null;
      if (orgId === WS_A) return { role: 'MEMBER', org: { status: 'ACTIVE' } };
      if (orgId === WS_SUSPENDED) return { role: 'MEMBER', org: { status: 'SUSPENDED' } };
      return null;
    }
  );
  mockEnv.CULTURE_MODULE_ENABLED = true;
  mockEnv.QUICK_SCAN_ENABLED = true;
  seedCodes();
});

describe('POST /api/v1/scan with a free review code and no session, at multi', () => {
  it('answers the quick scan, as the registry declares it, touching only the code it checked', async () => {
    expect(getTenantContext()).toBeNull();
    const res = await scan({ text: TEXT, context: { contentType: 'sales_email' } });

    expect(res.status).toBe(200);
    const body = await read(res);
    expect(quickScanViewSchema.parse(body.data)).toEqual(body.data);
    expect(body.data).toMatchObject({
      framework: { slug: 'howdoesthisland', version: '0.5.1' },
      wordCount: 22,
      overall: expect.any(Number),
      band: expect.any(String),
      context: { contentType: 'sales_email', archetype: 'general' },
    });
    // The result is the quick scan's alone: no judge, no AI.
    expect(JSON.stringify(body.data?.result)).not.toContain('"source":"ai"');
    // Nothing stored, and nothing read outside the framework store but the
    // code: not its redemptions, and no redemption written, since a scan
    // never uses one up.
    expect(touched).toEqual(['reviewCode']);
  });

  it('is deterministic: the same text and context score the same', async () => {
    const first = await read(await scan({ text: TEXT }));
    const second = await read(await scan({ text: TEXT }));
    expect(second.data).toEqual(first.data);
  });

  it('scores against the version asked for', async () => {
    const res = await scan({ text: TEXT, framework: 'howdoesthisland', version: '0.5.1' });
    expect(res.status).toBe(200);
  });
});

describe('the quick-scan switch (t-61)', () => {
  it('404 NOT_FOUND while it is off, whoever calls, before the body is read', async () => {
    mockEnv.QUICK_SCAN_ENABLED = false;
    signedIn();
    withKey(['assess']);

    expect(await refusal(await scan({ text: TEXT }))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(await refusal(await scan('{not json', true))).toMatchObject({ status: 404 });
    expect(await refusal(await scanAs({ text: TEXT }, KEY_HEADERS))).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.apiKey).not.toHaveBeenCalled();
    expect(touched).toEqual([]);
  });

  it('is off in production when unset, and on otherwise', async () => {
    mockEnv.QUICK_SCAN_ENABLED = undefined;
    Object.assign(mockEnv, { NODE_ENV: 'production' });
    try {
      expect((await scan({ text: TEXT })).status).toBe(404);
    } finally {
      Object.assign(mockEnv, { NODE_ENV: 'test' });
    }
    expect((await scan({ text: TEXT })).status).toBe(200);
  });
});

describe('who may run the quick scan (t-61)', () => {
  it('a signed-in member, through the guard, inside their workspace, reading no code', async () => {
    signedIn();
    expect((await scanAs({ text: TEXT })).status).toBe(200);
    expect(mocks.membership).toHaveBeenCalled();
    expect(touched).not.toContain('reviewCode');
  });

  it('a signed-in member sending a code is let in on the session, and the code is not read', async () => {
    signedIn();
    expect((await scanAs({ text: TEXT, code: UNKNOWN })).status).toBe(200);
    // Not validated either: a member's code is ignored, whatever it holds.
    expect((await scanAs({ text: TEXT, code: 42 })).status).toBe(200);
    expect((await scanAs({ text: TEXT, code: 'A'.repeat(65) })).status).toBe(200);
    expect(touched).not.toContain('reviewCode');
  });

  it('an API key with the assess scope, entering the workspace it was minted in', async () => {
    withKey(['assess']);
    expect((await scanAs({ text: TEXT }, KEY_HEADERS)).status).toBe(200);
    expect(mocks.apiKey).toHaveBeenCalledTimes(1);
    expect(touched).not.toContain('reviewCode');
  });

  it('403 FORBIDDEN for a key without the assess scope, even with a good code', async () => {
    withKey(['reports']);
    expect(await refusal(await scan({ text: TEXT }, false, KEY_HEADERS))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(touched).not.toContain('reviewCode');
  });

  it('403 FORBIDDEN, before the body is read, for a key without the scope sending a page', async () => {
    withKey(['reports']);
    expect(await refusal(await scanAs({ url: 'https://example.com' }, KEY_HEADERS))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('403 FORBIDDEN for a key or a session whose workspace is suspended, even with a good code', async () => {
    withKey(['assess'], WS_SUSPENDED);
    expect(await refusal(await scan({ text: TEXT }, false, KEY_HEADERS))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    mocks.apiKey.mockResolvedValue(null);
    signedIn(WS_SUSPENDED);
    expect(await refusal(await scan({ text: TEXT }))).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(touched).not.toContain('reviewCode');
  });

  it('401 UNAUTHORIZED for an API key that is not valid, even with a good code', async () => {
    expect(await refusal(await scan({ text: TEXT }, false, KEY_HEADERS))).toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('500, not the code path, when the session lookup fails, even with a good code', async () => {
    mocks.getSession.mockRejectedValue(new Error('session store down'));
    const res = await scan({ text: TEXT });
    expect(res.status).toBe(500);
    expect(touched).not.toContain('reviewCode');
  });

  it('401 ACCOUNT_REQUIRED with no session, no key and no code', async () => {
    expect(await refusal(await scanAs({ text: TEXT }))).toMatchObject({
      status: 401,
      code: 'ACCOUNT_REQUIRED',
    });
    expect(mocks.getSession).toHaveBeenCalled();
    expect(touched).toEqual([]);
  });

  it.each([
    ['expired', EXPIRED],
    ['revoked', REVOKED],
    ['used-up', USED_UP],
    ['unknown', UNKNOWN],
    ['malformed', 'not a code'],
    ['longer than any typed code', 'A'.repeat(65)],
    ['not a string', 42],
  ])('401 ACCOUNT_REQUIRED, said alike, for a code that is %s', async (_label, code) => {
    const res = await scanAs({ text: TEXT, code });
    const body = await read(res);
    expect(res.status).toBe(401);
    expect(body.error?.code).toBe('ACCOUNT_REQUIRED');
    // The same words whichever it is: the scan is not a way to learn a code's state.
    const none = await read(await scanAs({ text: TEXT }));
    expect(body.error?.message).toBe(none.error?.message);
  });

  it('401 ACCOUNT_REQUIRED before the body is checked, for a caller with no code', async () => {
    for (const body of [{}, { text: TEXT, wait: true }, { url: 'https://example.com' }]) {
      expect((await refusal(await scanAs(body))).code).toBe('ACCOUNT_REQUIRED');
    }
  });

  it('accepts a code however it is typed, and does not use one up', async () => {
    for (const code of ['ABCDEFGHJKMN', ' abcd efgh jkmn ']) {
      expect((await scanAs({ text: TEXT, code })).status).toBe(200);
    }
    // Only the code was read: no redemption counted or written.
    expect(touched.every((model) => model === 'reviewCode')).toBe(true);
  });
});

describe('POST /api/v1/scan refusals', () => {
  it('401 ACCOUNT_REQUIRED for a page to fetch (D14) or a file, before the schema', async () => {
    expect(await refusal(await scan({ url: 'https://example.com' }))).toMatchObject({
      status: 401,
      code: 'ACCOUNT_REQUIRED',
    });
    expect(
      await refusal(await scan({ text: TEXT, file: { name: 'a.txt', base64: 'aGk=' } }))
    ).toMatchObject({ status: 401, code: 'ACCOUNT_REQUIRED' });
    // The code was checked first, and nothing else read.
    expect(touched.every((model) => model === 'reviewCode')).toBe(true);
  });

  it('400 VALIDATION_ERROR for a body that is not JSON, has no text, or has an unknown key', async () => {
    expect((await refusal(await scan('{not json', true))).code).toBe('VALIDATION_ERROR');
    expect((await refusal(await scan({}))).code).toBe('VALIDATION_ERROR');
    expect((await refusal(await scan({ text: TEXT, wait: true }))).code).toBe('VALIDATION_ERROR');
  });

  it('400 CONTENT_EMPTY for text that is only whitespace', async () => {
    expect(await refusal(await scan({ text: '  \n\t ' }))).toMatchObject({
      status: 400,
      code: 'CONTENT_EMPTY',
    });
  });

  it('400 CONTEXT_INVALID naming each problem by path', async () => {
    const res = await scan({ text: TEXT, context: { contentType: 'haiku', role: 'cfoo' } });
    const { status, code, details } = await refusal(res);
    expect({ status, code }).toEqual({ status: 400, code: 'CONTEXT_INVALID' });
    expect(details?.issues).toEqual([
      { path: 'contentType', message: expect.any(String) },
      { path: 'role', message: expect.any(String) },
    ]);
  });

  it('400 CONTEXT_INVALID for culture with the culture module off', async () => {
    mockEnv.CULTURE_MODULE_ENABLED = false;
    const res = await scan({ text: TEXT, context: { culture: { reader: 'jp' } } });
    expect((await refusal(res)).code).toBe('CONTEXT_INVALID');
  });

  it('404 FRAMEWORK_NOT_FOUND and FRAMEWORK_VERSION_NOT_FOUND', async () => {
    expect(await refusal(await scan({ text: TEXT, framework: 'nope' }))).toMatchObject({
      status: 404,
      code: 'FRAMEWORK_NOT_FOUND',
    });
    expect(await refusal(await scan({ text: TEXT, version: '9.9.9' }))).toMatchObject({
      status: 404,
      code: 'FRAMEWORK_VERSION_NOT_FOUND',
    });
  });

  it('422 TEXT_TOO_LONG past the limit, counted in characters', async () => {
    // Emoji are two UTF-16 units each: within the schema's bound, over the limit.
    const long = '🙂'.repeat(MAX_CONTENT_CHARS + 1);
    expect(await refusal(await scan({ text: long }))).toMatchObject({
      status: 422,
      code: 'TEXT_TOO_LONG',
    });
  });
});

describe('the per-IP cap (lib/app/rate-limit.ts)', () => {
  it(`lets ${SCANS_PER_MINUTE} scans a minute through from one IP, then answers 429`, async () => {
    // tests/setup.ts bypasses rate limiting; run the dispatcher for real.
    vi.stubEnv('RATE_LIMIT_BYPASS', '');
    const { applyRateLimit } = await import('@/lib/security/rate-limit-middleware');
    const make = (ip: string) =>
      new NextRequest('http://localhost/api/v1/scan', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
      });

    for (let i = 0; i < SCANS_PER_MINUTE; i += 1) {
      expect(await applyRateLimit(make('192.0.2.10'))).toBeNull();
    }
    const blocked = await applyRateLimit(make('192.0.2.10'));
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get('X-RateLimit-Limit')).toBe(String(SCANS_PER_MINUTE));
    // Another IP has its own allowance.
    expect(await applyRateLimit(make('192.0.2.11'))).toBeNull();
    vi.unstubAllEnvs();
  });
});

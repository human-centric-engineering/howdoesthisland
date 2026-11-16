/**
 * Tests: POST /api/v1/scan — the free quick scan (t-24, D7, D14).
 *
 * At `TENANCY_MODE=multi`, with no session and no tenant context: the
 * reconciliation's hypothesis was that the scan needs no org because it
 * reads only the framework tables, which are shared config. The route, the
 * service, the store and the engine run for real, on the committed 0.5.1
 * file in the framework store's in-memory repo. Prisma is a stand-in that
 * records any model it is asked for, so "stores nothing" is checked as
 * "touched nothing".
 *
 * The per-IP cap is checked through the real rate-limit dispatcher, which
 * loads `lib/app/rate-limit.ts` the way the proxy does.
 *
 * @see app/api/v1/scan/route.ts
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test' as const,
  TENANCY_MODE: 'multi',
  CULTURE_MODULE_ENABLED: true,
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

/** Every Prisma model the code under test asked for. */
const touched = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/db/client', () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, model) {
        touched.push(String(model));
        return new Proxy({}, { get: () => vi.fn() });
      },
    }
  ),
}));
const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: mockGetSession } } }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
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

const RAW = readFileSync('lib/app/frameworks/howdoesthisland/data/model-0.5.1.json', 'utf8');
const TEXT =
  'We cut onboarding from two weeks to two days. Teams like yours save forty hours a month. Book a demo this week.';

function repo(): FakeFrameworkRepo {
  if (!(prismaFrameworkRepo instanceof FakeFrameworkRepo)) throw new Error('repo not mocked');
  return prismaFrameworkRepo;
}

function scan(body: unknown, raw = false): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/v1/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw ? String(body) : JSON.stringify(body),
    })
  );
}

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
  mockGetSession.mockReset();
  mockEnv.CULTURE_MODULE_ENABLED = true;
});

describe('POST /api/v1/scan with no session, at multi', () => {
  it('answers the quick scan, as the registry declares it, touching no database model', async () => {
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
    // Nothing stored, nothing read outside the framework store, no session asked for.
    expect(touched).toEqual([]);
    expect(mockGetSession).not.toHaveBeenCalled();
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

describe('POST /api/v1/scan refusals', () => {
  it('401 ACCOUNT_REQUIRED for a page to fetch (D14) or a file, before anything else', async () => {
    expect(await refusal(await scan({ url: 'https://example.com' }))).toMatchObject({
      status: 401,
      code: 'ACCOUNT_REQUIRED',
    });
    expect(
      await refusal(await scan({ text: TEXT, file: { name: 'a.txt', base64: 'aGk=' } }))
    ).toMatchObject({ status: 401, code: 'ACCOUNT_REQUIRED' });
    expect(touched).toEqual([]);
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

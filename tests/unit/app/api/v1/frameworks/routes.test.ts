/**
 * Unit tests: the public `frameworks` routes (t-11).
 *
 * GET /api/v1/frameworks
 * GET /api/v1/frameworks/{slug}
 * GET /api/v1/frameworks/{slug}/versions/{version}
 * GET /api/v1/frameworks/{slug}/versions/{version}/{kind}
 *
 * The routes, the service, the store and the codec all run for real, on the
 * committed 0.5.1 file imported into the in-memory repo the store's own tests
 * use. Only the two Prisma-backed objects are replaced, by that fake.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import { importVersion, publishVersion } from '@/lib/app/frameworks/store';
import { prismaFrameworkRepo } from '@/lib/app/frameworks/repo';
import { FakeFrameworkRepo } from '@/tests/unit/lib/app/frameworks/fake-repo';
import { GET as listRoute } from '@/app/api/v1/frameworks/route';
import { GET as frameworkRoute } from '@/app/api/v1/frameworks/[slug]/route';
import { GET as versionRoute } from '@/app/api/v1/frameworks/[slug]/versions/[version]/route';
import { GET as kindRoute } from '@/app/api/v1/frameworks/[slug]/versions/[version]/[kind]/route';

const mockEnv = vi.hoisted(
  (): {
    NODE_ENV: 'development' | 'production' | 'test';
    CULTURE_MODULE_ENABLED: boolean | undefined;
  } => ({ NODE_ENV: 'test', CULTURE_MODULE_ENABLED: undefined })
);
vi.mock('@/lib/env', () => ({ env: mockEnv }));

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

const FILE = 'lib/app/frameworks/howdoesthisland/data/model-0.5.1.json';
const RAW = readFileSync(FILE, 'utf8');
const SLUG = 'howdoesthisland';
const BASE = 'http://localhost/api/v1/frameworks';

function repo(): FakeFrameworkRepo {
  if (!(prismaFrameworkRepo instanceof FakeFrameworkRepo)) throw new Error('repo not mocked');
  return prismaFrameworkRepo;
}

/** 0.5.1 relabelled as another version, so it can sit beside it as a draft. */
function asVersion(version: string): string {
  const doc = JSON.parse(RAW) as { meta: Record<string, unknown> };
  doc.meta.version = version;
  return JSON.stringify(doc);
}

/** JSON with every object's keys sorted, so two equal models hash alike. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const canonicalHash = (value: unknown) =>
  createHash('sha256').update(canonical(value)).digest('hex');

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, { headers });
}
const ctx = <T>(params: T) => ({ params: Promise.resolve(params) });

interface Envelope {
  success: boolean;
  data?: unknown;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string };
}
async function body(res: Response): Promise<Envelope> {
  return (await res.json()) as Envelope;
}

const version = (v: string, extra: Record<string, string> = {}) =>
  versionRoute(get(`/${SLUG}/versions/${v}`, extra), ctx({ slug: SLUG, version: v }));
const kind = (k: string, v = '0.5.1', extra: Record<string, string> = {}) =>
  kindRoute(get(`/${SLUG}/versions/${v}/${k}`, extra), ctx({ slug: SLUG, version: v, kind: k }));

beforeAll(async () => {
  await importVersion(repo(), howDoesThisLand, RAW);
  await publishVersion(repo(), SLUG, '0.5.1', new Date('2026-11-12T21:50:46.474Z'));
  // A draft beside it, which no route may show.
  await importVersion(repo(), howDoesThisLand, asVersion('0.6.0'));
});

function withCulture<T>(enabled: boolean | undefined, fn: () => Promise<T>): Promise<T> {
  const before = mockEnv.CULTURE_MODULE_ENABLED;
  mockEnv.CULTURE_MODULE_ENABLED = enabled;
  return fn().finally(() => {
    mockEnv.CULTURE_MODULE_ENABLED = before;
  });
}

describe('GET /api/v1/frameworks', () => {
  it('lists the framework with its published version only, without signing in', async () => {
    const res = await listRoute(get(''));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({
      success: true,
      data: [
        {
          slug: SLUG,
          name: howDoesThisLand.name,
          summary: howDoesThisLand.summary,
          latestVersion: '0.5.1',
          versions: [
            {
              version: '0.5.1',
              schemaVersion: '4',
              status: 'published',
              publishedAt: '2026-11-12T21:50:46.474Z',
              sourceSha256: createHash('sha256').update(RAW).digest('hex'),
            },
          ],
        },
      ],
    });
  });

  it('answers a matching If-None-Match with a 304 and no body', async () => {
    const first = await listRoute(get(''));
    const etag = first.headers.get('ETag');
    expect(etag).toMatch(/^W\/".+"$/);
    const again = await listRoute(get('', { 'If-None-Match': etag ?? '' }));
    expect(again.status).toBe(304);
    expect(again.headers.get('ETag')).toBe(etag);
    expect(await again.text()).toBe('');
  });
});

describe('GET /api/v1/frameworks/{slug}', () => {
  it('serves the framework and the kinds a version has, culture included when on', async () => {
    const res = await frameworkRoute(get(`/${SLUG}`), ctx({ slug: SLUG }));
    expect(res.status).toBe(200);
    const { data } = await body(res);
    expect(data).toMatchObject({ slug: SLUG, latestVersion: '0.5.1' });
    const kinds = (data as { kinds: string[] }).kinds;
    expect(kinds.slice(0, 3)).toEqual(['appeal', 'dimension', 'lens']);
    expect(kinds).toContain('lever');
    expect(kinds).toContain('culture_country');
  });

  it('leaves the culture kinds out when the switch is off', async () => {
    const res = await withCulture(false, () =>
      frameworkRoute(get(`/${SLUG}`), ctx({ slug: SLUG }))
    );
    const kinds = ((await body(res)).data as { kinds: string[] }).kinds;
    expect(kinds.filter((k) => k.startsWith('culture_'))).toEqual([]);
    expect(kinds).toContain('appeal');
  });

  it.each([['nope'], ['HowDoesThisLand'], ['../etc']])(
    'answers %s with 404 FRAMEWORK_NOT_FOUND',
    async (slug) => {
      const res = await frameworkRoute(get(`/${slug}`), ctx({ slug }));
      expect(res.status).toBe(404);
      expect((await body(res)).error?.code).toBe('FRAMEWORK_NOT_FOUND');
    }
  );

  it('304s on a matching If-None-Match', async () => {
    const etag = (await frameworkRoute(get(`/${SLUG}`), ctx({ slug: SLUG }))).headers.get('ETag');
    const res = await frameworkRoute(
      get(`/${SLUG}`, { 'If-None-Match': etag ?? '' }),
      ctx({ slug: SLUG })
    );
    expect(res.status).toBe(304);
  });
});

describe('GET /api/v1/frameworks/{slug}/versions/{version}', () => {
  it('serves the model; its canonical hash equals the committed file’s', async () => {
    const res = await version('0.5.1');
    expect(res.status).toBe(200);
    const { data, meta } = await body(res);
    expect(canonicalHash(data)).toBe(canonicalHash(JSON.parse(RAW)));
    expect(meta).toEqual({
      framework: SLUG,
      version: '0.5.1',
      schemaVersion: '4',
      status: 'published',
      publishedAt: '2026-11-12T21:50:46.474Z',
      sourceSha256: createHash('sha256').update(RAW).digest('hex'),
    });
  });

  it('leaves the culture section out, and names it in meta.omitted, when the switch is off', async () => {
    const { data, meta } = await body(await withCulture(false, () => version('0.5.1')));
    const model = data as Record<string, unknown>;
    expect(model).not.toHaveProperty('culture');
    expect(model).toHaveProperty('appeals');
    expect(meta?.omitted).toEqual(['culture']);
  });

  it('defaults the switch off in production and on elsewhere', async () => {
    mockEnv.NODE_ENV = 'production';
    try {
      expect((await body(await version('0.5.1'))).meta?.omitted).toEqual(['culture']);
      const on = await body(await withCulture(true, () => version('0.5.1')));
      expect(on.meta).not.toHaveProperty('omitted');
    } finally {
      mockEnv.NODE_ENV = 'test';
    }
    expect((await body(await version('0.5.1'))).meta).not.toHaveProperty('omitted');
  });

  it('304s on a matching If-None-Match, and the switch changes the ETag', async () => {
    const etag = (await version('0.5.1')).headers.get('ETag') ?? '';
    expect((await version('0.5.1', { 'If-None-Match': etag })).status).toBe(304);
    const off = await withCulture(false, () => version('0.5.1', { 'If-None-Match': etag }));
    expect(off.status).toBe(200);
    expect(off.headers.get('ETag')).not.toBe(etag);
  });

  it.each([
    ['a draft', '0.6.0'],
    ['an unknown version', '9.9.9'],
    ['a malformed version', 'latest'],
  ])('answers %s with 404 FRAMEWORK_VERSION_NOT_FOUND', async (_label, v) => {
    const res = await version(v);
    expect(res.status).toBe(404);
    expect((await body(res)).error?.code).toBe('FRAMEWORK_VERSION_NOT_FOUND');
  });

  it('answers an unknown framework with 404 FRAMEWORK_NOT_FOUND', async () => {
    const res = await versionRoute(
      get('/nope/versions/0.5.1'),
      ctx({ slug: 'nope', version: '0.5.1' })
    );
    expect(res.status).toBe(404);
    expect((await body(res)).error?.code).toBe('FRAMEWORK_NOT_FOUND');
  });

  it('keeps serving a retired version, marked retired', async () => {
    const stored = [...repo().versions.values()].find((v) => v.version === '0.5.1');
    if (!stored) throw new Error('0.5.1 not imported');
    stored.status = 'RETIRED';
    try {
      const { meta } = await body(await version('0.5.1'));
      expect(meta?.status).toBe('retired');
    } finally {
      stored.status = 'PUBLISHED';
    }
  });
});

describe('GET /api/v1/frameworks/{slug}/versions/{version}/{kind}', () => {
  const model = JSON.parse(RAW) as Record<string, unknown> & {
    perspectives: Array<{ id: string; levers: Array<{ id: string }> }>;
    knowledge_refs: { thinkers: unknown[] };
    culture: { countries: unknown[] };
  };

  it('serves one kind’s records exactly as the model has them, in order', async () => {
    const res = await kind('red_flag');
    expect(res.status).toBe(200);
    const { data, meta } = await body(res);
    expect(data).toEqual(model.red_flags);
    expect(meta).toMatchObject({ framework: SLUG, version: '0.5.1', kind: 'red_flag', count: 9 });
  });

  it('serves a kind held one level down in its section', async () => {
    const { data } = await body(await kind('knowledge_thinker'));
    expect(data).toEqual(model.knowledge_refs.thinkers);
  });

  it('flattens a nested kind across its parents and maps each to its parent', async () => {
    const { data, meta } = await body(await kind('lever'));
    const levers = model.perspectives.flatMap((p) => p.levers);
    expect(data).toEqual(levers);
    expect(meta?.parentKind).toBe('perspective');
    const parents = meta?.parents as Record<string, string>;
    for (const p of model.perspectives) {
      for (const l of p.levers) expect(parents[l.id]).toBe(p.id);
    }
  });

  it('serves the culture kinds when the switch is on, and 404s them when it is off', async () => {
    expect((await body(await kind('culture_country'))).data).toEqual(model.culture.countries);
    const off = await withCulture(false, () => kind('culture_country'));
    expect(off.status).toBe(404);
    expect((await body(off)).error?.code).toBe('FRAMEWORK_KIND_NOT_FOUND');
  });

  it.each([['nope'], ['section'], ['Red_Flag'], ['red-flag']])(
    'answers kind %s with 404 FRAMEWORK_KIND_NOT_FOUND',
    async (k) => {
      const res = await kind(k);
      expect(res.status).toBe(404);
      expect((await body(res)).error?.code).toBe('FRAMEWORK_KIND_NOT_FOUND');
    }
  );

  it('checks the version before the kind', async () => {
    const res = await kind('red_flag', '0.6.0');
    expect((await body(res)).error?.code).toBe('FRAMEWORK_VERSION_NOT_FOUND');
  });

  it('304s per kind, and an unknown kind is a 404 even with a stale ETag', async () => {
    const etag = (await kind('move')).headers.get('ETag') ?? '';
    expect((await kind('move', '0.5.1', { 'If-None-Match': etag })).status).toBe(304);
    expect((await kind('dimension', '0.5.1', { 'If-None-Match': etag })).status).toBe(200);
    expect((await kind('nope', '0.5.1', { 'If-None-Match': etag })).status).toBe(404);
  });
});

describe('an unexpected failure', () => {
  it('is a 500 in the standard envelope, not a 404', async () => {
    const spy = vi.spyOn(repo(), 'findVersionById').mockRejectedValueOnce(new Error('db down'));
    // A version not yet materialised, so the read reaches the repo.
    await publishVersion(repo(), SLUG, '0.6.0', new Date('2026-11-13T00:00:00Z'));
    try {
      const res = await version('0.6.0');
      expect(res.status).toBe(500);
      expect((await body(res)).success).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

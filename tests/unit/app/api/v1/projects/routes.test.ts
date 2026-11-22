/**
 * Tests: the `projects` routes (t-70).
 *
 * POST/GET /api/v1/projects · GET/PATCH/DELETE …/{id}
 *
 * Real: the guard (session, API key and its scope, org entry at `multi`),
 * the service, and the 0.5.1 engine, so a project's defaults are checked
 * against real ids. Replaced: Prisma by a small stateful fake of the project
 * table (so assertions read the rows left behind), and the catalogue of
 * framework versions.
 *
 * @see app/api/v1/projects/
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test' as const,
  TENANCY_MODE: 'multi',
  CULTURE_MODULE_ENABLED: false,
  NEXT_PUBLIC_APP_URL: 'http://app.test',
  BETTER_AUTH_URL: 'http://app.test',
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  membership: vi.fn(),
  apiKey: vi.fn(),
  engineForVersion: vi.fn(),
}));
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }));

type Row = Record<string, unknown>;

/** The project table, and just enough of `where` to read it as the service asks. */
function createProjectTable() {
  const rows: Row[] = [];
  let seq = 0;
  const matches = (row: Row, where: Row = {}) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const view = (row: Row) => ({
    ...row,
    framework: { slug: 'howdoesthisland' },
    _count: { assessments: 0 },
  });
  return {
    rows,
    findMany: vi.fn(async ({ where, skip, take }: { where: Row; skip: number; take: number }) =>
      rows
        .filter((r) => matches(r, where))
        .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
        .slice(skip, skip + take)
        .map(view)
    ),
    count: vi.fn(async ({ where }: { where: Row }) => rows.filter((r) => matches(r, where)).length),
    findFirst: vi.fn(async ({ where }: { where: Row }) => {
      const row = rows.find((r) => matches(r, where));
      return row ? view(row) : null;
    }),
    create: vi.fn(async ({ data }: { data: Row }) => {
      seq += 1;
      const at = new Date(Date.UTC(2026, 10, 22, 0, 0, seq));
      const row: Row = {
        id: `project-${seq}`,
        archivedAt: null,
        // The column's default.
        overlay: {},
        createdAt: at,
        updatedAt: at,
        ...data,
      };
      rows.push(row);
      return view(row);
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const row of hit) Object.assign(row, data, { updatedAt: new Date() });
      return { count: hit.length };
    }),
  };
}

let projects: ReturnType<typeof createProjectTable>;
vi.mock('@/lib/db/client', () => ({
  get prisma() {
    return {
      project: projects,
      framework: {
        findUnique: vi.fn(async ({ where }: { where: { slug: string } }) =>
          where.slug === 'howdoesthisland' ? { id: 'framework-1' } : null
        ),
      },
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
vi.mock('@/lib/app/assessments/engine', () => ({ engineForVersion: mocks.engineForVersion }));
vi.mock('@/lib/app/frameworks/api/catalog', () => ({
  prismaFrameworkCatalog: {
    listFrameworks: vi.fn(),
    findFramework: vi.fn(async (slug: string) =>
      slug === 'howdoesthisland'
        ? {
            slug,
            name: 'HowDoesThisLand',
            summary: '',
            versions: [{ id: 'version-1', version: '0.5.1', status: 'PUBLISHED' }],
          }
        : slug === 'unpublished'
          ? { slug, name: 'Unpublished', summary: '', versions: [] }
          : null
    ),
  },
}));

import { POST as create, GET as list } from '@/app/api/v1/projects/route';
import { DELETE as remove, GET as read, PATCH as patch } from '@/app/api/v1/projects/[id]/route';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import { loadModel } from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';
import { createMockAuthSession } from '@/tests/helpers/auth';
import { projectSchema } from '@/lib/app/projects/wire';
import { z } from 'zod';

const WS_A = 'org-a';
const WS_B = 'org-b';
const ALICE = 'cmuser0000000000000alice1';
const BOB = 'cmuser00000000000000bob01';
const KEY_ID = 'cmkey000000000000000key1';

const engine = createHowDoesThisLandEngine(loadModel(), { culture: false });

/** 0.5.1 with adjustment bounds (t-72): the shape the next version will publish. */
function boundedModel() {
  const model = structuredClone(loadModel());
  const scoring = z.record(z.string(), z.unknown()).parse(model.scoring);
  return {
    ...model,
    scoring: {
      ...scoring,
      adjustment_bounds: {
        weights: { ethos: 0.1, pathos: 0.05 },
        priority_dimensions: { add: 1, remove: 1 },
      },
    },
  };
}
const boundedEngine = createHowDoesThisLandEngine(boundedModel(), { culture: false });

/** Score every project with the bounded version from here on. */
function useBoundedVersion() {
  mocks.engineForVersion.mockImplementation(async (id: string) =>
    id === 'version-1'
      ? {
          version: { id, status: 'PUBLISHED', frameworkSlug: 'howdoesthisland', version: '0.6.0' },
          engine: boundedEngine,
          label: 'howdoesthisland@0.6.0',
        }
      : null
  );
}

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

const BASE = 'http://localhost/api/v1/projects';
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function post(body: unknown, headers: Record<string, string> = {}) {
  return create(
    new NextRequest(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  );
}
const getList = (query = '', headers: Record<string, string> = {}) =>
  list(new NextRequest(`${BASE}${query}`, { headers }));
const getOne = (id: string) => read(new NextRequest(`${BASE}/${id}`), params(id));
const change = (id: string, body: unknown) =>
  patch(
    new NextRequest(`${BASE}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params(id)
  );
const archive = (id: string) =>
  remove(new NextRequest(`${BASE}/${id}`, { method: 'DELETE' }), params(id));

interface Envelope {
  success: boolean;
  data?: Record<string, unknown> & { id?: string };
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: { issues?: { path: string }[] } };
}
const json = async (res: Response) => (await res.json()) as Envelope;

/** Make a project as whoever is signed in, and answer its id. */
async function made(body: Record<string, unknown> = { name: 'Launch' }): Promise<string> {
  const res = await post(body);
  expect(res.status).toBe(201);
  const id = (await json(res)).data?.id;
  if (typeof id !== 'string') throw new Error('no id');
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
  projects = createProjectTable();
  mocks.membership.mockImplementation(
    async ({ where }: { where: { orgId_userId: { userId: string; orgId: string } } }) => {
      const { userId, orgId } = where.orgId_userId;
      const member = (userId === ALICE && orgId === WS_A) || (userId === BOB && orgId === WS_B);
      return member ? { role: 'MEMBER', org: { status: 'ACTIVE' } } : null;
    }
  );
  mocks.apiKey.mockResolvedValue(null);
  mocks.engineForVersion.mockImplementation(async (id: string) =>
    id === 'version-1'
      ? {
          version: { id, status: 'PUBLISHED', frameworkSlug: 'howdoesthisland', version: '0.5.1' },
          engine,
          label: 'howdoesthisland@0.5.1',
        }
      : null
  );
  signedIn(ALICE, WS_A);
});

describe('POST /api/v1/projects', () => {
  it('makes a project in the workspace with its brief and defaults, and answers 201', async () => {
    const res = await post({
      name: 'Spring launch',
      brief: { offer: 'Budgeting for freelancers', voice: 'Plain and warm' },
      defaults: {
        context: { contentType: 'landing_page', audience: { awareness: 'solution_aware' } },
        profile: 'quick',
      },
    });

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(projectSchema.parse(body.data)).toMatchObject({
      name: 'Spring launch',
      brief: { offer: 'Budgeting for freelancers', voice: 'Plain and warm' },
      framework: 'howdoesthisland',
      archived: false,
      reviewCount: 0,
    });
    // Stored as given, in Alice's workspace, by her.
    expect(projects.rows).toHaveLength(1);
    expect(projects.rows[0]).toMatchObject({
      orgId: WS_A,
      createdByUserId: ALICE,
      frameworkId: 'framework-1',
      defaults: {
        context: { contentType: 'landing_page', audience: { awareness: 'solution_aware' } },
        profile: 'quick',
      },
    });
  });

  it('refuses defaults naming an id or profile the version lacks, by path, and stores nothing', async () => {
    const res = await post({
      name: 'Launch',
      defaults: {
        context: { contentType: 'no_such_type', audience: { awareness: 'nope' } },
        profile: 'no_such_profile',
      },
    });

    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error?.code).toBe('DEFAULTS_INVALID');
    expect(body.error?.details?.issues?.map((i) => i.path).sort()).toEqual([
      'defaults.context.audience.awareness',
      'defaults.context.contentType',
      'defaults.profile',
    ]);
    expect(projects.rows).toHaveLength(0);
  });

  it('refuses a culture default while the culture switch is off', async () => {
    const res = await post({
      name: 'Launch',
      defaults: { context: { culture: { reader: 'global' } } },
    });

    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('DEFAULTS_INVALID');
  });

  it('refuses a framework with no published version, and one that does not exist', async () => {
    expect((await json(await post({ name: 'A', framework: 'unpublished' }))).error?.code).toBe(
      'FRAMEWORK_VERSION_NOT_FOUND'
    );
    expect((await json(await post({ name: 'A', framework: 'nothing' }))).error?.code).toBe(
      'FRAMEWORK_NOT_FOUND'
    );
    expect(projects.rows).toHaveLength(0);
  });

  it('refuses a body that does not fit: no name, or an unknown field', async () => {
    expect((await post({ name: '   ' })).status).toBe(400);
    expect((await post({ name: 'A', colour: 'blue' })).status).toBe(400);
    expect(projects.rows).toHaveLength(0);
  });
});

describe('the projects scope', () => {
  it('lets a key with `projects` list and make projects', async () => {
    withKey(['projects']);

    expect((await getList('', KEY_HEADERS)).status).toBe(200);
    expect((await post({ name: 'By key' }, KEY_HEADERS)).status).toBe(201);
    expect(projects.rows[0]).toMatchObject({ orgId: WS_A, createdByUserId: ALICE });
  });

  it('refuses a key with only `assess` with 403, and makes nothing', async () => {
    withKey(['assess']);

    expect((await getList('', KEY_HEADERS)).status).toBe(403);
    expect((await post({ name: 'By key' }, KEY_HEADERS)).status).toBe(403);
    expect(projects.rows).toHaveLength(0);
  });

  it('refuses a caller with no session or key with 401', async () => {
    mocks.getSession.mockResolvedValue(null);

    expect((await getList()).status).toBe(401);
  });
});

describe('GET /api/v1/projects', () => {
  it('lists the workspace’s projects, newest first, leaving archived ones out unless asked', async () => {
    const first = await made({ name: 'First' });
    await made({ name: 'Second' });
    await archive(first);

    const open = await json(await getList());
    expect(open.data).toBeInstanceOf(Array);
    expect((open.data as unknown as { name: string }[]).map((p) => p.name)).toEqual(['Second']);
    expect(open.meta).toMatchObject({ total: 1 });

    const all = await json(await getList('?archived=true'));
    expect((all.data as unknown as { name: string }[]).map((p) => p.name)).toEqual([
      'Second',
      'First',
    ]);
  });

  it('lists only the caller’s workspace', async () => {
    await made({ name: 'Alice’s' });
    signedIn(BOB, WS_B);

    const body = await json(await getList());
    expect(body.data).toEqual([]);
  });
});

describe('GET, PATCH and DELETE /api/v1/projects/{id}', () => {
  it('reads one project', async () => {
    const id = await made({ name: 'Launch', brief: { goals: 'Sign-ups' } });

    const res = await getOne(id);
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({
      id,
      name: 'Launch',
      brief: { goals: 'Sign-ups' },
    });
  });

  it('answers 404 for another workspace’s project, to read, change or archive', async () => {
    const id = await made();
    signedIn(BOB, WS_B);

    expect((await getOne(id)).status).toBe(404);
    expect((await change(id, { name: 'Taken' })).status).toBe(404);
    expect((await archive(id)).status).toBe(404);
    // Nothing of Alice's changed.
    expect(projects.rows[0]).toMatchObject({ name: 'Launch', archivedAt: null });
  });

  it('replaces the brief and defaults whole, and keeps what the change leaves out', async () => {
    const id = await made({
      name: 'Launch',
      brief: { offer: 'Old offer', voice: 'Warm' },
      defaults: { profile: 'quick' },
    });

    const res = await change(id, {
      brief: { offer: 'New offer' },
      defaults: { context: { contentType: 'landing_page' } },
    });

    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({
      name: 'Launch',
      brief: { offer: 'New offer' },
      defaults: { context: { contentType: 'landing_page' } },
    });
    expect(projects.rows[0]?.brief).toEqual({ offer: 'New offer' });
    expect(projects.rows[0]?.defaults).toEqual({ context: { contentType: 'landing_page' } });
  });

  it('checks changed defaults against the version, and changes nothing when they do not fit', async () => {
    const id = await made({ name: 'Launch', defaults: { profile: 'quick' } });

    const res = await change(id, { name: 'Renamed', defaults: { profile: 'no_such_profile' } });

    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('DEFAULTS_INVALID');
    expect(projects.rows[0]).toMatchObject({ name: 'Launch', defaults: { profile: 'quick' } });
  });

  it('refuses a change that changes nothing', async () => {
    const id = await made();

    expect((await change(id, {})).status).toBe(400);
  });

  it('archives on DELETE, keeps when it was archived, and restores with archived: false', async () => {
    const id = await made();

    const archived = await json(await archive(id));
    expect(archived.data).toMatchObject({ archived: true });
    const when = projects.rows[0]?.archivedAt;
    expect(when).toBeInstanceOf(Date);

    // Archiving again changes nothing, and writes nothing: an empty
    // `updateMany` can report `count: 0`, which would turn this into a 404.
    projects.updateMany.mockClear();
    const again = await archive(id);
    expect(again.status).toBe(200);
    expect((await json(again)).data).toMatchObject({ archived: true });
    expect(projects.updateMany).not.toHaveBeenCalled();
    expect(projects.rows[0]?.archivedAt).toBe(when);

    const restored = await json(await change(id, { archived: false }));
    expect(restored.data).toMatchObject({ archived: false, archivedAt: null });
  });
});

describe('a project’s weight adjustment (t-72)', () => {
  it('refuses any overlay while the latest version declares no bounds, by its path', async () => {
    const res = await post({ name: 'Launch', overlay: { weights: { ethos: 0.05 } } });

    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error?.code).toBe('OVERLAY_INVALID');
    expect(body.error?.details?.issues).toEqual([
      {
        path: 'overlay.weights',
        message: 'This version declares no bounds, so it allows no adjustment',
      },
    ]);
    expect(projects.rows).toHaveLength(0);
  });

  it('stores an overlay within the bounds, as the version checked it, and serves it', async () => {
    useBoundedVersion();
    const id = await made({
      name: 'Launch',
      overlay: { weights: { ethos: 0.1, pathos: 0 }, priorityDimensions: { add: ['kai_call'] } },
    });

    const stored = { weights: { ethos: 0.1 }, priorityDimensions: { add: ['kai_call'] } };
    expect(projects.rows[0]?.overlay).toEqual(stored);
    const read = await json(await getOne(id));
    expect(projectSchema.parse(read.data).overlay).toEqual(stored);
  });

  it('refuses an out-of-bounds change with each path, and changes nothing', async () => {
    useBoundedVersion();
    const id = await made({ name: 'Launch', overlay: { weights: { ethos: 0.05 } } });

    const res = await change(id, {
      name: 'Renamed',
      overlay: { weights: { kairos: 0.01 }, priorityDimensions: { add: ['nope'] } },
    });

    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error?.code).toBe('OVERLAY_INVALID');
    expect(body.error?.details?.issues?.map((i) => i.path)).toEqual([
      'overlay.weights.kairos',
      'overlay.priorityDimensions.add.0',
    ]);
    expect(projects.rows[0]).toMatchObject({
      name: 'Launch',
      overlay: { weights: { ethos: 0.05 } },
    });
  });

  it('replaces the overlay whole, and clears it with null', async () => {
    useBoundedVersion();
    const id = await made({ name: 'Launch', overlay: { weights: { ethos: 0.05 } } });

    const replaced = await json(await change(id, { overlay: { weights: { pathos: -0.05 } } }));
    expect(replaced.data?.overlay).toEqual({ weights: { pathos: -0.05 } });

    // Null needs no version: it clears even once the version allows nothing.
    mocks.engineForVersion.mockResolvedValue(null);
    const cleared = await json(await change(id, { overlay: null }));
    expect(cleared.data?.overlay).toBeNull();
    expect(projects.rows[0]?.overlay).toEqual({});
  });

  it('stores an overlay that changes nothing as none', async () => {
    useBoundedVersion();
    const id = await made({ name: 'Launch', overlay: { weights: { ethos: 0 } } });

    expect(projects.rows[0]?.overlay).toEqual({});
    expect((await json(await getOne(id))).data?.overlay).toBeNull();
  });
});

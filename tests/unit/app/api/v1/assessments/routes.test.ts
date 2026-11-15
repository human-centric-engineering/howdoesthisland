/**
 * Tests: the `assessments` routes (t-24).
 *
 * POST/GET /api/v1/assessments · GET/DELETE …/{id} · GET …/{id}/events ·
 * POST …/{id}/cancel
 *
 * Real: the guard (session, API key and its scope, org entry at `multi`),
 * the service, intake for files, enqueue, the job (claim, lease, fan-out,
 * saving each judge), the events stream and the per-user sub-cap. Replaced:
 * Prisma by the job's stateful fake (`fake-db.ts`, so assertions read the
 * rows left behind), `runJudge` (scripted per slot), the catalogue of
 * framework versions, `fetchPage`, and the engine's `assemble()` (a stub
 * reporting which judges it was given; the rest of the engine is the real
 * 0.5.1 one, so contexts and profiles are checked for real).
 *
 * @see app/api/v1/assessments/
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeDb, type FakeDb, type Row } from '@/tests/unit/lib/app/assessments/fake-db';

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test' as const,
  TENANCY_MODE: 'multi',
  CULTURE_MODULE_ENABLED: true,
  NEXT_PUBLIC_APP_URL: 'http://app.test',
  BETTER_AUTH_URL: 'http://app.test',
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  membership: vi.fn(),
  apiKey: vi.fn(),
  runJudge: vi.fn(),
  fetchPage: vi.fn(),
  engineForVersion: vi.fn(),
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
vi.mock('@/lib/app/judges/run-judge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/judges/run-judge')>()),
  runJudge: mocks.runJudge,
}));
vi.mock('@/lib/app/intake/fetch-page', () => ({ fetchPage: mocks.fetchPage }));
vi.mock('@/lib/app/assessments/engine', () => ({ engineForVersion: mocks.engineForVersion }));
// Short bounds, so a test can pass them; a small cap, so a test can reach it.
vi.mock('@/lib/app/assessments/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/assessments/limits')>()),
  WAIT_BOUND_MS: 80,
  POLL_MS: 5,
  AI_ASSESSMENTS_PER_MINUTE: 3,
}));
// The published 0.5.1 (`version-1`) and a retired 0.4.0 (`version-0`).
vi.mock('@/lib/app/frameworks/api/catalog', () => ({
  prismaFrameworkCatalog: {
    listFrameworks: vi.fn(),
    findFramework: vi.fn(async (slug: string) =>
      slug === 'howdoesthisland'
        ? {
            slug,
            name: 'HowDoesThisLand',
            summary: '',
            versions: [
              { id: 'version-1', version: '0.5.1', status: 'PUBLISHED' },
              { id: 'version-0', version: '0.4.0', status: 'RETIRED' },
            ],
          }
        : null
    ),
  },
}));

import { POST as create, GET as list } from '@/app/api/v1/assessments/route';
import { GET as read, DELETE as remove } from '@/app/api/v1/assessments/[id]/route';
import { GET as events } from '@/app/api/v1/assessments/[id]/events/route';
import { POST as cancel } from '@/app/api/v1/assessments/[id]/cancel/route';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import { loadModel } from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';
import { createMockAuthSession } from '@/tests/helpers/auth';
import { aiAssessmentLimiter } from '@/lib/app/assessments/api/limiter';
import { runAssessment } from '@/lib/app/assessments/run';
import { runAsOrg } from '@/lib/tenancy/context';
import { IntakeError, IntakeErrorCodes } from '@/lib/app/intake/errors';
import { JudgeRunError } from '@/lib/app/judges/run-judge';
import { assessmentDetailSchema, ephemeralAssessmentSchema } from '@/lib/app/api/registry';

const WS_A = 'org-a';
const WS_B = 'org-b';
const ALICE = 'cmuser0000000000000alice1';
const BOB = 'cmuser00000000000000bob01';
const KEY_ID = 'cmkey000000000000000key1';
const TEXT = 'We cut onboarding from two weeks to two days. Book a demo this week.';
const TWO = ['judge_ethos', 'judge_pathos'];

const real = createHowDoesThisLandEngine(loadModel(), { culture: true });
const engine = {
  ...real,
  assemble: vi.fn(
    (_text: string, _ctx: unknown, _quick: unknown, outputs: Record<string, unknown> = {}) => ({
      scores: { overall: 50 + Object.keys(outputs).length, band: 'mixed' },
      judged: Object.keys(outputs).sort(),
    })
  ),
};

function reply(slot: string) {
  return {
    slot,
    output: { from: slot },
    drops: [],
    provider: 'openai',
    model: 'gpt-4.1',
    usage: { input: 100, output: 20, attempts: 1 },
    costUsd: 0.01,
    costLogIds: [`cost-${slot}`],
    finishReason: 'stop',
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Long enough for a run started after a response to end. */
const settle = () => new Promise((r) => setTimeout(r, 30));

// --- Callers ---------------------------------------------------------------

/** A browser session acting in `orgId`, where the user is a member. */
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

// --- Requests --------------------------------------------------------------

const BASE = 'http://localhost/api/v1/assessments';

function post(body: unknown, headers: Record<string, string> = {}) {
  return create(
    new NextRequest(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  );
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const getList = (query = '', headers: Record<string, string> = {}) =>
  list(new NextRequest(`${BASE}${query}`, { headers }));
const getOne = (id: string, headers: Record<string, string> = {}) =>
  read(new NextRequest(`${BASE}/${id}`, { headers }), params(id));
const del = (id: string) =>
  remove(new NextRequest(`${BASE}/${id}`, { method: 'DELETE' }), params(id));
const stop = (id: string) =>
  cancel(new NextRequest(`${BASE}/${id}/cancel`, { method: 'POST' }), params(id));
const stream = (id: string, signal?: AbortSignal) =>
  events(new NextRequest(`${BASE}/${id}/events`, signal ? { signal } : {}), params(id));

interface Envelope {
  success: boolean;
  data?: Record<string, unknown> & { id?: string; status?: string };
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}
const json = async (res: Response) => (await res.json()) as Envelope;
async function code(res: Response) {
  const body = await json(res);
  return { status: res.status, code: body.error?.code };
}

/** The SSE frames of a stream, once it has closed. */
async function frames(res: Response): Promise<{ event: string; data: Record<string, unknown> }[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((frame) => frame.startsWith('event:'))
    .map((frame) => {
      const [eventLine = '', dataLine = ''] = frame.split('\n');
      return {
        event: eventLine.slice('event: '.length),
        data: JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>,
      };
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeDb();
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
  mocks.runJudge.mockImplementation(async (slot: string) => reply(slot));
  aiAssessmentLimiter.reset(`user:${ALICE}`);
  aiAssessmentLimiter.reset(`user:${BOB}`);
  signedIn(ALICE, WS_A);
});

afterEach(async () => {
  // Let any run a test started after its response finish before the next fake.
  await settle();
});

// ---------------------------------------------------------------------------

describe('POST /api/v1/assessments — stored', () => {
  it('queues the assessment and answers 202; the run then completes it', async () => {
    const res = await post({ source: { text: TEXT }, judges: TWO, title: 'Landing' });

    expect(res.status).toBe(202);
    const body = await json(res);
    expect(assessmentDetailSchema.parse(body.data)).toBeTruthy();
    expect(body.data).toMatchObject({
      stored: true,
      profile: 'custom',
      judges: TWO,
      framework: { slug: 'howdoesthisland', version: '0.5.1' },
      title: 'Landing',
      source: { kind: 'text', url: null, fileName: null },
    });
    expect(['queued', 'running']).toContain(body.data?.status);
    // Stored in workspace A, by Alice, through the app.
    expect(fake.assessments).toHaveLength(1);
    expect(fake.assessments[0]).toMatchObject({
      orgId: WS_A,
      createdByUserId: ALICE,
      requestedVia: 'APP',
      apiKeyId: null,
      context: { contentType: 'general', archetype: 'general' },
    });

    await settle();
    const after = await json(await getOne(String(body.data?.id)));
    expect(after.data).toMatchObject({
      status: 'completed',
      overall: 52,
      band: 'mixed',
      costUsd: 0.02,
      result: { judged: TWO },
    });
    expect(after.data?.judgeRuns).toEqual([
      expect.objectContaining({ judge: 'judge_ethos', status: 'succeeded', model: 'gpt-4.1' }),
      expect.objectContaining({ judge: 'judge_pathos', status: 'succeeded' }),
    ]);
  });

  it('with wait, answers 200 with the final result', async () => {
    const res = await post({ source: { text: TEXT }, judges: TWO, wait: true });

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data).toMatchObject({ status: 'completed', result: { judged: TWO } });
    expect(body.data?.judgeRuns).toHaveLength(2);
  });

  it('with wait, answers 202 once the bound passes, and the run carries on to the end', async () => {
    const pathos = deferred();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      if (slot === 'judge_pathos') await pathos.promise;
      return reply(slot);
    });

    const res = await post({ source: { text: TEXT }, judges: TWO, wait: true });

    expect(res.status).toBe(202);
    const body = await json(res);
    expect(body.data?.status).toBe('running');
    pathos.resolve();
    await settle();
    expect((await json(await getOne(String(body.data?.id)))).data?.status).toBe('completed');
  });

  it('with wait, a judge that fails makes the result partial, saying which', async () => {
    mocks.runJudge.mockImplementation(async (slot: string) => {
      if (slot === 'judge_pathos') throw new JudgeRunError('refused', 'The model refused.');
      return reply(slot);
    });
    const body = await json(await post({ source: { text: TEXT }, judges: TWO, wait: true }));
    expect(body.data).toMatchObject({ status: 'partial', result: { judged: ['judge_ethos'] } });
    expect(body.data?.judgeRuns).toContainEqual(
      expect.objectContaining({ judge: 'judge_pathos', status: 'failed', errorCode: 'refused' })
    );
  });

  it('records the API key it came through', async () => {
    withKey(['assess']);
    const res = await post({ source: { text: TEXT }, profile: 'quick', wait: true }, KEY_HEADERS);
    expect(res.status).toBe(200);
    expect(fake.assessments[0]).toMatchObject({ requestedVia: 'API', apiKeyId: KEY_ID });
  });

  it('reads a file, and fetches a page, as the source', async () => {
    const file = Buffer.from('# Launch\n\nWe cut onboarding to two days.').toString('base64');
    const fromFile = await json(
      await post({ source: { file: { name: 'launch.md', base64: file } }, profile: 'quick' })
    );
    expect(fromFile.data).toMatchObject({
      title: 'Launch',
      source: { kind: 'file', fileName: 'launch.md' },
    });

    mocks.fetchPage.mockResolvedValue({
      text: TEXT,
      title: 'Pricing',
      url: 'https://example.com/pricing',
      wordCount: 14,
      format: 'html',
      warnings: [],
    });
    const fromPage = await json(
      await post({ source: { url: 'https://example.com/p' }, profile: 'quick' })
    );
    expect(mocks.fetchPage).toHaveBeenCalledWith('https://example.com/p');
    expect(fromPage.data).toMatchObject({
      title: 'Pricing',
      source: { kind: 'url', url: 'https://example.com/pricing' },
    });
  });
});

describe('POST /api/v1/assessments — store: false', () => {
  it('answers the result at once and keeps no Content, Assessment or JudgeRun row', async () => {
    mocks.runJudge.mockImplementation(async (slot: string) => {
      if (slot === 'judge_pathos') throw new JudgeRunError('refused', 'The model refused.');
      return reply(slot);
    });

    const res = await post({ source: { text: TEXT }, judges: TWO, store: false });

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(ephemeralAssessmentSchema.parse(body.data)).toBeTruthy();
    expect(body.data).toMatchObject({
      stored: false,
      status: 'partial',
      costUsd: 0.01,
      result: { judged: ['judge_ethos'] },
      judgeRuns: [
        expect.objectContaining({ judge: 'judge_ethos', status: 'succeeded', model: 'gpt-4.1' }),
        expect.objectContaining({ judge: 'judge_pathos', status: 'failed', errorCode: 'refused' }),
      ],
    });
    expect(body.data).not.toHaveProperty('id');
    // Nothing was written: not the text, not the assessment, not a judge run.
    expect(fake.db.content.create).not.toHaveBeenCalled();
    expect(fake.db.assessment.create).not.toHaveBeenCalled();
    expect(fake.db.judgeRun.upsert).not.toHaveBeenCalled();
    expect(fake.db.$transaction).not.toHaveBeenCalled();
    expect([fake.contents, fake.assessments, fake.judgeRuns]).toEqual([[], [], []]);
    // The judges ran as ephemeral, so their cost rows say so and name no assessment.
    for (const [, input] of mocks.runJudge.mock.calls) {
      expect(input).toMatchObject({ ephemeral: true, userId: ALICE });
      expect(input).not.toHaveProperty('assessmentId');
    }
  });

  it('scores a fetched page with its URL, as the stored run does', async () => {
    mocks.fetchPage.mockResolvedValue({
      text: TEXT,
      title: 'Pricing',
      url: 'https://example.com/pricing',
      wordCount: 14,
      format: 'html',
      warnings: [],
    });
    const res = await post({
      source: { url: 'https://example.com/p' },
      judges: TWO,
      store: false,
    });
    expect(res.status).toBe(200);
    expect(engine.assemble).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.anything(),
      expect.any(Object),
      'https://example.com/pricing'
    );
  });

  it('422 NOT_SCORABLE when assemble throws, saying what the judges had spent', async () => {
    engine.assemble.mockImplementationOnce(() => {
      throw new Error('no score');
    });
    const res = await post({ source: { text: TEXT }, judges: TWO, store: false });
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.error).toMatchObject({ code: 'NOT_SCORABLE', details: { costUsd: 0.02 } });
    expect(log.error).toHaveBeenCalledWith(
      'Assessment could not be scored, with no row to record it',
      expect.any(Error),
      { costUsd: 0.02 }
    );
  });

  it('422 NOT_SCORABLE when the quick scan throws, before any judge is called', async () => {
    const quickScan = vi.spyOn(engine, 'quickScan').mockImplementationOnce(() => {
      throw new Error('no scan');
    });
    const res = await post({ source: { text: TEXT }, judges: TWO, store: false });
    expect(await code(res)).toEqual({ status: 422, code: 'NOT_SCORABLE' });
    expect(mocks.runJudge).not.toHaveBeenCalled();
    quickScan.mockRestore();
  });

  it('starts no judge once the caller has gone away', async () => {
    const gone = new AbortController();
    gone.abort();
    const res = await create(
      new NextRequest(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: { text: TEXT }, judges: TWO, store: false }),
        signal: gone.signal,
      })
    );
    expect(await code(res)).toEqual({ status: 499, code: 'REQUEST_CLOSED' });
    expect(mocks.runJudge).not.toHaveBeenCalled();
  });

  it('is refused with wait: false, since it can only be waited for', async () => {
    const res = await post({ source: { text: TEXT }, store: false, wait: false });
    expect(await code(res)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
  });
});

describe('POST /api/v1/assessments — refusals', () => {
  it('401 UNAUTHORIZED with no session or key', async () => {
    mocks.getSession.mockResolvedValue(null);
    expect(await code(await post({ source: { text: TEXT } }))).toEqual({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('refuses a page to fetch without an account (D14), as every other input', async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await post({ source: { url: 'https://example.com' } });
    expect(res.status).toBe(401);
    expect(mocks.fetchPage).not.toHaveBeenCalled();
  });

  it('403 FORBIDDEN for an API key without the assess scope', async () => {
    withKey(['chat']);
    expect(await code(await post({ source: { text: TEXT } }, KEY_HEADERS))).toEqual({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(fake.assessments).toEqual([]);
  });

  it.each([
    ['both a profile and judges', { profile: 'full', judges: TWO }],
    ['no source', { source: undefined }],
    ['two sources', { source: { text: TEXT, url: 'https://example.com' } }],
    ['a URL that is not http(s)', { source: { url: 'file:///etc/passwd' } }],
    ['a file that is not base64', { source: { file: { name: 'a.txt', base64: '***' } } }],
    ['an unknown key', { source: { text: TEXT }, mode: 'full' }],
  ])('400 VALIDATION_ERROR for %s', async (_case, body) => {
    expect(await code(await post({ source: { text: TEXT }, ...body }))).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it.each([
    ['CONTENT_EMPTY', 400, { source: { text: '   ' } }],
    ['CONTEXT_INVALID', 400, { source: { text: TEXT }, context: { contentType: 'haiku' } }],
    ['PROFILE_UNKNOWN', 400, { source: { text: TEXT }, profile: 'everything' }],
    ['PROFILE_UNKNOWN', 400, { source: { text: TEXT }, profile: undefined, judges: ['judge_x'] }],
    ['FRAMEWORK_NOT_FOUND', 404, { source: { text: TEXT }, framework: 'nope' }],
    // A retired version stays readable but runs nothing new.
    ['FRAMEWORK_VERSION_NOT_FOUND', 404, { source: { text: TEXT }, version: '0.4.0' }],
    ['TEXT_TOO_LONG', 422, { source: { text: '🙂'.repeat(40_001) } }],
    [
      'INVALID_FILE_TYPE',
      415,
      { source: { file: { name: 'a.exe', base64: Buffer.from('MZ').toString('base64') } } },
    ],
  ])('%s (%i)', async (expected, status, body) => {
    expect(await code(await post({ profile: 'quick', ...body }))).toEqual({
      status,
      code: expected,
    });
    expect(fake.assessments).toEqual([]);
  });

  it('422 with the intake code for a page that cannot be fetched', async () => {
    mocks.fetchPage.mockRejectedValue(
      new IntakeError(IntakeErrorCodes.URL_NOT_ALLOWED, 'That address is not public.')
    );
    expect(await code(await post({ source: { url: 'https://10.example' } }))).toEqual({
      status: 422,
      code: 'URL_NOT_ALLOWED',
    });
  });

  it('does not count a request refused for its profile against the cap', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await post({ source: { text: TEXT }, judges: ['judge_nobody'] });
      expect(await code(res)).toEqual({ status: 400, code: 'PROFILE_UNKNOWN' });
    }
    expect((await post({ source: { text: TEXT }, judges: TWO })).status).toBe(202);
  });

  it('429 past the per-user cap on assessments that call judges; quick ones are not counted', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await post({ source: { text: TEXT }, judges: TWO })).status).toBe(202);
    }
    const over = await post({ source: { text: TEXT }, judges: TWO, store: false });
    expect(over.status).toBe(429);
    expect((await json(over)).error?.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(over.headers.get('Retry-After')).toBeTruthy();
    // A quick profile calls no model.
    expect((await post({ source: { text: TEXT }, profile: 'quick' })).status).toBe(202);
    // The cap is per user: Bob has his own.
    signedIn(BOB, WS_B);
    expect((await post({ source: { text: TEXT }, judges: TWO })).status).toBe(202);
  });
});

describe('GET /api/v1/assessments', () => {
  it("lists the workspace's assessments only, newest first, a page at a time", async () => {
    const old = fake.seed({ createdAt: new Date('2026-11-01') });
    const mid = fake.seed({ createdAt: new Date('2026-11-02'), status: 'COMPLETED' });
    const recent = fake.seed({ createdAt: new Date('2026-11-03') });
    fake.seed({ orgId: WS_B, createdAt: new Date('2026-11-04') });

    const first = await json(await getList('?limit=2'));
    expect((first.data as unknown as Row[]).map((a) => a.id)).toEqual([recent.id, mid.id]);
    expect(first.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    const second = await json(await getList('?limit=2&page=2'));
    expect((second.data as unknown as Row[]).map((a) => a.id)).toEqual([old.id]);

    const completed = await json(await getList('?status=completed'));
    expect((completed.data as unknown as Row[]).map((a) => a.id)).toEqual([mid.id]);
  });

  it('400 VALIDATION_ERROR for a bad query, 403 for a key without the scope', async () => {
    expect(await code(await getList('?status=done'))).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(await code(await getList('?limit=500'))).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    withKey(['chat']);
    expect((await getList('', KEY_HEADERS)).status).toBe(403);
  });
});

describe('another workspace’s assessment', () => {
  it('reads as 404 to a member of another workspace, on read, events, cancel and delete', async () => {
    const a = fake.seed({ orgId: WS_A });
    signedIn(BOB, WS_B);
    const id = String(a.id);

    for (const res of [await getOne(id), await stream(id), await stop(id), await del(id)]) {
      expect(await code(res)).toEqual({ status: 404, code: 'NOT_FOUND' });
    }
    // And nothing happened to it.
    expect(fake.assessments[0]).toMatchObject({ id: a.id, status: 'QUEUED' });
  });
});

describe('GET /api/v1/assessments/{id}', () => {
  it('answers the assessment with its judges in the version’s order', async () => {
    const a = fake.seed({ status: 'PARTIAL', judges: TWO, overall: 51, band: 'mixed' }, [
      { judge: 'judge_pathos', status: 'FAILED', errorCode: 'refused' },
      { judge: 'judge_ethos', status: 'SUCCEEDED', modelName: 'gpt-4.1', costUsd: 0.01 },
    ]);
    const body = await json(await getOne(String(a.id)));
    expect(body.data).toMatchObject({ id: a.id, status: 'partial', overall: 51 });
    expect((body.data?.judgeRuns as Row[]).map((r) => [r.judge, r.status])).toEqual([
      ['judge_ethos', 'succeeded'],
      ['judge_pathos', 'failed'],
    ]);
  });

  it('404 for an id that names nothing', async () => {
    expect(await code(await getOne('no-such-id'))).toEqual({ status: 404, code: 'NOT_FOUND' });
  });
});

describe('GET /api/v1/assessments/{id}/events', () => {
  it('emits an event per judge for a run driven outside the request, and closes when final', async () => {
    const a = fake.seed({ judges: TWO });
    const id = String(a.id);
    const gates = { judge_ethos: deferred(), judge_pathos: deferred() };
    mocks.runJudge.mockImplementation(async (slot: 'judge_ethos' | 'judge_pathos') => {
      await gates[slot].promise;
      return reply(slot);
    });

    // The run belongs to no request: as the recovery job, or another instance, drives it.
    const run = runAsOrg(WS_A, () => runAssessment(id));
    const res = await stream(id);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const received = frames(res);

    gates.judge_ethos.resolve();
    await settle();
    gates.judge_pathos.resolve();
    expect(await run).toBe('completed');

    const all = await received;
    expect(all.map((f) => f.event)).toEqual([
      'assessment_status',
      'assessment_judge',
      'assessment_judge',
      'assessment_status',
      'assessment_done',
    ]);
    expect(all[0]?.data).toEqual({ type: 'assessment_status', id, status: 'running' });
    expect(all.filter((f) => f.event === 'assessment_judge').map((f) => f.data.judge)).toEqual(TWO);
    expect(all[4]?.data).toMatchObject({
      type: 'assessment_done',
      status: 'completed',
      overall: 52,
      costUsd: 0.02,
    });
  });

  it('replays the judges that landed before it opened, then closes at once if final', async () => {
    const a = fake.seed({ status: 'COMPLETED', overall: 52, band: 'mixed' }, [
      { judge: 'judge_ethos', status: 'SUCCEEDED' },
      { judge: 'judge_pathos', status: 'SUCCEEDED' },
    ]);
    const all = await frames(await stream(String(a.id)));
    expect(all.map((f) => f.event)).toEqual([
      'assessment_status',
      'assessment_judge',
      'assessment_judge',
      'assessment_done',
    ]);
  });

  it('logs a read that fails mid-stream, and ends it with the error frame', async () => {
    const a = fake.seed({ status: 'RUNNING' });
    const received = stream(String(a.id)).then((res) => res.text());
    await settle();
    fake.db.assessment.findUnique.mockRejectedValueOnce(new Error('db down'));
    const text = await received;
    expect(text).toContain('stream_error');
    expect(log.error).toHaveBeenCalledWith('Assessment events stream failed', expect.any(Error), {
      assessmentId: a.id,
    });
  });

  it('waits for a cancelled run’s judges in flight, so done carries their cost', async () => {
    const a = fake.seed({
      status: 'CANCELLED',
      judges: TWO,
      leaseToken: 'token-1',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    const received = frames(await stream(String(a.id)));
    await settle();
    // The judge in flight lands, and the run gives up its lease.
    fake.judgeRuns.push({
      id: 'run-late',
      assessmentId: a.id,
      judge: 'judge_ethos',
      status: 'SUCCEEDED',
      costUsd: 0.01,
      modelName: 'gpt-4.1',
      latencyMs: 5,
      errorCode: null,
      updatedAt: new Date(),
    });
    Object.assign(a, { costUsd: 0.01, leaseExpiresAt: null });
    const all = await received;
    expect(all.map((f) => f.event)).toEqual([
      'assessment_status',
      'assessment_judge',
      'assessment_done',
    ]);
    expect(all[2]?.data).toMatchObject({ status: 'cancelled', costUsd: 0.01 });
  });

  it('ends with assessment_gone when the assessment is deleted while it is followed', async () => {
    const a = fake.seed({ status: 'RUNNING' });
    const received = frames(await stream(String(a.id)));
    await settle();
    expect((await del(String(a.id))).status).toBe(200);
    const all = await received;
    expect(all.at(-1)?.event).toBe('assessment_gone');
  });
});

describe('POST /api/v1/assessments/{id}/cancel', () => {
  it('cancels a queued assessment, so no judge is ever called', async () => {
    const a = fake.seed({ status: 'QUEUED' });
    const res = await stop(String(a.id));
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ id: a.id, status: 'cancelled' });
    expect(await runAsOrg(WS_A, () => runAssessment(String(a.id)))).toBe('not_claimed');
    expect(mocks.runJudge).not.toHaveBeenCalled();
  });

  it('409 ASSESSMENT_FINAL for one already finished, naming its final state', async () => {
    const a = fake.seed({ status: 'COMPLETED' });
    const res = await stop(String(a.id));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatchObject({
      code: 'ASSESSMENT_FINAL',
      message: 'This assessment is already completed.',
    });
  });

  it('404 for an id that names nothing', async () => {
    expect(await code(await stop('no-such-id'))).toEqual({ status: 404, code: 'NOT_FOUND' });
  });
});

describe('DELETE /api/v1/assessments/{id}', () => {
  it('deletes the assessment, its judge runs and its text, then reads as 404', async () => {
    const keep = fake.seed();
    const a = fake.seed({ status: 'COMPLETED' }, [{ judge: 'judge_ethos', status: 'SUCCEEDED' }]);

    const res = await del(String(a.id));
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ deleted: true });
    expect(fake.assessments.map((r) => r.id)).toEqual([keep.id]);
    expect(fake.judgeRuns).toEqual([]);
    expect(fake.contents.map((c) => c.id)).toEqual([keep.contentId]);

    expect(await code(await del(String(a.id)))).toEqual({ status: 404, code: 'NOT_FOUND' });
    expect(await code(await getOne(String(a.id)))).toEqual({ status: 404, code: 'NOT_FOUND' });
  });

  it('keeps the text while another assessment still uses it', async () => {
    const a = fake.seed();
    fake.assessments.push({ ...a, id: 'assessment-twin' });
    expect((await del(String(a.id))).status).toBe(200);
    expect(fake.contents.map((c) => c.id)).toEqual([a.contentId]);
  });

  it('403 for an API key without the scope', async () => {
    const a = fake.seed();
    withKey(['chat']);
    const res = await remove(
      new NextRequest(`${BASE}/${String(a.id)}`, { method: 'DELETE', headers: KEY_HEADERS }),
      params(String(a.id))
    );
    expect(res.status).toBe(403);
    expect(fake.assessments).toHaveLength(1);
  });
});

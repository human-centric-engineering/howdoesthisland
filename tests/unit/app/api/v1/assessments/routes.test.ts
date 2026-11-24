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
 * rows left behind), `runJudge` (scripted per slot), `runEditor` (skipping;
 * its own tests are `editor.test.ts`), the catalogue of
 * framework versions, `fetchPage`, and the engine's `assemble()` (a stub
 * reporting which judges it was given; the rest of the engine is the real
 * 0.5.1 one, so contexts and profiles are checked for real).
 *
 * @see app/api/v1/assessments/
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';
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
  runEditor: vi.fn(),
  fetchPage: vi.fn(),
  engineForVersion: vi.fn(),
  loadOrgQuotas: vi.fn(),
  monthSpend: vi.fn(),
  // The cost rows the `kept-nowhere` tier reads (t-51): none unless a test seeds some.
  costRows: vi.fn(),
  // The workspaces' projects (t-70): none unless a test adds some.
  projects: [] as Record<string, unknown>[],
  // Core's knowledge search (t-75), standing in for the embeddings.
  search: vi.fn(),
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
      // The month's spend, which the budget check (t-49) reads with the cap; a
      // review's own rows, which its charge sums (t-58), from the fake's.
      aiCostLog: {
        aggregate: vi.fn((args: { where?: { metadata?: unknown } }) =>
          args.where?.metadata ? fake.db.aiCostLog.aggregate(args) : mocks.monthSpend(args)
        ),
        findMany: mocks.costRows,
      },
      // No workspace has a judge run on record, so the per-judge tier is empty.
      judgeRun: { ...fake.db.judgeRun, findMany: vi.fn(async () => []) },
      project: {
        findFirst: vi.fn(
          async ({ where }: { where: { id: string; orgId: string; archivedAt?: null } }) =>
            mocks.projects.find(
              (p) =>
                p.id === where.id &&
                p.orgId === where.orgId &&
                (where.archivedAt === undefined || p.archivedAt === null)
            ) ?? null
        ),
      },
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
vi.mock('@/lib/app/assessments/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/assessments/editor')>()),
  runEditor: mocks.runEditor,
}));
vi.mock('@/lib/tenancy/org-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/org-settings')>()),
  loadOrgQuotas: mocks.loadOrgQuotas,
}));
vi.mock('@/lib/app/intake/fetch-page', () => ({ fetchPage: mocks.fetchPage }));
vi.mock('@/lib/orchestration/knowledge/search', () => ({
  searchKnowledgeWithEmbedding: mocks.search,
}));
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
import { resetKicksForTests } from '@/lib/app/assessments/kick';
import { forgetEarlyScansForTests } from '@/lib/app/assessments/early-scan';
import { runAssessment } from '@/lib/app/assessments/run';
import { runAsOrg } from '@/lib/tenancy/context';
import { currentPrivacyScope } from '@/lib/orchestration/privacy/scope';
import { PrivacyRefusedError } from '@/lib/orchestration/llm/privacy-stage';
import { IntakeError, IntakeErrorCodes } from '@/lib/app/intake/errors';
import { JudgeRunError } from '@/lib/app/judges/run-judge';
import { assessmentDetailSchema, ephemeralAssessmentSchema } from '@/lib/app/api/registry';
import { forgetSpendCaps } from '@/lib/orchestration/llm/spend-caps';

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
  mocks.runEditor.mockResolvedValue({ status: 'skipped', reason: 'too_few_judges' });
  // No monthly budget unless a test sets one.
  mocks.loadOrgQuotas.mockResolvedValue({});
  mocks.monthSpend.mockResolvedValue({ _sum: { totalCostUsd: 0 } });
  mocks.costRows.mockResolvedValue([]);
  mocks.projects.length = 0;
  forgetSpendCaps();
  aiAssessmentLimiter.reset(`user:${ALICE}`);
  aiAssessmentLimiter.reset(`user:${BOB}`);
  resetKicksForTests();
  forgetEarlyScansForTests();
  signedIn(ALICE, WS_A);
  // Credits to spare unless a test sets them (t-58), so the cap is what t-49's tests measure.
  fake.grant(WS_A, 1_000_000);
  fake.grant(WS_B, 1_000_000);
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

describe('a review’s quick scan, before its judges (t-77)', () => {
  /** Holds every judge until released, so the review stays running. */
  function holdJudges() {
    const gate = deferred();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      await gate.promise;
      return reply(slot);
    });
    return gate;
  }

  it('answers it in the 202 and on GET while the review runs, then null once final', async () => {
    const gate = holdJudges();
    const res = await post({ source: { text: TEXT }, judges: TWO });

    expect(res.status).toBe(202);
    const created = assessmentDetailSchema.parse((await json(res)).data);
    expect(created.quickScan).toEqual({
      overall: 50,
      band: 'mixed',
      result: { scores: { overall: 50, band: 'mixed' }, judged: [] },
    });
    // The quick scan the engine works out from the stored text and context, with no judges.
    const parsed = real.parseContext(fake.assessments[0]?.context);
    if (!parsed.ok) throw new Error('the stored context should parse');
    expect(engine.assemble).toHaveBeenCalledWith(
      TEXT,
      parsed.ctx,
      real.quickScan(TEXT, parsed.ctx),
      {},
      null
    );

    await settle();
    const running = assessmentDetailSchema.parse((await json(await getOne(created.id))).data);
    expect(running.status).toBe('running');
    expect(running.quickScan).toMatchObject({ overall: 50, band: 'mixed' });

    gate.resolve();
    await settle();
    const done = assessmentDetailSchema.parse((await json(await getOne(created.id))).data);
    expect(done.status).toBe('completed');
    expect(done.overall).toBe(52);
    expect(done.quickScan).toBeNull();
  });

  it('answers it for a page and a file too, scored with the page’s address', async () => {
    holdJudges();
    mocks.fetchPage.mockResolvedValue({
      text: TEXT,
      title: 'Pricing',
      url: 'https://example.com/pricing',
      wordCount: 14,
      format: 'html',
      warnings: [],
    });
    const fromPage = assessmentDetailSchema.parse(
      (await json(await post({ source: { url: 'https://example.com/p' }, judges: TWO }))).data
    );
    expect(fromPage.quickScan).toMatchObject({ overall: 50 });
    expect(engine.assemble).toHaveBeenLastCalledWith(
      TEXT,
      expect.anything(),
      expect.anything(),
      {},
      'https://example.com/pricing'
    );

    const file = Buffer.from('# Launch\n\nWe cut onboarding to two days.').toString('base64');
    const fromFile = assessmentDetailSchema.parse(
      (
        await json(
          await post({ source: { file: { name: 'launch.md', base64: file } }, judges: TWO })
        )
      ).data
    );
    expect(fromFile.quickScan).toMatchObject({ overall: 50 });
  });

  it('answers null for a quick review, whose result is the quick scan', async () => {
    const res = await post({ source: { text: TEXT }, profile: 'quick' });
    const data = assessmentDetailSchema.parse((await json(res)).data);
    expect(data.quickScan).toBeNull();
  });

  it('answers null for text the engine cannot score; the run then fails it', async () => {
    holdJudges();
    engine.assemble.mockImplementationOnce(() => {
      throw new Error('cannot score this');
    });
    const data = assessmentDetailSchema.parse(
      (await json(await post({ source: { text: TEXT }, judges: TWO }))).data
    );
    expect(data.quickScan).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      'Could not work out a running review’s quick scan',
      expect.objectContaining({ assessmentId: data.id, error: 'cannot score this' })
    );
  });

  it('leaves a review kept nowhere as it was: its result is already final', async () => {
    const res = await post({ source: { text: TEXT }, judges: TWO, store: false });
    expect(res.status).toBe(200);
    expect((await json(res)).data).not.toHaveProperty('quickScan');
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
    // Two transactions: the budget hold (t-50; taken whenever there are
    // credits to check, t-58) and the running place (t-28), both gone again.
    expect(fake.db.$transaction).toHaveBeenCalledTimes(2);
    expect(fake.holds).toEqual([]);
    expect([fake.contents, fake.assessments, fake.judgeRuns, fake.places]).toEqual([
      [],
      [],
      [],
      [],
    ]);
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

  it('runs its judges in a privacy scope naming the workspace and the user, as a stored run does', async () => {
    const scopes: unknown[] = [];
    mocks.runJudge.mockImplementation(async (slot: string) => {
      scopes.push(currentPrivacyScope());
      return reply(slot);
    });
    expect((await post({ source: { text: TEXT }, judges: TWO, store: false })).status).toBe(200);
    expect(scopes).toHaveLength(2);
    for (const scope of scopes) {
      expect(scope).toMatchObject({
        scopeId: expect.stringMatching(/^assessment:ephemeral:/),
        orgId: WS_A,
        userId: ALICE,
      });
    }
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

  it('does not count pasted text refused as empty or too long against the cap', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect(await code(await post({ source: { text: '   ' }, judges: TWO }))).toEqual({
        status: 400,
        code: 'CONTENT_EMPTY',
      });
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

describe('POST /api/v1/assessments — in a project (t-70)', () => {
  /** A project in `orgId`, as the service reads it. */
  function project(over: Record<string, unknown> = {}) {
    const row = {
      id: 'project-1',
      orgId: WS_A,
      archivedAt: null,
      framework: { slug: 'howdoesthisland' },
      overlay: null,
      defaults: {
        context: {
          contentType: 'landing_page',
          audience: { awareness: 'solution_aware', relationship: 'cold' },
        },
        profile: 'quick',
      },
      ...over,
    };
    mocks.projects.push(row);
    // The enqueue transaction runs on the fake, and checks the project again.
    fake.projects.push(row);
    return row;
  }

  it('takes the project’s defaults under the request’s own fields, and records the project', async () => {
    project();

    const res = await post({
      source: { text: TEXT },
      projectId: 'project-1',
      context: { audience: { relationship: 'warm' } },
      wait: true,
    });

    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ projectId: 'project-1', profile: 'quick' });
    expect(fake.assessments).toHaveLength(1);
    expect(fake.assessments[0]).toMatchObject({
      projectId: 'project-1',
      profile: 'quick',
      judges: [],
      // The project's type of copy and awareness; the request's relationship.
      context: {
        contentType: 'landing_page',
        audience: expect.objectContaining({ awareness: 'solution_aware', relationship: 'warm' }),
      },
    });
    expect(fake.contents[0]).toMatchObject({ projectId: 'project-1' });
  });

  it('lets the request’s profile or judges win over the project’s', async () => {
    project();

    const res = await post({ source: { text: TEXT }, projectId: 'project-1', judges: TWO });

    expect(res.status).toBe(202);
    expect(fake.assessments[0]).toMatchObject({ profile: 'custom', judges: TWO });
  });

  it('records no project for a review outside one', async () => {
    await post({ source: { text: TEXT }, profile: 'quick', wait: true });

    expect(fake.assessments[0]).toMatchObject({ projectId: null });
  });

  describe('with a weight adjustment (t-72)', () => {
    /** 0.5.1 with bounds, scored for real: the run assembles with the overlay. */
    function useBoundedVersion() {
      const model = structuredClone(loadModel());
      const scoring = z.record(z.string(), z.unknown()).parse(model.scoring);
      const bounded = createHowDoesThisLandEngine(
        {
          ...model,
          scoring: { ...scoring, adjustment_bounds: { weights: { ethos: 0.1 } } },
        },
        { culture: true }
      );
      mocks.engineForVersion.mockImplementation(async (id: string) =>
        id === 'version-1'
          ? {
              version: {
                id,
                status: 'PUBLISHED',
                frameworkSlug: 'howdoesthisland',
                version: '0.5.1',
              },
              engine: bounded,
              label: 'howdoesthisland@0.5.1',
            }
          : null
      );
      return bounded;
    }

    it('records the project’s overlay on the assessment, and scores with it', async () => {
      const bounded = useBoundedVersion();
      project({ overlay: { weights: { ethos: 0.1 } } });

      const res = await post({ source: { text: TEXT }, projectId: 'project-1', wait: true });

      expect(res.status).toBe(200);
      const data = assessmentDetailSchema.parse((await json(res)).data);
      expect(data.overlay).toEqual({ weights: { ethos: 0.1 } });
      expect(fake.assessments[0]).toMatchObject({ overlay: { weights: { ethos: 0.1 } } });
      // The stored result is the adjusted engine's, not the plain one's.
      const parsed = bounded.parseContext(fake.assessments[0]?.context);
      if (!parsed.ok) throw new Error('the stored context should parse');
      const ctx = parsed.ctx;
      const plain = bounded.assemble(TEXT, ctx, bounded.quickScan(TEXT, ctx));
      const adjusted = bounded.withOverlay({ weights: { ethos: 0.1 } });
      const expected = adjusted.assemble(TEXT, ctx, adjusted.quickScan(TEXT, ctx));
      expect(fake.assessments[0]?.result).toMatchObject({
        effective_weights: expected.effective_weights,
      });
      expect(expected.effective_weights.ethos).toBeGreaterThan(plain.effective_weights.ethos);
    });

    it('works the running review’s quick scan out with the overlay, as the run will (t-77)', async () => {
      const bounded = useBoundedVersion();
      project({ overlay: { weights: { ethos: 0.1 } } });
      const gate = deferred();
      mocks.runJudge.mockImplementation(async (slot: string) => {
        await gate.promise;
        return reply(slot);
      });

      const res = await post({ source: { text: TEXT }, projectId: 'project-1', judges: TWO });

      expect(res.status).toBe(202);
      const data = assessmentDetailSchema.parse((await json(res)).data);
      const parsed = bounded.parseContext(fake.assessments[0]?.context);
      if (!parsed.ok) throw new Error('the stored context should parse');
      const adjusted = bounded.withOverlay({ weights: { ethos: 0.1 } });
      const expected = adjusted.assemble(TEXT, parsed.ctx, adjusted.quickScan(TEXT, parsed.ctx));
      const plain = bounded.assemble(TEXT, parsed.ctx, bounded.quickScan(TEXT, parsed.ctx));
      expect(data.quickScan?.result).toMatchObject({
        effective_weights: expected.effective_weights,
      });
      expect(expected.effective_weights.ethos).not.toBe(plain.effective_weights.ethos);
      gate.resolve();
    });

    it('records none for a project without one', async () => {
      useBoundedVersion();
      project();

      const res = await post({ source: { text: TEXT }, projectId: 'project-1', wait: true });

      expect(assessmentDetailSchema.parse((await json(res)).data).overlay).toBeNull();
      expect(fake.assessments[0]?.overlay ?? null).toBeNull();
    });

    it('refuses a review whose version does not allow the project’s overlay, and stores nothing', async () => {
      // 0.5.1 as published: no bounds.
      project({ overlay: { weights: { ethos: 0.1 } } });

      const res = await post({ source: { text: TEXT }, projectId: 'project-1' });

      expect(res.status).toBe(400);
      const body = await json(res);
      expect(body.error).toMatchObject({
        code: 'OVERLAY_INVALID',
        details: {
          fromProjectOverlay: true,
          issues: [
            {
              path: 'overlay.weights',
              message: 'This version declares no bounds, so it allows no adjustment',
            },
          ],
        },
      });
      expect(fake.assessments).toHaveLength(0);
    });

    it('scores a review kept nowhere with the overlay too, and says so', async () => {
      useBoundedVersion();
      project({ overlay: { weights: { ethos: 0.1 } } });

      const res = await post({ source: { text: TEXT }, projectId: 'project-1', store: false });

      expect(res.status).toBe(200);
      const data = ephemeralAssessmentSchema.parse((await json(res)).data);
      expect(data.overlay).toEqual({ weights: { ethos: 0.1 } });
      expect(fake.assessments).toHaveLength(0);
    });
  });

  describe('with background documents (t-75)', () => {
    beforeEach(() => {
      fake.projectDocuments.push({
        id: 'link-guide',
        orgId: WS_A,
        projectId: 'project-1',
        knowledgeDocumentId: 'k-guide',
        title: 'Brand guide',
        createdAt: new Date(1),
      });
      fake.knowledgeDocuments.push({ id: 'k-guide', orgId: WS_A, status: 'ready' });
      mocks.search.mockResolvedValue({
        results: [
          {
            chunk: { id: 'c-guide', documentId: 'k-guide', content: 'Our voice is plain.' },
            similarity: 0.7,
          },
        ],
        embedding: { model: 'embed', provider: 'p', inputTokens: 5, costUsd: 0 },
      });
    });

    const sentToJudges = () =>
      mocks.runJudge.mock.calls.map(
        (c) => (c[1] as { projectContext?: string | null }).projectContext
      );

    it('answers the context used on the stored assessment, documents by id and title', async () => {
      project({ brief: { offer: 'Bicycles' } });

      const res = await post({
        source: { text: TEXT },
        projectId: 'project-1',
        profile: 'full',
        wait: true,
      });

      expect(res.status).toBe(200);
      const data = assessmentDetailSchema.parse((await json(res)).data);
      expect(data.contextUsed).toEqual({
        brief: { offer: 'Bicycles' },
        documents: [{ id: 'link-guide', title: 'Brand guide' }],
        passages: [{ documentId: 'link-guide', chunkId: 'c-guide', text: 'Our voice is plain.' }],
      });
      expect(sentToJudges().length).toBeGreaterThan(0);
      for (const block of sentToJudges()) expect(block).toContain('Our voice is plain.');
    });

    it('gives a review kept nowhere the context too, and says what it used', async () => {
      project({ brief: {} });

      const res = await post({
        source: { text: TEXT },
        projectId: 'project-1',
        profile: 'full',
        store: false,
      });

      expect(res.status).toBe(200);
      const data = ephemeralAssessmentSchema.parse((await json(res)).data);
      expect(data.contextUsed?.documents).toEqual([{ id: 'link-guide', title: 'Brand guide' }]);
      for (const block of sentToJudges()) expect(block).toContain('Our voice is plain.');
      // Its searches' cost rows are the run's, so its charge includes them.
      // Its searches' cost rows are the run's, so its charge includes them,
      // and `ephemeral`, so usage counts them with the reviews kept nowhere.
      expect(mocks.search.mock.calls[0]?.[4]).toMatchObject({
        metadata: { ephemeral: true, ephemeralRun: expect.any(String), kind: 'project_context' },
      });
    });

    it('searches a review kept nowhere in the run’s own privacy scope', async () => {
      project();
      let scopeId: string | undefined;
      mocks.search.mockImplementation(async () => {
        scopeId = currentPrivacyScope()?.scopeId;
        return {
          results: [],
          embedding: { model: 'e', provider: 'p', inputTokens: 1, costUsd: 0 },
        };
      });

      await post({ source: { text: TEXT }, projectId: 'project-1', profile: 'full', store: false });

      expect(scopeId).toMatch(/^assessment:ephemeral:/);
    });

    it('refuses a review kept nowhere with 409 when the embedding setup stops the search', async () => {
      project();
      mocks.search.mockRejectedValue(new PrivacyRefusedError('embeddings_local_only', 'openai'));

      const res = await post({
        source: { text: TEXT },
        projectId: 'project-1',
        profile: 'full',
        store: false,
      });

      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatchObject({
        code: 'PROJECT_CONTEXT_NOT_SET_UP',
        details: { costUsd: 0 },
      });
      expect(mocks.runJudge).not.toHaveBeenCalled();
    });

    it('refuses a review kept nowhere with 503 when the documents cannot be searched, calling no judge', async () => {
      project();
      mocks.search.mockRejectedValue(new Error('embedding provider down'));

      const res = await post({
        source: { text: TEXT },
        projectId: 'project-1',
        profile: 'full',
        store: false,
      });

      expect(res.status).toBe(503);
      expect((await json(res)).error).toMatchObject({ code: 'PROJECT_CONTEXT_UNAVAILABLE' });
      expect(mocks.runJudge).not.toHaveBeenCalled();
    });

    it('searches nothing for a quick review, which calls no model', async () => {
      project({ brief: { offer: 'Bicycles' } });

      const res = await post({ source: { text: TEXT }, projectId: 'project-1', wait: true });

      expect(assessmentDetailSchema.parse((await json(res)).data).contextUsed).toBeNull();
      expect(mocks.search).not.toHaveBeenCalled();
    });

    it('answers no context used outside a project', async () => {
      const res = await post({ source: { text: TEXT }, wait: true });

      expect(assessmentDetailSchema.parse((await json(res)).data).contextUsed).toBeNull();
      expect(mocks.search).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['another workspace’s project', { orgId: WS_B }, 404, 'PROJECT_NOT_FOUND', {}],
    ['an archived project', { archivedAt: new Date() }, 409, 'PROJECT_ARCHIVED', {}],
    [
      'a project scored with another framework',
      {},
      400,
      'PROJECT_FRAMEWORK_MISMATCH',
      { framework: 'other' },
    ],
    [
      'defaults the version no longer has',
      { defaults: { context: { contentType: 'retired_type' } } },
      400,
      'CONTEXT_INVALID',
      {},
    ],
  ])('refuses a review in %s, and stores nothing', async (_what, over, status, expected, extra) => {
    project(over);

    const res = await post({ source: { text: TEXT }, projectId: 'project-1', ...extra });

    expect(await code(res)).toEqual({ status, code: expected });
    expect(fake.assessments).toHaveLength(0);
    expect(fake.contents).toHaveLength(0);
  });

  it('says when the project’s defaults, not the request, are what the version refuses', async () => {
    project({ defaults: { context: { contentType: 'retired_type' } } });
    const fromContext = await json(await post({ source: { text: TEXT }, projectId: 'project-1' }));
    expect(fromContext.error).toMatchObject({
      code: 'CONTEXT_INVALID',
      message: expect.stringContaining("project's defaults"),
      details: expect.objectContaining({ fromProjectDefaults: true, issues: expect.any(Array) }),
    });

    mocks.projects.length = 0;
    fake.projects.length = 0;
    project({ defaults: { profile: 'everything' } });
    const fromProfile = await json(await post({ source: { text: TEXT }, projectId: 'project-1' }));
    expect(fromProfile.error).toMatchObject({
      code: 'PROFILE_UNKNOWN',
      details: { fromProjectDefaults: true },
    });
  });

  it('answers 409 PROJECT_ARCHIVED for a project archived after the first check', async () => {
    project();
    // The write's own check sees it archived, as after a slow page fetch.
    const at = fake.projects.findIndex((p) => p.id === 'project-1');
    fake.projects[at] = { ...fake.projects[at], archivedAt: new Date() };

    const res = await post({ source: { text: TEXT }, projectId: 'project-1' });

    expect(await code(res)).toEqual({ status: 409, code: 'PROJECT_ARCHIVED' });
    expect(fake.assessments).toHaveLength(0);
    expect(fake.contents).toHaveLength(0);
  });

  it('does not blame the project for a context id the request sent itself', async () => {
    project();
    const res = await json(
      await post({
        source: { text: TEXT },
        projectId: 'project-1',
        context: { contentType: 'haiku' },
      })
    );
    expect(res.error?.code).toBe('CONTEXT_INVALID');
    expect(res.error?.details?.fromProjectDefaults).toBeUndefined();
  });

  it('does not blame a project with no default profile for judges the request named', async () => {
    project({ defaults: {} });
    const res = await json(
      await post({ source: { text: TEXT }, projectId: 'project-1', judges: ['judge_x'] })
    );
    expect(res.error?.code).toBe('PROFILE_UNKNOWN');
    expect(res.error?.details?.fromProjectDefaults).toBeUndefined();
  });

  it('does not blame the project for a profile the request named itself', async () => {
    project();
    const res = await json(
      await post({ source: { text: TEXT }, projectId: 'project-1', profile: 'everything' })
    );
    expect(res.error?.code).toBe('PROFILE_UNKNOWN');
    expect(res.error?.details?.fromProjectDefaults).toBeUndefined();
  });

  it('lists only a project’s reviews when asked', async () => {
    project();
    await post({ source: { text: TEXT }, projectId: 'project-1', wait: true });
    await post({ source: { text: TEXT }, profile: 'quick', wait: true });

    const all = await json(await getList());
    const inProject = await json(await getList('?projectId=project-1'));

    expect(all.meta).toMatchObject({ total: 2 });
    expect(inProject.meta).toMatchObject({ total: 1 });
    expect(inProject.data).toEqual([expect.objectContaining({ projectId: 'project-1' })]);
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
      'assessment_quick_scan',
      'assessment_judge',
      'assessment_judge',
      'assessment_status',
      'assessment_done',
    ]);
    expect(all[0]?.data).toEqual({ type: 'assessment_status', id, status: 'running' });
    // The quick scan comes before any judge (t-77): the stub's answer with no judges.
    expect(all[1]?.data).toEqual({
      type: 'assessment_quick_scan',
      id,
      overall: 50,
      band: 'mixed',
      result: { scores: { overall: 50, band: 'mixed' }, judged: [] },
    });
    expect(all.filter((f) => f.event === 'assessment_judge').map((f) => f.data.judge)).toEqual(TWO);
    expect(all[5]?.data).toMatchObject({
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

  it('sends a running review’s quick scan first to a stream opened late, before the judges that landed (t-77)', async () => {
    const a = fake.seed({ status: 'RUNNING', judges: TWO }, [
      { judge: 'judge_ethos', status: 'SUCCEEDED' },
    ]);
    const ac = new AbortController();
    const res = await stream(String(a.id), ac.signal);
    const received = frames(res);
    await settle();
    ac.abort();
    const all = await received;
    expect(all.slice(0, 3).map((f) => f.event)).toEqual([
      'assessment_status',
      'assessment_quick_scan',
      'assessment_judge',
    ]);
    expect(all[1]?.data).toMatchObject({ overall: 50, band: 'mixed' });
  });

  it('sends no quick scan for a quick review, nor for text the engine cannot score (t-77)', async () => {
    const quick = fake.seed({ status: 'COMPLETED', profile: 'quick', judges: [] });
    const unscorable = fake.seed({ status: 'RUNNING', judges: TWO });
    const fromQuick = await frames(await stream(String(quick.id)));
    engine.assemble.mockImplementationOnce(() => {
      throw new Error('cannot score this');
    });
    const ac = new AbortController();
    const received = frames(await stream(String(unscorable.id), ac.signal));
    await settle();
    ac.abort();
    const fromUnscorable = await received;

    expect(fromQuick.map((f) => f.event)).not.toContain('assessment_quick_scan');
    // The poll found the review, so the stream did open on it.
    expect(fromUnscorable[0]?.event).toBe('assessment_status');
    expect(fromUnscorable.map((f) => f.event)).not.toContain('assessment_quick_scan');
  });

  it('skips the quick scan, and carries on, when it cannot be read (t-77)', async () => {
    const a = fake.seed({ status: 'RUNNING', judges: TWO }, [
      { judge: 'judge_ethos', status: 'SUCCEEDED' },
    ]);
    mocks.engineForVersion.mockRejectedValueOnce(new Error('connection reset'));
    const ac = new AbortController();
    const received = frames(await stream(String(a.id), ac.signal));
    await settle();
    ac.abort();
    const all = await received;

    expect(all.slice(0, 2).map((f) => f.event)).toEqual(['assessment_status', 'assessment_judge']);
    expect(log.error).toHaveBeenCalledWith(
      'Could not read a running review’s quick scan for its stream',
      expect.any(Error),
      { assessmentId: a.id }
    );
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

  it('404, not 500, for a delete that lost a race with another', async () => {
    const a = fake.seed({ status: 'COMPLETED' });
    // The other delete lands between this one's read and its write.
    fake.db.assessment.findUnique.mockImplementationOnce(async () => {
      const row = { contentId: a.contentId };
      fake.assessments.splice(fake.assessments.indexOf(a), 1);
      return row;
    });
    expect(await code(await del(String(a.id)))).toEqual({ status: 404, code: 'NOT_FOUND' });
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

describe('POST /api/v1/assessments — store: false and the running places (t-28)', () => {
  const ONE = ['judge_ethos'];
  const live = () => ({
    status: 'RUNNING',
    leaseExpiresAt: new Date(Date.now() + 30_000),
    attempts: 1,
  });
  /** `store: false` with one judge, held until `gate` resolves. */
  function heldEphemeral(gate: Promise<void>) {
    mocks.runJudge.mockImplementationOnce(async (slot: string) => {
      await gate;
      return reply(slot);
    });
    return post({ source: { text: TEXT }, judges: ONE, store: false });
  }
  /** Until `fn` holds, or give up after a second. */
  async function until(fn: () => boolean) {
    for (let i = 0; i < 100 && !fn(); i += 1) await new Promise((r) => setTimeout(r, 10));
    expect(fn()).toBe(true);
  }

  it('lets exactly three of four ephemeral runs fired at once start; the fourth is refused and starts no judge', async () => {
    // The per-user cap (3 here) would refuse the fourth first; this is about places.
    const cap = vi
      .spyOn(aiAssessmentLimiter, 'check')
      .mockReturnValue({ success: true, limit: 99, remaining: 99, reset: 0 });
    const gate = deferred();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      await gate.promise;
      return reply(slot);
    });
    const all = [1, 2, 3, 4].map(() => post({ source: { text: TEXT }, judges: ONE, store: false }));
    await until(() => mocks.runJudge.mock.calls.length === 3 && fake.places.length === 3);
    gate.resolve();
    const answered = await Promise.all(all);

    const refused = answered.filter((res) => res.status === 429);
    expect(answered.map((res) => res.status).sort()).toEqual([200, 200, 200, 429]);
    expect(refused[0]?.headers.get('Retry-After')).toBe('15');
    expect((await json(refused[0])).error).toMatchObject({
      code: 'WORKSPACE_BUSY',
      details: { running: 3, waiting: 0, limit: 3 },
    });
    // The refused one started no judge: three runs, one judge each.
    expect(mocks.runJudge).toHaveBeenCalledTimes(3);
    expect(fake.places).toEqual([]);
    cap.mockRestore();
  });

  it('counts stored runs too: refused with two stored running and one ephemeral', async () => {
    fake.seed({ ...live(), leaseToken: 'run-1' });
    fake.seed({ ...live(), leaseToken: 'run-2' });
    const gate = deferred();
    const held = heldEphemeral(gate.promise);
    await until(() => fake.places.length === 1);

    const res = await post({ source: { text: TEXT }, judges: ONE, store: false });
    expect(await code(res)).toEqual({ status: 429, code: 'WORKSPACE_BUSY' });
    expect(mocks.runJudge).toHaveBeenCalledTimes(1);

    gate.resolve();
    expect((await held).status).toBe(200);
  });

  it('holds stored runs to the shared limit: a stored claim sees an ephemeral run’s place', async () => {
    fake.seed({ ...live(), leaseToken: 'run-1' });
    fake.seed({ ...live(), leaseToken: 'run-2' });
    const gate = deferred();
    const held = heldEphemeral(gate.promise);
    await until(() => fake.places.length === 1);
    // Queued after the ephemeral run took the last place.
    const queued = fake.seed({ judges: ONE });

    expect(await runAsOrg(WS_A, () => runAssessment(String(queued.id)))).toBe('not_claimed');
    expect(queued).toMatchObject({ status: 'QUEUED', attempts: 0 });

    // Not starved: when the ephemeral run ends, the queued stored one starts.
    gate.resolve();
    expect((await held).status).toBe(200);
    await until(() => queued.status === 'COMPLETED');
    expect(queued).toMatchObject({ status: 'COMPLETED', attempts: 1 });
  });

  it('gives a freed place to a queued stored review first: refused while one waits', async () => {
    fake.seed({ ...live(), leaseToken: 'run-1' });
    fake.seed({ ...live(), leaseToken: 'run-2' });
    // One place is free, but a stored review is waiting for it.
    fake.seed({ judges: ONE });
    const res = await post({ source: { text: TEXT }, judges: ONE, store: false });
    expect(res.status).toBe(429);
    expect((await json(res)).error).toMatchObject({
      code: 'WORKSPACE_BUSY',
      details: { running: 2, waiting: 1, limit: 3 },
    });
    expect(mocks.runJudge).not.toHaveBeenCalled();
  });

  it('counts a stalled stored run (RUNNING, lease run out) as waiting for a place', async () => {
    fake.seed({ ...live(), leaseToken: 'run-1' });
    fake.seed({ ...live(), leaseToken: 'run-2' });
    fake.seed({ status: 'RUNNING', leaseExpiresAt: new Date(Date.now() - 1), attempts: 1 });
    const res = await post({ source: { text: TEXT }, judges: ONE, store: false });
    expect(await code(res)).toEqual({ status: 429, code: 'WORKSPACE_BUSY' });
  });

  it('starts the queue when it refuses only because reviews wait, with places free', async () => {
    // Nothing running; three queued reviews whose own start was lost.
    const waiting = [1, 2, 3].map(() => fake.seed({ judges: ONE }));
    const res = await post({ source: { text: TEXT }, judges: ONE, store: false });
    expect(res.status).toBe(429);
    expect((await json(res)).error?.details).toEqual({ running: 0, waiting: 3, limit: 3 });
    await until(() => waiting.every((a) => a.status === 'COMPLETED'));
  });

  it('starts stalled runs too (RUNNING, lease run out), and kicks once per interval', async () => {
    const stalled = [1, 2, 3].map(() =>
      fake.seed({
        judges: ONE,
        status: 'RUNNING',
        leaseExpiresAt: new Date(Date.now() - 1),
        attempts: 1,
      })
    );
    const first = await post({ source: { text: TEXT }, judges: ONE, store: false });
    expect(first.status).toBe(429);
    await until(() => stalled.every((a) => a.status === 'COMPLETED'));
    expect(stalled.map((a) => a.attempts)).toEqual([2, 2, 2]);
    // Let each ended run's own `startNextQueued` find nothing first.
    await settle();

    // Three more stall; a refusal within the interval does not start them.
    const again = [1, 2, 3].map(() => fake.seed({ judges: ONE }));
    const second = await post({ source: { text: TEXT }, judges: ONE, store: false });
    expect(second.status).toBe(429);
    await settle();
    expect(again.map((a) => a.status)).toEqual(['QUEUED', 'QUEUED', 'QUEUED']);
  });

  it('ignores queued stored reviews that can no longer start (out of attempts)', async () => {
    fake.seed({ ...live(), leaseToken: 'run-1' });
    fake.seed({ ...live(), leaseToken: 'run-2' });
    fake.seed({ judges: ONE, attempts: 3 });
    const res = await post({ source: { text: TEXT }, judges: ONE, store: false });
    expect(res.status).toBe(200);
  });

  it('does not charge the per-user cap for a request refused because the workspace is full', async () => {
    for (const n of [1, 2, 3]) fake.seed({ ...live(), leaseToken: `run-${n}` });
    const check = vi.spyOn(aiAssessmentLimiter, 'check');
    const res = await post({ source: { text: TEXT }, judges: ONE, store: false });
    expect(await code(res)).toEqual({ status: 429, code: 'WORKSPACE_BUSY' });
    expect(check).not.toHaveBeenCalled();
    check.mockRestore();
  });

  it('takes no place for the quick scan, which calls no model: answered with the workspace full', async () => {
    for (const n of [1, 2, 3]) fake.seed({ ...live(), leaseToken: `run-${n}` });
    const res = await post({ source: { text: TEXT }, profile: 'quick', store: false });
    expect(res.status).toBe(200);
    expect(fake.db.assessmentPlace.create).not.toHaveBeenCalled();
  });

  it('gives the place up when the run throws', async () => {
    engine.assemble.mockImplementationOnce(() => {
      throw new Error('no score');
    });
    const res = await post({ source: { text: TEXT }, judges: ONE, store: false });
    expect(await code(res)).toEqual({ status: 422, code: 'NOT_SCORABLE' });
    expect(fake.db.assessmentPlace.create).toHaveBeenCalledTimes(1);
    expect(fake.places).toEqual([]);
  });

  it('treats a place whose lease ran out as free, and clears it', async () => {
    const dead = new Date(Date.now() - 1);
    for (const n of [1, 2, 3]) {
      fake.places.push({ id: `dead-${n}`, orgId: WS_A, leaseExpiresAt: dead });
    }
    const res = await post({ source: { text: TEXT }, judges: ONE, store: false });
    expect(res.status).toBe(200);
    expect(fake.places).toEqual([]);
  });

  it('counts only this workspace’s places', async () => {
    const later = new Date(Date.now() + 30_000);
    for (const n of [1, 2, 3]) {
      fake.places.push({ id: `b-${n}`, orgId: WS_B, leaseExpiresAt: later });
    }
    const res = await post({ source: { text: TEXT }, judges: ONE, store: false });
    expect(res.status).toBe(200);
    expect(fake.places.map((p) => p.orgId)).toEqual([WS_B, WS_B, WS_B]);
  });
});

describe('POST /api/v1/assessments — the monthly budget (t-49)', () => {
  /** A $10 budget with `spent` of it used this month. */
  function budget(spent: number) {
    mocks.loadOrgQuotas.mockResolvedValue({ monthlyBudgetUsd: 10 });
    mocks.monthSpend.mockResolvedValue({ _sum: { totalCostUsd: spent } });
  }
  /**
   * Three completed full reviews at $1 each over the 9 judges `full` resolves
   * to here: an estimate of $1.00 (the check estimates per judge).
   */
  function fullReviewsAtOneDollar() {
    const judges = Array.from({ length: 9 }, (_, i) => `judge_${i}`);
    for (let i = 0; i < 3; i += 1) fake.seed({ status: 'COMPLETED', costUsd: 1, judges });
  }
  const writtenBefore = () => fake.assessments.length;

  for (const store of [true, false]) {
    const label = store ? 'stored' : 'store: false';

    it(`${label}: 402 BUDGET_EXCEEDED at the cap, starting no judge and writing no assessment`, async () => {
      budget(10);
      const before = writtenBefore();
      const check = vi.spyOn(aiAssessmentLimiter, 'check');

      const res = await post({ source: { text: TEXT }, store, ...(store ? {} : { wait: true }) });

      const body = await json(res);
      expect(res.status).toBe(402);
      expect(body.error?.code).toBe('BUDGET_EXCEEDED');
      expect(body.error?.details).toEqual({
        estimateUsd: 0,
        basis: 'none',
        remainingUsd: 0,
        inFlightUsd: 0,
        limitUsd: 10,
        usagePage: '/usage',
      });
      expect(mocks.runJudge).not.toHaveBeenCalled();
      expect(fake.db.assessment.create).not.toHaveBeenCalled();
      expect(fake.assessments).toHaveLength(before);
      // Refused before it was counted against the per-user cap.
      expect(check).not.toHaveBeenCalled();
      check.mockRestore();
    });

    it(`${label}: 402 when the estimate is over what is left`, async () => {
      fullReviewsAtOneDollar();
      budget(9.5);
      const before = writtenBefore();

      const res = await post({ source: { text: TEXT }, store, ...(store ? {} : { wait: true }) });

      expect(res.status).toBe(402);
      expect((await json(res)).error?.details).toMatchObject({
        estimateUsd: 1,
        basis: 'profile',
        remainingUsd: 0.5,
      });
      expect(mocks.runJudge).not.toHaveBeenCalled();
      expect(fake.assessments).toHaveLength(before);
    });

    it(`${label}: runs when the estimate is under what is left`, async () => {
      fullReviewsAtOneDollar();
      budget(8.5);

      const res = await post({ source: { text: TEXT }, store, ...(store ? {} : { wait: true }) });

      expect(res.status).toBe(store ? 202 : 200);
      if (store) await settle();
      expect(mocks.runJudge).toHaveBeenCalled();
    });
  }

  it('never refuses the quick profile for budget, stored or not, past the cap', async () => {
    budget(25);
    expect((await post({ source: { text: TEXT }, profile: 'quick' })).status).toBe(202);
    expect((await post({ source: { text: TEXT }, profile: 'quick', store: false })).status).toBe(
      200
    );
  });
});

describe('POST /api/v1/assessments — budget held while a request is under way (t-50, t-51)', () => {
  const nine = Array.from({ length: 9 }, (_, i) => `judge_${i}`);
  /** A $10 budget with `spent` used, and $1.00 a full review (as in t-49's tests). */
  function budget(spent: number) {
    mocks.loadOrgQuotas.mockResolvedValue({ monthlyBudgetUsd: 10 });
    mocks.monthSpend.mockResolvedValue({ _sum: { totalCostUsd: spent } });
    for (let i = 0; i < 3; i += 1) fake.seed({ status: 'COMPLETED', costUsd: 1, judges: nine });
  }
  /** A page whose fetch waits for `gate`: the request holds budget with no row yet. */
  function slowPage(gate: Promise<void>) {
    mocks.fetchPage.mockImplementation(async () => {
      await gate;
      return {
        text: TEXT,
        title: null,
        url: 'https://example.com/p',
        wordCount: 14,
        format: 'html',
        warnings: [],
      };
    });
  }
  async function until(fn: () => boolean) {
    for (let i = 0; i < 100 && !fn(); i += 1) await new Promise((r) => setTimeout(r, 10));
    expect(fn()).toBe(true);
  }
  const page = { url: 'https://example.com/p' };

  for (const [first, second] of [
    [true, true],
    [false, false],
    [true, false],
    [false, true],
  ]) {
    const label = (store: boolean) => (store ? 'stored' : 'store: false');
    it(`of two sent together with room for one (${label(first)}, then ${label(second)}), refuses the second with the first's hold in inFlightUsd`, async () => {
      budget(8.5);
      const gate = deferred();
      slowPage(gate.promise);

      const pending = post({ source: page, store: first, ...(first ? {} : { wait: true }) });
      await until(() => fake.holds.length === 1);
      const res = await post({ source: page, store: second, ...(second ? {} : { wait: true }) });

      const body = await json(res);
      expect(res.status).toBe(402);
      expect(body.error?.code).toBe('BUDGET_EXCEEDED');
      expect(body.error?.details).toMatchObject({
        estimateUsd: 1,
        inFlightUsd: 1,
        remainingUsd: 0.5,
      });
      expect(body.error?.message).toContain('held for reviews already starting');
      gate.resolve();
      expect((await pending).status).toBe(first ? 202 : 200);
      await settle();
      expect(fake.holds).toEqual([]);
      // Only the first's review: the second wrote nothing and called nothing.
      expect(mocks.runJudge).toHaveBeenCalledTimes(9);
    });
  }

  it('stored: holds from the check until the review is stored, whose row then counts in its place', async () => {
    budget(8.5);
    const gate = deferred();
    slowPage(gate.promise);
    // The run is held back, so the review stays queued after the request.
    mocks.runJudge.mockImplementation(() => new Promise(() => undefined));

    const pending = post({ source: page });
    await until(() => fake.holds.length === 1);
    expect(fake.holds[0]).toMatchObject({ orgId: WS_A, judges: 9, stored: true });
    const before = fake.assessments.length;
    gate.resolve();
    expect((await pending).status).toBe(202);

    expect(fake.holds).toEqual([]);
    expect(fake.assessments).toHaveLength(before + 1);
    // Its row holds it now: a second request is still refused.
    const res = await post({ source: { text: TEXT } });
    expect((await json(res)).error?.details).toMatchObject({ inFlightUsd: 1, remainingUsd: 0.5 });
  });

  it('store: false: holds while its judges run, against stored and store: false requests, and releases when the run ends (t-51)', async () => {
    budget(8.5);
    const gate = deferred();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      await gate.promise;
      return reply(slot);
    });

    const pending = post({ source: { text: TEXT }, store: false });
    await until(() => mocks.runJudge.mock.calls.length > 0);
    expect(fake.holds).toEqual([expect.objectContaining({ judges: 9, stored: false })]);

    for (const store of [true, false]) {
      const res = await post({ source: { text: TEXT }, store });
      expect(res.status).toBe(402);
      expect((await json(res)).error?.details).toMatchObject({ inFlightUsd: 1 });
    }
    gate.resolve();
    expect((await pending).status).toBe(200);
    expect(fake.holds).toEqual([]);
  });

  it('holds nothing for a request refused 429 (the per-user cap, a full workspace), and releases the hold of a page that cannot be fetched', async () => {
    budget(0);
    const cap = vi
      .spyOn(aiAssessmentLimiter, 'check')
      .mockReturnValueOnce({ success: false, limit: 3, remaining: 0, reset: Date.now() + 60_000 });
    expect((await post({ source: { text: TEXT } })).status).toBe(429);
    cap.mockRestore();

    for (let i = 0; i < 3; i += 1)
      fake.places.push({ id: `p${i}`, orgId: WS_A, leaseExpiresAt: new Date(Date.now() + 60_000) });
    expect(await code(await post({ source: { text: TEXT }, store: false }))).toEqual({
      status: 429,
      code: 'WORKSPACE_BUSY',
    });
    fake.places.length = 0;
    // Refused before the hold is taken: none held budget meanwhile.
    expect(fake.db.budgetHold.create).not.toHaveBeenCalled();

    mocks.fetchPage.mockRejectedValue(
      new IntakeError(IntakeErrorCodes.FETCH_FAILED, 'The page could not be fetched.')
    );
    for (const store of [true, false]) {
      const res = await post({ source: page, store });
      expect(await code(res)).toEqual({ status: 422, code: 'FETCH_FAILED' });
      expect(fake.holds).toEqual([]);
    }
  });

  it('store: false: releases the hold of a caller gone away', async () => {
    budget(0);
    const gone = new AbortController();
    gone.abort();
    const res = await create(
      new NextRequest(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: { text: TEXT }, store: false }),
        signal: gone.signal,
      })
    );
    expect(await code(res)).toEqual({ status: 499, code: 'REQUEST_CLOSED' });
    expect(fake.holds).toEqual([]);
  });
});

describe('a queued review checked against the budget again as it is claimed (t-53)', () => {
  const nine = Array.from({ length: 9 }, (_, i) => `judge_${i}`);

  it('is failed with BUDGET_EXCEEDED and its figures, which the read and the events stream show', async () => {
    // $1.00 a review, as in t-49's tests; it was queued while the budget had room.
    for (let i = 0; i < 3; i += 1) fake.seed({ status: 'COMPLETED', costUsd: 1, judges: nine });
    const queued = fake.seed({ judges: nine, profile: 'full' });
    const id = String(queued.id);
    // Spend landed while it waited: $0.50 left.
    mocks.loadOrgQuotas.mockResolvedValue({ monthlyBudgetUsd: 10 });
    mocks.monthSpend.mockResolvedValue({ _sum: { totalCostUsd: 9.5 } });

    expect(await runAsOrg(WS_A, () => runAssessment(id))).toBe('failed');

    expect(mocks.runJudge).not.toHaveBeenCalled();
    const figures = {
      estimateUsd: 1,
      basis: 'profile',
      remainingUsd: 0.5,
      inFlightUsd: 0,
      limitUsd: 10,
      usagePage: '/usage',
    };
    const body = await json(await getOne(id));
    expect(body.data).toMatchObject({
      status: 'failed',
      errorCode: 'BUDGET_EXCEEDED',
      errorDetails: figures,
      costUsd: 0,
      judgeRuns: [],
    });
    expect(body.data?.error).toContain('more than the $0.50 left');

    const listed = await json(await getList(''));
    expect((listed.data as unknown as Row[]).find((r) => r.id === id)).toMatchObject({
      errorCode: 'BUDGET_EXCEEDED',
      errorDetails: figures,
    });

    const done = (await frames(await stream(id))).at(-1);
    expect(done?.data).toMatchObject({
      type: 'assessment_done',
      status: 'failed',
      errorCode: 'BUDGET_EXCEEDED',
    });
  });

  it('answers errorCode and errorDetails null for a review that failed otherwise, and for figures not in the refusal’s shape', async () => {
    const plain = fake.seed({
      status: 'FAILED',
      error: 'Its framework version can no longer be run.',
    });
    const odd = fake.seed({
      status: 'FAILED',
      errorCode: 'BUDGET_EXCEEDED',
      errorDetails: { x: 1 },
    });

    expect((await json(await getOne(String(plain.id)))).data).toMatchObject({
      errorCode: null,
      errorDetails: null,
    });
    expect((await json(await getOne(String(odd.id)))).data).toMatchObject({
      errorCode: 'BUDGET_EXCEEDED',
      errorDetails: null,
    });
  });
});

describe('POST /api/v1/assessments — CopyCredits (t-58)', () => {
  const nine = Array.from({ length: 9 }, (_, i) => `judge_${i}`);
  /** The workspace's balance, in place of the credits to spare every test starts with. */
  function credits(balance: number) {
    fake.credits.length = 0;
    if (balance !== 0) fake.grant(WS_A, balance);
  }
  /** $1.00 (100 credits) a full review, as in t-49's tests. */
  function fullReviewsAtOneDollar() {
    for (let i = 0; i < 3; i += 1) fake.seed({ status: 'COMPLETED', costUsd: 1, judges: nine });
  }
  const charges = () => fake.credits.filter((c) => c.kind === 'CHARGE');

  for (const store of [true, false]) {
    const label = store ? 'stored' : 'store: false';

    it(`${label}: 402 INSUFFICIENT_CREDITS with none, starting no judge, writing and charging nothing`, async () => {
      credits(0);
      const before = fake.assessments.length;

      const res = await post({ source: { text: TEXT }, store, ...(store ? {} : { wait: true }) });

      const body = await json(res);
      expect(res.status).toBe(402);
      expect(body.error?.code).toBe('INSUFFICIENT_CREDITS');
      expect(body.error?.details).toEqual({
        estimateCredits: 0,
        basis: 'none',
        balanceCredits: 0,
        heldCredits: 0,
        remainingCredits: 0,
        usagePage: '/usage',
      });
      expect(body.error?.message).toContain('review code');
      expect(mocks.runJudge).not.toHaveBeenCalled();
      expect(fake.assessments).toHaveLength(before);
      expect(charges()).toEqual([]);
    });

    it(`${label}: 402 when the estimate is over the balance, and runs when it is not`, async () => {
      fullReviewsAtOneDollar();
      credits(99);
      const refused = await post({
        source: { text: TEXT },
        store,
        ...(store ? {} : { wait: true }),
      });
      expect(refused.status).toBe(402);
      expect((await json(refused)).error?.details).toMatchObject({
        estimateCredits: 100,
        balanceCredits: 99,
        remainingCredits: 99,
      });

      credits(100);
      const ran = await post({ source: { text: TEXT }, store, ...(store ? {} : { wait: true }) });
      expect(ran.status).toBe(store ? 202 : 200);
    });
  }

  it('charges a store: false review once for its rows, by the run its judges tagged', async () => {
    let runId: string | undefined;
    mocks.runJudge.mockImplementation(
      async (slot: string, input: { costTags?: { ephemeralRun?: string } }) => {
        runId = input.costTags?.ephemeralRun;
        fake.addCost(WS_A, 0.0151, { ephemeral: true, ephemeralRun: runId, judge: slot });
        return reply(slot);
      }
    );

    const res = await post({ source: { text: TEXT }, judges: TWO, store: false, wait: true });

    expect(res.status).toBe(200);
    // $0.0302 is 3.02 credits: 4.
    expect(charges()).toEqual([
      expect.objectContaining({ orgId: WS_A, amount: -4, reference: `ephemeral-run:${runId}` }),
    ]);
    // Charged before its hold was released.
    expect(fake.holds).toEqual([]);
  });

  it('keeps a store: false review’s hold when its charge fails, until the recovery job can charge it', async () => {
    mocks.runJudge.mockImplementation(
      async (slot: string, input: { costTags?: { ephemeralRun?: string } }) => {
        const run = input.costTags?.ephemeralRun;
        fake.addCost(WS_A, 0.0151, { ephemeral: true, ephemeralRun: run, judge: slot });
        return reply(slot);
      }
    );
    fake.db.creditEntry.createMany.mockRejectedValueOnce(new Error('connection reset'));

    const res = await post({ source: { text: TEXT }, judges: TWO, store: false, wait: true });

    // The review is the caller's all the same.
    expect(res.status).toBe(200);
    expect(charges()).toEqual([]);
    // Held on, past the hour of quiet the recovery job waits for.
    expect(fake.holds).toEqual([expect.objectContaining({ judges: 2, stored: false })]);
    const kept = fake.holds[0]?.leaseExpiresAt as Date;
    expect(kept.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000);
  });

  it('charges a store: false review whose result could not be scored for what its judges spent', async () => {
    mocks.runJudge.mockImplementation(
      async (slot: string, input: { costTags?: { ephemeralRun?: string } }) => {
        fake.addCost(WS_A, 0.02, { ephemeral: true, ephemeralRun: input.costTags?.ephemeralRun });
        return reply(slot);
      }
    );
    engine.assemble.mockImplementationOnce(() => {
      throw new Error('cannot score');
    });

    const res = await post({ source: { text: TEXT }, judges: TWO, store: false, wait: true });

    expect(res.status).toBe(422);
    expect(charges()).toEqual([expect.objectContaining({ amount: -4 })]);
  });

  it('charges a stored review as it completes, once', async () => {
    mocks.runJudge.mockImplementation(async (slot: string, input: { assessmentId?: string }) => {
      fake.addCost(WS_A, 0.01, { assessmentId: input.assessmentId, judge: slot });
      return reply(slot);
    });

    const res = await post({ source: { text: TEXT }, judges: TWO, wait: true });
    const id = String((await json(res)).data?.id);

    expect(res.status).toBe(200);
    expect(charges()).toEqual([
      expect.objectContaining({ orgId: WS_A, amount: -2, reference: `assessment:${id}` }),
    ]);
  });

  it('a delete charges an open review for what its runs spent', async () => {
    const queued = fake.seed({ status: 'QUEUED', attempts: 1 });
    fake.addCost(WS_A, 0.03, { assessmentId: queued.id });
    expect((await del(String(queued.id))).status).toBe(200);
    expect(charges()).toEqual([
      expect.objectContaining({ amount: -3, reference: `assessment:${String(queued.id)}` }),
    ]);
  });

  it('a delete charges a review a live run holds, since that run may be gone', async () => {
    const running = fake.seed({
      status: 'RUNNING',
      leaseToken: 'alive',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    fake.addCost(WS_A, 0.03, { assessmentId: running.id });
    expect((await del(String(running.id))).status).toBe(200);
    expect(charges()).toEqual([
      expect.objectContaining({ amount: -3, reference: `assessment:${String(running.id)}` }),
    ]);
  });

  it('a delete charges a cancelled review whose judges were still landing, live lease or lapsed', async () => {
    for (const leaseExpiresAt of [new Date(Date.now() + 60_000), new Date(Date.now() - 60_000)]) {
      const cancelled = fake.seed({
        status: 'CANCELLED',
        completedAt: new Date(Date.now() - 120_000),
        leaseToken: 'cancelled-run',
        leaseExpiresAt,
      });
      fake.addCost(WS_A, 0.02, { assessmentId: cancelled.id });
      expect((await del(String(cancelled.id))).status).toBe(200);
    }
    expect(charges()).toHaveLength(2);
    expect(charges().every((c) => c.amount === -2)).toBe(true);
  });

  it('a delete charges nothing for a review that ended: charged as it ended, or before charging began', async () => {
    // Final, with no charge entry: it ended before reviews were charged.
    const old = fake.seed({ status: 'COMPLETED', completedAt: new Date(Date.now() - 86_400_000) });
    fake.addCost(WS_A, 0.05, { assessmentId: old.id });
    // Cancelled, its lease cleared: the cancel charged it.
    const cancelled = fake.seed({
      status: 'CANCELLED',
      completedAt: new Date(),
      leaseExpiresAt: null,
    });
    fake.addCost(WS_A, 0.05, { assessmentId: cancelled.id });
    // Cancelled with a lease left set, but made before charging began.
    const stale = fake.seed({
      status: 'CANCELLED',
      createdAt: new Date(Date.now() - 3 * 86_400_000),
      completedAt: new Date(Date.now() - 3 * 86_400_000),
      leaseToken: 'dead',
      leaseExpiresAt: new Date(Date.now() - 3 * 86_400_000),
    });
    fake.addCost(WS_A, 0.05, { assessmentId: stale.id });

    for (const a of [old, cancelled, stale]) expect((await del(String(a.id))).status).toBe(200);
    expect(charges()).toEqual([]);
  });

  it('a queued review the credits no longer cover is failed with INSUFFICIENT_CREDITS as it is claimed', async () => {
    fullReviewsAtOneDollar();
    const queued = fake.seed({ judges: nine, profile: 'full' });
    credits(40);

    expect(await runAsOrg(WS_A, () => runAssessment(String(queued.id)))).toBe('failed');

    const body = await json(await getOne(String(queued.id)));
    expect(body.data).toMatchObject({
      status: 'failed',
      errorCode: 'INSUFFICIENT_CREDITS',
      errorDetails: { estimateCredits: 100, balanceCredits: 40, remainingCredits: 40 },
    });
    expect(mocks.runJudge).not.toHaveBeenCalled();
    expect(charges()).toEqual([]);
  });
});

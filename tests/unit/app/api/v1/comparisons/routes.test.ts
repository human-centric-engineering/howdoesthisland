/**
 * Tests: the `comparisons` routes (t-87), and a draft that is an existing review (t-84).
 *
 * POST/GET /api/v1/comparisons · GET/DELETE …/{id}
 *
 * Real: the guard, the comparison service, the review options as a single
 * review resolves them, the budget check and its holds, enqueue, the job
 * (claim, the workspace's running places, the next queued review started as
 * one ends), the per-user sub-cap, and the retention purge's SET NULL as the
 * fake models it. Replaced, as in the assessments route test: Prisma by the
 * stateful fake (`fake-db.ts`), `runJudge` (scripted), `runEditor`
 * (skipping), the version catalogue, and the engine's `assemble()`: a stub
 * scoring each draft from `SCORES` by its text, so the appeals compared are
 * known. The rest of the engine is the real 0.5.1 one, `appealScores`
 * and the verdict's validation included. The verdict's request is a stub
 * (the stub results have no findings to show), and the editor's call
 * (`callAgent`) answers through that validation; its ceiling
 * (`streamCeilingUsd`) is scripted (t-88).
 *
 * @see app/api/v1/comparisons/
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFakeDb, type FakeDb } from '@/tests/unit/lib/app/assessments/fake-db';

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
  callAgent: vi.fn(),
  streamCeilingUsd: vi.fn(),
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
  callAgent: mocks.callAgent,
  streamCeilingUsd: mocks.streamCeilingUsd,
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
  AI_ASSESSMENTS_PER_MINUTE: 6,
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

import { POST as create, GET as list } from '@/app/api/v1/comparisons/route';
import { GET as read, DELETE as remove } from '@/app/api/v1/comparisons/[id]/route';
import { DELETE as removeReview } from '@/app/api/v1/assessments/[id]/route';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import { loadModel } from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';
import { createMockAuthSession } from '@/tests/helpers/auth';
import { aiAssessmentLimiter } from '@/lib/app/assessments/api/limiter';
import { resetKicksForTests } from '@/lib/app/assessments/kick';
import { forgetEarlyScansForTests } from '@/lib/app/assessments/early-scan';
import { JudgeRunError } from '@/lib/app/judges/run-judge';
import { comparisonDetailSchema, comparisonSummarySchema } from '@/lib/app/api/registry';
import { forgetSpendCaps } from '@/lib/orchestration/llm/spend-caps';
import { RUNNING_PER_WORKSPACE } from '@/lib/app/assessments/limits';

const WS_A = 'org-a';
const WS_B = 'org-b';
const ALICE = 'cmuser0000000000000alice1';
const BOB = 'cmuser00000000000000bob01';
const TWO = ['judge_ethos', 'judge_pathos'];

const DRAFT_A = 'Book a demo this week and cut onboarding to two days.';
const DRAFT_B = 'Teams like yours onboard in two days. See how in a demo.';
const DRAFT_C = 'Onboarding takes two weeks. It does not have to.';
const DRAFT_D = 'Two days, not two weeks: book a demo.';
const DRAFT_E = 'Your team, onboarded by Friday.';
/** The appeals each draft scores, in the model's order. */
const SCORES: Record<string, Record<'ethos' | 'pathos' | 'logos' | 'kairos', number>> = {
  [DRAFT_A]: { ethos: 60, pathos: 50, logos: 70, kairos: 40 },
  [DRAFT_B]: { ethos: 72, pathos: 50, logos: 55, kairos: 45 },
  [DRAFT_C]: { ethos: 40, pathos: 66, logos: 50, kairos: 45 },
  [DRAFT_D]: { ethos: 50, pathos: 40, logos: 60, kairos: 70 },
  [DRAFT_E]: { ethos: 55, pathos: 55, logos: 45, kairos: 60 },
};
/** A draft the engine cannot score: its review ends `failed`. */
const UNSCORABLE = 'This draft breaks the scorer.';

const real = createHowDoesThisLandEngine(loadModel(), { culture: true });
const engine = {
  ...real,
  assemble: vi.fn((text: string) => {
    const appeals = SCORES[text];
    if (!appeals) throw new Error('cannot score');
    const overall = Math.round(
      (appeals.ethos + appeals.pathos + appeals.logos + appeals.kairos) / 4
    );
    return { scores: { overall, band: 'mixed', balance_index: 80, ...appeals } };
  }),
  buildVerdictRequest: vi.fn(() => ({
    prompt: 'Which draft lands better?',
    schema: {},
    schemaName: 'verdict',
    maxTokens: 100,
    timeoutMs: 1_000,
  })),
};

/** What the editor answers for a verdict, unless a test says otherwise (t-88). */
const VERDICT_REPLY = {
  draft: 'draft_2',
  why: 'It leads with who the reader is.',
  appeals: [{ appeal: 'ethos', why: 'It sounds like a peer, not a pitch.' }],
};

/** The editor's call: checked by the engine's own validation, writing its cost row as the real one does. */
async function editorCall(call: {
  costMetadata: Record<string, string>;
  validate: (raw: unknown) => { output: unknown; drops: unknown[] } | null;
}) {
  const checked = call.validate(VERDICT_REPLY);
  if (!checked) throw new JudgeRunError('malformed', 'not a verdict');
  fake.addCost(WS_A, 0.004, { ...call.costMetadata }, new Date());
  return { ...checked, provider: 'openai', model: 'gpt-5', costUsd: 0.004 };
}

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

/** Long enough for runs started after a response, and those they start, to end. */
const settle = () => new Promise((r) => setTimeout(r, 60));

function signedIn(userId: string, orgId: string) {
  const base = createMockAuthSession();
  mocks.getSession.mockResolvedValue({
    session: { ...base.session, userId, activeOrgId: orgId },
    user: { ...base.user, id: userId },
  });
}

const KEY_ID = 'cmkey000000000000000key1';
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

const BASE = 'http://localhost/api/v1/comparisons';

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
const getList = (query = '') => list(new NextRequest(`${BASE}${query}`));
const getOne = (id: string) => read(new NextRequest(`${BASE}/${id}`), params(id));
const del = (id: string) =>
  remove(new NextRequest(`${BASE}/${id}`, { method: 'DELETE' }), params(id));
const delReview = (id: string) =>
  removeReview(
    new NextRequest(`http://localhost/api/v1/assessments/${id}`, { method: 'DELETE' }),
    params(id)
  );

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}
const json = async (res: Response) => (await res.json()) as Envelope;

/** POST a comparison and answer its parsed body, failing unless it was accepted. */
async function compare(body: Record<string, unknown>) {
  const res = await post({ judges: TWO, ...body });
  const env = await json(res);
  if (res.status !== 202)
    throw new Error(`expected 202, got ${res.status}: ${JSON.stringify(env)}`);
  return comparisonDetailSchema.parse(env.data);
}
/** GET a comparison, parsed as the registry declares it. */
async function readBack(id: string) {
  const res = await getOne(id);
  expect(res.status).toBe(200);
  return comparisonDetailSchema.parse((await json(res)).data);
}
const drafts = (...texts: string[]) => texts.map((text, i) => ({ text, label: `Draft ${i + 1}` }));

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
  mocks.callAgent.mockImplementation(editorCall);
  mocks.streamCeilingUsd.mockResolvedValue(null);
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
  await settle();
});

// ---------------------------------------------------------------------------

describe('POST /api/v1/comparisons', () => {
  it('reviews every draft as an ordinary review, the same way, and answers 202', async () => {
    const created = await compare({
      drafts: drafts(DRAFT_A, DRAFT_B),
      context: { contentType: 'landing_page' },
    });

    expect(created).toMatchObject({
      kind: 'comparison',
      status: 'running',
      framework: { slug: 'howdoesthisland', version: '0.5.1' },
      profile: 'custom',
      judges: TWO,
      projectId: null,
      appeals: [],
    });
    expect(created.drafts.map((d) => [d.position, d.label])).toEqual([
      [0, 'Draft 1'],
      [1, 'Draft 2'],
    ]);
    // Two reviews, titled with their labels, with one version, context and set of judges.
    expect(fake.assessments).toHaveLength(2);
    const [first, second] = fake.assessments;
    for (const field of ['frameworkVersionId', 'context', 'judges', 'projectId', 'profile']) {
      expect(second[field]).toEqual(first[field]);
    }
    expect(first).toMatchObject({ createdByUserId: ALICE, requestedVia: 'APP' });
    expect(fake.contents.map((c) => [c.text, c.title])).toEqual([
      [DRAFT_A, 'Draft 1'],
      [DRAFT_B, 'Draft 2'],
    ]);
    expect(created.drafts.map((d) => d.assessmentId)).toEqual(fake.assessments.map((a) => a.id));
    expect(fake.sets).toEqual([
      expect.objectContaining({
        orgId: WS_A,
        kind: 'COMPARISON',
        frameworkVersionId: 'version-1',
        judges: TWO,
        createdByUserId: ALICE,
      }),
    ]);
  });

  it('reads back, once the drafts are reviewed, each appeal’s leader and each draft’s difference from the best', async () => {
    const { id } = await compare({ drafts: drafts(DRAFT_A, DRAFT_B, DRAFT_C) });
    await settle();

    const done = await readBack(id);

    expect(done.status).toBe('completed');
    expect(done.drafts.map((d) => [d.status, d.overall])).toEqual([
      ['completed', 55],
      ['completed', 56],
      ['completed', 50],
    ]);
    expect(done.drafts[1].appeals).toEqual([
      { appeal: 'ethos', score: 72 },
      { appeal: 'pathos', score: 50 },
      { appeal: 'logos', score: 55 },
      { appeal: 'kairos', score: 45 },
    ]);
    expect(done.appeals).toEqual([
      {
        appeal: 'ethos',
        leaders: [1],
        drafts: [
          { position: 0, score: 60, delta: -12 },
          { position: 1, score: 72, delta: 0 },
          { position: 2, score: 40, delta: -32 },
        ],
      },
      {
        appeal: 'pathos',
        leaders: [2],
        drafts: [
          { position: 0, score: 50, delta: -16 },
          { position: 1, score: 50, delta: -16 },
          { position: 2, score: 66, delta: 0 },
        ],
      },
      {
        appeal: 'logos',
        leaders: [0],
        drafts: [
          { position: 0, score: 70, delta: 0 },
          { position: 1, score: 55, delta: -15 },
          { position: 2, score: 50, delta: -20 },
        ],
      },
      // A tie: both lead.
      {
        appeal: 'kairos',
        leaders: [1, 2],
        drafts: [
          { position: 0, score: 40, delta: -5 },
          { position: 1, score: 45, delta: 0 },
          { position: 2, score: 45, delta: 0 },
        ],
      },
    ]);
  });

  it('takes drafts with no label, untitled, and records a request through an API key as the API’s', async () => {
    withKey(['assess']);

    const res = await post(
      { judges: TWO, drafts: [{ text: DRAFT_A }, { text: DRAFT_B }] },
      KEY_HEADERS
    );

    expect(res.status).toBe(202);
    const created = comparisonDetailSchema.parse((await json(res)).data);
    expect(created.drafts.map((d) => d.label)).toEqual([null, null]);
    expect(fake.contents.map((c) => c.title)).toEqual([null, null]);
    for (const review of fake.assessments) {
      expect(review).toMatchObject({
        requestedVia: 'API',
        apiKeyId: KEY_ID,
        createdByUserId: ALICE,
      });
    }
  });

  it('refuses an API key without the assess scope with 403, storing nothing', async () => {
    withKey(['reports']);

    const res = await post({ judges: TWO, drafts: drafts(DRAFT_A, DRAFT_B) }, KEY_HEADERS);

    expect(res.status).toBe(403);
    expect(fake.assessments).toEqual([]);
  });

  it.each([
    ['one draft', [DRAFT_A]],
    ['six drafts', [DRAFT_A, DRAFT_B, DRAFT_C, DRAFT_D, DRAFT_E, DRAFT_A]],
  ])('refuses %s with 400, storing nothing', async (_label, texts) => {
    const res = await post({ judges: TWO, drafts: texts.map((text) => ({ text })) });

    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('VALIDATION_ERROR');
    expect(fake.assessments).toEqual([]);
    expect(fake.sets).toEqual([]);
  });

  it('refuses the whole set for one draft’s text, storing nothing', async () => {
    const res = await post({ judges: TWO, drafts: [{ text: DRAFT_A }, { text: '   ' }] });

    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatchObject({
      code: 'CONTENT_EMPTY',
      details: { position: 1 },
    });
    expect(fake.assessments).toEqual([]);
    expect(fake.sets).toEqual([]);
  });

  it('refuses context the version does not have once, for every draft', async () => {
    const res = await post({
      judges: TWO,
      drafts: drafts(DRAFT_A, DRAFT_B),
      context: { contentType: 'no_such_type' },
    });

    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('CONTEXT_INVALID');
    expect(fake.assessments).toEqual([]);
  });

  it('reviews every draft in the project, with its defaults, and records it on the set', async () => {
    const row = {
      id: 'project-1',
      orgId: WS_A,
      name: 'Spring launch',
      archivedAt: null,
      framework: { slug: 'howdoesthisland' },
      overlay: null,
      defaults: { context: { contentType: 'landing_page' } },
    };
    mocks.projects.push(row);
    fake.projects.push(row);

    const created = await compare({ drafts: drafts(DRAFT_A, DRAFT_B), projectId: 'project-1' });

    expect(created).toMatchObject({
      projectId: 'project-1',
      project: { id: 'project-1', name: 'Spring launch' },
    });
    for (const review of fake.assessments) {
      expect(review).toMatchObject({
        projectId: 'project-1',
        context: expect.objectContaining({ contentType: 'landing_page' }),
      });
    }
    expect(fake.contents.map((c) => c.projectId)).toEqual(['project-1', 'project-1']);
  });
});

describe('POST /api/v1/comparisons — the budget, for every draft together', () => {
  /**
   * A $10 budget with `spent` used, and three completed full reviews at $1
   * each over the 9 judges `full` resolves to: an estimate of $1.00 a draft.
   * (A `custom` judge list has no profile history to estimate from.)
   */
  function budget(spent: number) {
    mocks.loadOrgQuotas.mockResolvedValue({ monthlyBudgetUsd: 10 });
    mocks.monthSpend.mockResolvedValue({ _sum: { totalCostUsd: spent } });
    const judges = Array.from({ length: 9 }, (_, i) => `judge_${i}`);
    for (let i = 0; i < 3; i += 1) fake.seed({ status: 'COMPLETED', costUsd: 1, judges });
  }

  it('refuses the whole set with 402 when the workspace can cover two of its three drafts', async () => {
    budget(7.5);
    const before = fake.assessments.length;
    const check = vi.spyOn(aiAssessmentLimiter, 'check');

    const res = await post({ profile: 'full', drafts: drafts(DRAFT_A, DRAFT_B, DRAFT_C) });

    const body = await json(res);
    expect(res.status).toBe(402);
    expect(body.error).toMatchObject({
      code: 'BUDGET_EXCEEDED',
      details: { estimateUsd: 3, remainingUsd: 2.5 },
    });
    expect(body.error?.message).toMatch(/^This comparison would cost about/);
    expect(fake.assessments).toHaveLength(before);
    expect(fake.sets).toEqual([]);
    expect(fake.holds).toEqual([]);
    expect(mocks.runJudge).not.toHaveBeenCalled();
    // Refused before any draft was counted against the per-user cap.
    expect(check).not.toHaveBeenCalled();
    check.mockRestore();
  });

  it('counts none of its drafts against the per-user cap when the locked hold refuses a set the first check passed', async () => {
    // Room for all three when the request is prepared; another request has
    // spent the remainder by the time this one holds.
    budget(6.5);
    // Just before the locked check, another request's two reviews are held.
    fake.db.budgetHold.deleteMany.mockImplementationOnce(async () => {
      for (let i = 0; i < 2; i += 1) {
        fake.holds.push({
          id: `rival-${i}`,
          orgId: WS_A,
          judges: 9,
          stored: true,
          createdAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 60_000),
        });
      }
      return { count: 0 };
    });
    const before = aiAssessmentLimiter.peek(`user:${ALICE}`).remaining;

    const res = await post({ profile: 'full', drafts: drafts(DRAFT_A, DRAFT_B, DRAFT_C) });

    expect(res.status).toBe(402);
    expect((await json(res)).error?.code).toBe('BUDGET_EXCEEDED');
    expect(fake.sets).toEqual([]);
    // Only the rival's holds: this request holds none.
    expect(fake.holds.map((h) => h.id)).toEqual(['rival-0', 'rival-1']);
    expect(aiAssessmentLimiter.peek(`user:${ALICE}`).remaining).toBe(before);
  });

  it('refuses with 429 a set the cap has no room for before holding any budget', async () => {
    // The cap is 6: five used leave room for one of two drafts.
    budget(0);
    for (let i = 0; i < 5; i += 1) aiAssessmentLimiter.check(`user:${ALICE}`);

    const res = await post({ profile: 'full', drafts: drafts(DRAFT_A, DRAFT_B) });

    expect(res.status).toBe(429);
    expect(fake.db.budgetHold.create).not.toHaveBeenCalled();
    expect(aiAssessmentLimiter.peek(`user:${ALICE}`).remaining).toBe(1);
    expect(fake.sets).toEqual([]);
  });

  it('refuses with 429 a set whose room another request took while it waited on the budget lock', async () => {
    // The cap is 6. While this request waits for the lock, another counts five.
    budget(0);
    fake.db.budgetHold.deleteMany.mockImplementationOnce(async () => {
      for (let i = 0; i < 5; i += 1) aiAssessmentLimiter.check(`user:${ALICE}`);
      return { count: 0 };
    });

    const res = await post({ profile: 'full', drafts: drafts(DRAFT_A, DRAFT_B) });

    expect(res.status).toBe(429);
    expect((await json(res)).error?.code).toBe('RATE_LIMIT_EXCEEDED');
    // None of this set counted, and its holds are released.
    expect(aiAssessmentLimiter.peek(`user:${ALICE}`).remaining).toBe(1);
    expect(fake.holds).toEqual([]);
    expect(fake.sets).toEqual([]);
  });

  it('starts the set when every draft fits, and releases its holds once they are stored', async () => {
    budget(6.5);

    await compare({
      judges: undefined,
      profile: 'full',
      drafts: drafts(DRAFT_A, DRAFT_B, DRAFT_C),
    });

    expect(fake.sets).toHaveLength(1);
    expect(fake.holds).toEqual([]);
  });
});

describe('the editor’s verdict (t-88)', () => {
  it('is asked for once every draft has ended, and read back with the comparison and in the list', async () => {
    const { id, verdict } = await compare({ drafts: drafts(DRAFT_A, DRAFT_B, DRAFT_C) });
    expect(verdict).toMatchObject({ status: 'waiting', draft: null });
    await settle();

    expect(mocks.callAgent).toHaveBeenCalledTimes(1);
    expect(mocks.callAgent.mock.calls[0][0]).toMatchObject({
      costMetadata: { editor: 'verdict', comparisonId: id },
    });
    const done = await readBack(id);
    expect(done.verdict).toEqual({
      status: 'completed',
      draft: 1,
      why: VERDICT_REPLY.why,
      appeals: VERDICT_REPLY.appeals,
      reason: null,
      model: 'gpt-5',
      costUsd: 0.004,
      completedAt: expect.any(String),
    });
    const listed = comparisonSummarySchema.parse(
      ((await json(await getList())).data as unknown as unknown[])[0]
    );
    expect(listed.verdict).toEqual({ status: 'completed', draft: 1 });
    // Charged once, under its own reference.
    expect(fake.credits.filter((c) => c.reference === `comparison-verdict:${id}`)).toHaveLength(1);
  });

  it('has none, saying why, when fewer than two drafts completed', async () => {
    const { id } = await compare({ drafts: drafts(DRAFT_A, UNSCORABLE) });
    await settle();

    expect(mocks.callAgent).not.toHaveBeenCalled();
    expect((await readBack(id)).verdict).toMatchObject({
      status: 'skipped',
      draft: null,
      reason: 'too_few_completed',
    });
  });

  it('has none, and holds nothing for one, when the drafts call too few AI reviewers for the editor', async () => {
    const { id, verdict } = await compare({
      judges: ['judge_ethos'],
      drafts: drafts(DRAFT_A, DRAFT_B),
    });
    expect(verdict).toMatchObject({ status: 'skipped', reason: 'too_few_judges' });
    await settle();
    expect(mocks.callAgent).not.toHaveBeenCalled();
    expect(mocks.streamCeilingUsd).not.toHaveBeenCalled();
    expect(fake.sets[0]).toMatchObject({ verdictHeldUsd: 0 });
    expect((await readBack(id)).verdict.status).toBe('skipped');
  });

  describe('its estimate, held with the drafts’', () => {
    /** As the drafts' budget tests: a $10 cap with `spent` used, and $1 a draft. */
    function budget(spent: number) {
      mocks.loadOrgQuotas.mockResolvedValue({ monthlyBudgetUsd: 10 });
      mocks.monthSpend.mockResolvedValue({ _sum: { totalCostUsd: spent } });
      const judges = Array.from({ length: 9 }, (_, i) => `judge_${i}`);
      for (let i = 0; i < 3; i += 1) fake.seed({ status: 'COMPLETED', costUsd: 1, judges });
    }

    it('refuses the whole set with 402 when the drafts fit but the verdict beside them does not', async () => {
      budget(7.5);
      // No verdict yet in this workspace: what this one can cost at most.
      mocks.streamCeilingUsd.mockResolvedValue(0.6);

      const res = await post({ profile: 'full', drafts: drafts(DRAFT_A, DRAFT_B) });

      const body = await json(res);
      expect(res.status).toBe(402);
      expect(body.error).toMatchObject({
        code: 'BUDGET_EXCEEDED',
        details: { estimateUsd: 2.6, remainingUsd: 2.5 },
      });
      expect(fake.sets).toEqual([]);
      expect(fake.holds).toEqual([]);
    });

    it('keeps the verdict’s estimate on the comparison once stored, held until the verdict ends', async () => {
      budget(7);
      mocks.streamCeilingUsd.mockResolvedValue(0.6);
      let heldWhileWaiting: unknown;
      // The first draft's judge: the set is stored, its verdict still to come.
      mocks.runJudge.mockImplementationOnce(async (slot: string) => {
        heldWhileWaiting = await fake.db.assessmentSet.aggregate({
          where: { orgId: WS_A, verdictStatus: { in: ['WAITING', 'RUNNING'] } },
        });
        return reply(slot);
      });

      const created = await compare({
        judges: undefined,
        profile: 'full',
        drafts: drafts(DRAFT_A, DRAFT_B),
      });

      expect(created.verdict.status).toBe('waiting');
      expect(fake.sets[0]).toMatchObject({ verdictHeldUsd: 0.6 });
      // The request's own holds are released; the comparison holds the verdict's part.
      expect(fake.holds).toEqual([]);
      await settle();
      expect(heldWhileWaiting).toMatchObject({ _sum: { verdictHeldUsd: 0.6 } });
      // Stored with its set, the request's hold stopped carrying the verdict's part.
      expect(fake.db.budgetHold.updateMany).toHaveBeenCalledWith({
        where: { id: expect.any(String) },
        data: { extraUsd: 0 },
      });
      // Ended: no longer held.
      expect(fake.sets[0]?.verdictStatus).toBe('COMPLETED');
    });
  });
});

describe('POST /api/v1/comparisons — more drafts than running places', () => {
  it('starts as many as the workspace has places for; the rest wait, and all five end final', async () => {
    expect(RUNNING_PER_WORKSPACE).toBe(3);
    let running = 0;
    let most = 0;
    mocks.runJudge.mockImplementation(async (slot: string) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return reply(slot);
    });

    const { id, drafts: started } = await compare({
      drafts: drafts(DRAFT_A, DRAFT_B, DRAFT_C, DRAFT_D, DRAFT_E),
    });
    expect(started).toHaveLength(5);
    // Two of them could not take a place, and wait queued.
    await new Promise((r) => setTimeout(r, 1));
    expect(fake.assessments.filter((a) => a.status === 'QUEUED')).toHaveLength(2);

    await settle();

    const done = await readBack(id);
    expect(done.status).toBe('completed');
    expect(done.drafts.map((d) => d.status)).toEqual(Array(5).fill('completed'));
    // Each review runs its two judges at once; never more than three reviews at once.
    expect(most).toBeLessThanOrEqual(RUNNING_PER_WORKSPACE * TWO.length);
    expect(fake.places).toEqual([]);
  });
});

describe('a comparison with drafts that failed, scored partly, or were purged', () => {
  it('shows a failed and a partial draft as such, comparing the drafts that were scored', async () => {
    mocks.runJudge.mockImplementation(async (slot: string, req: { text?: string }) => {
      // DRAFT_B's ethos judge fails: that review is partial.
      if (slot === 'judge_ethos' && JSON.stringify(req).includes('See how in a demo')) {
        throw new JudgeRunError('provider_error', 'The provider failed.');
      }
      return reply(slot);
    });

    const { id } = await compare({ drafts: drafts(DRAFT_A, DRAFT_B, UNSCORABLE) });
    await settle();

    const done = await readBack(id);
    expect(done.status).toBe('partial');
    expect(done.drafts.map((d) => d.status)).toEqual(['completed', 'partial', 'failed']);
    expect(done.drafts[2]).toMatchObject({ overall: null, appeals: null });
    expect(done.appeals[0]).toEqual({
      appeal: 'ethos',
      leaders: [1],
      drafts: [
        { position: 0, score: 60, delta: -12 },
        { position: 1, score: 72, delta: 0 },
        { position: 2, score: null, delta: null },
      ],
    });
  });

  it('reads as failed, not as an error, when fewer than two drafts were scored', async () => {
    const { id } = await compare({ drafts: drafts(DRAFT_A, UNSCORABLE) });
    await settle();

    const done = await readBack(id);
    expect(done.status).toBe('failed');
    expect(done.appeals).toEqual([]);
  });

  it('reads a draft whose review was deleted as purged, keeping its place, without failing the set', async () => {
    const { id, drafts: started } = await compare({ drafts: drafts(DRAFT_A, DRAFT_B, DRAFT_C) });
    await settle();
    const gone = String(started[1].assessmentId);

    expect((await delReview(gone)).status).toBe(200);

    const done = await readBack(id);
    expect(done.status).toBe('partial');
    expect(done.drafts[1]).toEqual({
      position: 1,
      label: 'Draft 2',
      assessmentId: null,
      status: 'purged',
      overall: null,
      band: null,
      appeals: null,
    });
    expect(done.appeals.map((a) => a.leaders)).toEqual([[0], [2], [0], [2]]);
    expect(done.appeals[0].drafts[1]).toEqual({ position: 1, score: null, delta: null });
    // The list reads it the same way.
    const listed = comparisonSummarySchema.parse(
      ((await json(await getList())).data as unknown as unknown[])[0]
    );
    expect(listed.drafts.map((d) => d.status)).toEqual(['completed', 'purged', 'completed']);
  });

  it('reads every draft as purged once all their reviews are gone, as failed', async () => {
    const { id, drafts: started } = await compare({ drafts: drafts(DRAFT_A, DRAFT_B) });
    await settle();
    for (const d of started) await delReview(String(d.assessmentId));

    const done = await readBack(id);
    expect(done).toMatchObject({ status: 'failed', appeals: [] });
    expect(done.drafts.map((d) => d.status)).toEqual(['purged', 'purged']);
  });
});

describe('POST /api/v1/comparisons — a draft that is a review the workspace has (t-84)', () => {
  /** A finished review of `text` in this workspace, reviewed as `body` says. */
  async function existingReview(text: string, body: Record<string, unknown> = {}) {
    const { drafts: made } = await compare({ drafts: drafts(text, DRAFT_E), ...body });
    await settle();
    vi.clearAllMocks();
    mocks.runJudge.mockImplementation(async (slot: string) => reply(slot));
    mocks.callAgent.mockImplementation(editorCall);
    aiAssessmentLimiter.reset(`user:${ALICE}`);
    return String(made[0].assessmentId);
  }

  it('joins the set as it is: only the drafts given as text are reviewed and counted', async () => {
    const original = await existingReview(DRAFT_A);
    const reviewsBefore = fake.assessments.length;

    const created = await compare({
      drafts: [
        { assessmentId: original, label: 'Original' },
        { text: DRAFT_B, label: 'Rewrite' },
      ],
    });

    expect(created.drafts.map((d) => [d.position, d.label])).toEqual([
      [0, 'Original'],
      [1, 'Rewrite'],
    ]);
    expect(created.drafts[0]).toMatchObject({ assessmentId: original, status: 'completed' });
    // One new review, of the rewrite; the original is not run again.
    expect(fake.assessments).toHaveLength(reviewsBefore + 1);
    expect(fake.contents.at(-1)).toMatchObject({ text: DRAFT_B, title: 'Rewrite' });
    expect(aiAssessmentLimiter.peek(`user:${ALICE}`).remaining).toBe(5);
    await settle();
    expect(mocks.runJudge).toHaveBeenCalledTimes(TWO.length);
    for (const call of mocks.runJudge.mock.calls) {
      expect(JSON.stringify(call[1])).not.toContain(DRAFT_A);
    }

    // Read back as any comparison, the verdict weighing both.
    const done = await readBack(created.id);
    expect(done.status).toBe('completed');
    expect(done.drafts.map((d) => [d.status, d.overall])).toEqual([
      ['completed', 55],
      ['completed', 56],
    ]);
    expect(done.verdict).toMatchObject({ status: 'completed', draft: 1 });
    // The review keeps its own row and place in the history: the set only points at it.
    expect(fake.assessments.filter((a) => a.id === original)).toHaveLength(1);
  });

  it('writes a draft and its original in a transaction sized for a comparison, not one review', async () => {
    const original = await existingReview(DRAFT_A);

    await compare({ drafts: [{ assessmentId: original }, { text: DRAFT_B }] });

    expect(fake.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 15_000,
    });
  });

  it('refuses a review reviewed another way with 409, saying what differs, storing nothing', async () => {
    const original = await existingReview(DRAFT_A, { context: { contentType: 'landing_page' } });
    const sets = fake.sets.length;
    const reviews = fake.assessments.length;

    const res = await post({
      judges: ['judge_ethos'],
      drafts: [{ text: DRAFT_B }, { assessmentId: original }],
    });

    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatchObject({
      code: 'REVIEW_NOT_COMPARABLE',
      details: { position: 1, reason: 'options_differ', differs: ['judges', 'context'] },
    });
    expect(fake.sets).toHaveLength(sets);
    expect(fake.assessments).toHaveLength(reviews);
    expect(aiAssessmentLimiter.peek(`user:${ALICE}`).remaining).toBe(6);
  });

  it('refuses with 409 a review that ended without a score', async () => {
    const failed = await existingReview(UNSCORABLE);

    const res = await post({ judges: TWO, drafts: [{ assessmentId: failed }, { text: DRAFT_B }] });

    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatchObject({
      code: 'REVIEW_NOT_COMPARABLE',
      details: { position: 0, reason: 'not_scored' },
    });
  });

  it('refuses with 409 a review only partly scored, which the verdict would not weigh', async () => {
    const original = await existingReview(DRAFT_A);
    const row = fake.assessments.find((a) => a.id === original);
    if (row) row.status = 'PARTIAL';
    const sets = fake.sets.length;

    const res = await post({
      judges: TWO,
      drafts: [{ assessmentId: original }, { text: DRAFT_B }],
    });

    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatchObject({
      code: 'REVIEW_NOT_COMPARABLE',
      details: { position: 0, reason: 'partly_scored' },
    });
    expect(fake.sets).toHaveLength(sets);
  });

  describe('a review that changes after it was checked, before the set is written', () => {
    /** Run `change` on the review right after the first check reads it. */
    function afterCheck(change: (row: Record<string, unknown>) => void) {
      const { findMany } = fake.db.assessment;
      const read = findMany.getMockImplementation();
      findMany.mockImplementationOnce(async (args: Parameters<typeof findMany>[0]) => {
        const rows = (await read?.(args)) ?? [];
        for (const row of fake.assessments) change(row);
        return rows;
      });
    }

    it('is refused with 404 when deleted, storing nothing and holding nothing', async () => {
      const original = await existingReview(DRAFT_A);
      const sets = fake.sets.length;
      afterCheck(() => {
        const at = fake.assessments.findIndex((a) => a.id === original);
        if (at >= 0) fake.assessments.splice(at, 1);
      });

      const res = await post({
        judges: TWO,
        drafts: [{ text: DRAFT_B }, { assessmentId: original }],
      });

      expect(res.status).toBe(404);
      expect((await json(res)).error).toMatchObject({
        code: 'ASSESSMENT_NOT_FOUND',
        details: { position: 1 },
      });
      // Refused in the transaction, which rolls the new review back (the fake
      // keeps no rollback, so this reads what it can): no set, no run, no hold.
      expect(fake.sets).toHaveLength(sets);
      expect(fake.holds).toHaveLength(0);
      await settle();
      expect(mocks.runJudge).not.toHaveBeenCalled();
    });

    it('is refused with 409 when it ended without a score', async () => {
      const original = await existingReview(DRAFT_A);
      const sets = fake.sets.length;
      afterCheck((row) => {
        if (row.id === original) row.status = 'CANCELLED';
      });

      const res = await post({
        judges: TWO,
        drafts: [{ assessmentId: original }, { text: DRAFT_B }],
      });

      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatchObject({
        code: 'REVIEW_NOT_COMPARABLE',
        details: { position: 0, reason: 'not_scored' },
      });
      expect(fake.sets).toHaveLength(sets);
    });
  });

  it('refuses with 404 a review in another workspace, or none', async () => {
    signedIn(BOB, WS_B);
    const theirs = await existingReview(DRAFT_A);
    signedIn(ALICE, WS_A);

    for (const assessmentId of [theirs, 'no-such-review']) {
      const res = await post({ judges: TWO, drafts: [{ text: DRAFT_B }, { assessmentId }] });
      expect(res.status).toBe(404);
      expect((await json(res)).error).toMatchObject({
        code: 'ASSESSMENT_NOT_FOUND',
        details: { position: 1 },
      });
    }
    expect(fake.sets.filter((s) => s.orgId === WS_A)).toHaveLength(0);
  });

  it('refuses with 400 a set with no draft as text, or naming one review twice', async () => {
    const original = await existingReview(DRAFT_A);
    const other = String(fake.assessments[1].id);

    for (const set of [
      [{ assessmentId: original }, { assessmentId: other }],
      [{ assessmentId: original }, { assessmentId: original }, { text: DRAFT_B }],
    ]) {
      const res = await post({ judges: TWO, drafts: set });
      expect(res.status).toBe(400);
      expect((await json(res)).error?.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('POST /api/v1/comparisons — the per-user cap', () => {
  it('counts each draft as a review, and counts none of a set it refuses', async () => {
    // The cap is 6 here: five drafts leave room for one.
    await compare({ drafts: drafts(DRAFT_A, DRAFT_B, DRAFT_C, DRAFT_D, DRAFT_E) });
    expect(aiAssessmentLimiter.peek(`user:${ALICE}`).remaining).toBe(1);

    const res = await post({ judges: TWO, drafts: drafts(DRAFT_A, DRAFT_B) });

    expect(res.status).toBe(429);
    expect((await json(res)).error?.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(aiAssessmentLimiter.peek(`user:${ALICE}`).remaining).toBe(1);
    expect(fake.sets).toHaveLength(1);
  });

  it('counts nothing for drafts that call no AI reviewer', async () => {
    await compare({ drafts: drafts(DRAFT_A, DRAFT_B), judges: undefined, profile: 'quick' });

    expect(aiAssessmentLimiter.peek(`user:${ALICE}`).remaining).toBe(6);
  });
});

describe('GET and DELETE', () => {
  it('lists the workspace’s comparisons newest first, filtered by project, and not another’s', async () => {
    const first = await compare({ drafts: drafts(DRAFT_A, DRAFT_B) });
    const second = await compare({ drafts: drafts(DRAFT_C, DRAFT_D) });
    signedIn(BOB, WS_B);
    await compare({ drafts: drafts(DRAFT_A, DRAFT_E) });
    signedIn(ALICE, WS_A);

    const res = await getList();
    const body = await json(res);
    expect(res.status).toBe(200);
    const items = (body.data as unknown as unknown[]).map((i) => comparisonSummarySchema.parse(i));
    expect(items.map((i) => i.id)).toEqual([second.id, first.id]);
    expect(body.meta).toMatchObject({ total: 2 });
    expect(await json(await getList('?projectId=project-x'))).toMatchObject({ data: [] });
  });

  it('answers 404 for another workspace’s comparison, and for none', async () => {
    const { id } = await compare({ drafts: drafts(DRAFT_A, DRAFT_B) });
    signedIn(BOB, WS_B);

    expect((await getOne(id)).status).toBe(404);
    expect((await del(id)).status).toBe(404);
    signedIn(ALICE, WS_A);
    expect((await getOne('no-such-id')).status).toBe(404);
    expect(fake.sets).toHaveLength(1);
  });

  it('deletes the comparison and its drafts’ places, keeping their reviews', async () => {
    const { id } = await compare({ drafts: drafts(DRAFT_A, DRAFT_B) });
    await settle();

    const res = await del(id);

    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ deleted: true });
    expect(fake.sets).toEqual([]);
    expect(fake.setMembers).toEqual([]);
    expect(fake.assessments).toHaveLength(2);
    expect((await getOne(id)).status).toBe(404);
    expect((await del(id)).status).toBe(404);
  });
});

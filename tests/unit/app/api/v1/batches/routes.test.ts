/**
 * Tests: the `batches` routes (t-101).
 *
 * POST/GET /api/v1/batches · GET/DELETE …/{id}
 *
 * Real: the guard, the batch service, the review options as a single review
 * resolves them, the budget check and its holds, enqueue, the job (claim, the
 * workspace's running places, the next queued review started as one ends,
 * and a page fetched by its own run), the batch allowance, the finished-event
 * outbox and its sweep, the verdict recovery, and the retention purge, over
 * the stateful fake (`fake-db.ts`). Replaced, as in the comparisons route
 * test: `runJudge` (scripted), `runEditor` (skipping), the version catalogue,
 * the engine's `assemble()` (a stub scoring each text from `SCORES`),
 * `fetchPage` (each address serves a text `SCORES` knows), and core's durable
 * emit, which records each event.
 *
 * @see app/api/v1/batches/
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
  // Unset unless a test sets it: 10 items.
  APP_BATCH_MAX_ITEMS: undefined as number | undefined,
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
  // The workspace's settings, which the retention purge reads (t-26).
  orgSettings: vi.fn(),
  // Core's durable emit, recording each finished event (t-99).
  emit: vi.fn(),
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
      org: { findUnique: mocks.orgSettings },
      // The purge's reply window, which these tests do not measure.
      judgeReply: { deleteMany: vi.fn(async () => ({ count: 0 })) },
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
vi.mock('@/lib/orchestration/hooks/registry', () => ({ emitHookEventDurably: mocks.emit }));
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

import { POST as create, GET as list } from '@/app/api/v1/batches/route';
import { GET as read, DELETE as remove } from '@/app/api/v1/batches/[id]/route';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import { loadModel } from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';
import { createMockAuthSession } from '@/tests/helpers/auth';
import { aiAssessmentLimiter } from '@/lib/app/assessments/api/limiter';
import { batchItemLimiter } from '@/lib/app/batches/limiter';
import { BATCH_ITEMS_PER_HOUR } from '@/lib/app/batches/limits';
import { resetKicksForTests } from '@/lib/app/assessments/kick';
import { forgetEarlyScansForTests } from '@/lib/app/assessments/early-scan';
import { JudgeRunError } from '@/lib/app/judges/run-judge';
import { IntakeError, IntakeErrorCodes } from '@/lib/app/intake/errors';
import { batchDetailSchema, batchSummarySchema } from '@/lib/app/api/registry';
import { forgetSpendCaps } from '@/lib/orchestration/llm/spend-caps';
import { RUNNING_PER_WORKSPACE } from '@/lib/app/assessments/limits';
import { runAsOrg } from '@/lib/tenancy/context';
import { recoverVerdicts } from '@/lib/app/comparisons/verdict';
import { sweepFinishedEvents } from '@/lib/app/events/notify';
import { purgeExpiredContent } from '@/lib/app/retention/purge';
import { BATCH_FINISHED } from '@/lib/app/events/types';

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

/** A page each address serves, unless a test says otherwise: its text is one `SCORES` knows. */
const PAGES: Record<string, string> = {
  'https://example.com/pricing': DRAFT_D,
  'https://example.com/about': DRAFT_E,
};
function servePages() {
  mocks.fetchPage.mockImplementation(async (url: string) => {
    const text = PAGES[url];
    if (text === undefined) {
      throw new IntakeError(IntakeErrorCodes.FETCH_FAILED, 'The page could not be fetched.');
    }
    // Where its redirects ended, and its own title.
    return { text, title: `Title of ${url}`, url: `${url}/` };
  });
}

function signedIn(userId: string, orgId: string) {
  const base = createMockAuthSession();
  mocks.getSession.mockResolvedValue({
    session: { ...base.session, userId, activeOrgId: orgId },
    user: { ...base.user, id: userId },
  });
}

const BASE = 'http://localhost/api/v1/batches';

function post(body: unknown) {
  return create(
    new NextRequest(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const getList = (query = '') => list(new NextRequest(`${BASE}${query}`));
const getOne = (id: string) => read(new NextRequest(`${BASE}/${id}`), params(id));
const del = (id: string) =>
  remove(new NextRequest(`${BASE}/${id}`, { method: 'DELETE' }), params(id));

interface Envelope {
  success: boolean;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}
const json = async (res: Response) => (await res.json()) as Envelope;

/** POST a batch and answer its parsed body, failing unless it was accepted. */
async function batch(body: Record<string, unknown>) {
  const res = await post({ judges: TWO, ...body });
  const env = await json(res);
  if (res.status !== 202)
    throw new Error(`expected 202, got ${res.status}: ${JSON.stringify(env)}`);
  return batchDetailSchema.parse(env.data);
}
/**
 * Wait until the batch has ended, as a caller polling it would: a fixed pause
 * is too short for five reviews through three places on a loaded machine.
 */
async function untilEnded(id: string, deadlineMs = 5_000) {
  const until = Date.now() + deadlineMs;
  for (;;) {
    const res = await getOne(id);
    const body = batchDetailSchema.parse((await json(res)).data);
    if (body.status !== 'running' || Date.now() > until) return body;
    await new Promise((r) => setTimeout(r, 20));
  }
}
/** GET a batch, parsed as the registry declares it. */
async function readBack(id: string) {
  const res = await getOne(id);
  expect(res.status).toBe(200);
  return batchDetailSchema.parse((await json(res)).data);
}
const texts = (...items: string[]) => items.map((text, i) => ({ text, label: `Item ${i + 1}` }));
/** The batch events core was asked to send. */
const batchEvents = () =>
  mocks.emit.mock.calls.filter(([type]) => type === BATCH_FINISHED).map(([, data]) => data);

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeDb();
  mockEnv.APP_BATCH_MAX_ITEMS = undefined;
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
  mocks.loadOrgQuotas.mockResolvedValue({});
  mocks.monthSpend.mockResolvedValue({ _sum: { totalCostUsd: 0 } });
  mocks.costRows.mockResolvedValue([]);
  mocks.orgSettings.mockResolvedValue(null);
  mocks.emit.mockResolvedValue(undefined);
  mocks.projects.length = 0;
  servePages();
  forgetSpendCaps();
  aiAssessmentLimiter.reset(`user:${ALICE}`);
  batchItemLimiter.reset(`user:${ALICE}`);
  resetKicksForTests();
  forgetEarlyScansForTests();
  signedIn(ALICE, WS_A);
  fake.grant(WS_A, 1_000_000);
  fake.grant(WS_B, 1_000_000);
});
afterEach(async () => {
  await settle();
});

// ---------------------------------------------------------------------------

describe('POST /api/v1/batches', () => {
  it('stores every item as an ordinary review, the same way, in a batch born with its verdict settled', async () => {
    const created = await batch({
      items: [...texts(DRAFT_A), { url: 'https://example.com/pricing', label: 'Pricing' }],
      context: { contentType: 'landing_page' },
    });

    expect(created).toMatchObject({
      kind: 'batch',
      framework: { slug: 'howdoesthisland', version: '0.5.1' },
      profile: 'custom',
      judges: TWO,
      total: 2,
    });
    expect(created.items.map((i) => [i.position, i.label, i.source?.kind])).toEqual([
      [0, 'Item 1', 'text'],
      [1, 'Pricing', 'url'],
    ]);
    expect(fake.assessments).toHaveLength(2);
    const [first, second] = fake.assessments;
    for (const field of ['frameworkVersionId', 'context', 'judges', 'projectId', 'profile']) {
      expect(second[field]).toEqual(first[field]);
    }
    expect(fake.sets).toEqual([
      expect.objectContaining({
        orgId: WS_A,
        kind: 'BATCH',
        verdictStatus: 'SKIPPED',
        verdictReason: 'not_asked',
        verdictHeldUsd: 0,
        createdByUserId: ALICE,
      }),
    ]);
    // The page was stored with its address and no text.
    const page = fake.contents.find((c) => c.sourceKind === 'URL');
    expect(page).toMatchObject({ sourceUrl: 'https://example.com/pricing', title: 'Pricing' });
  });

  it('answers at once without fetching a page: each is fetched by its own review, once that review is claimed', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // At each fetch, the review its page belongs to, as the fetch found it.
    const seen: Record<string, unknown>[] = [];
    mocks.fetchPage.mockImplementation(async (url: string) => {
      const content = fake.contents.find((c) => c.sourceUrl === url);
      const review = fake.assessments.find((a) => a.contentId === content?.id);
      seen.push({
        url,
        status: review?.status,
        leased: Boolean(review?.leaseToken),
        text: content?.text,
      });
      await gate;
      return { text: PAGES[url], title: null, url };
    });

    const created = await batch({
      items: [{ url: 'https://example.com/pricing' }, { url: 'https://example.com/about' }],
    });

    // Answered while every fetch is still waiting: none finished in the request.
    expect(created.items.map((i) => i.status)).not.toContain('completed');
    expect(fake.contents.every((c) => c.text === null)).toBe(true);
    release();
    await settle();

    expect(seen).toHaveLength(2);
    for (const fetch of seen) {
      expect(fetch).toMatchObject({ status: 'RUNNING', leased: true, text: null });
    }
    const done = await readBack(created.id);
    expect(done.status).toBe('completed');
    expect(fake.contents.map((c) => c.text)).toEqual([DRAFT_D, DRAFT_E]);
  });

  it('titles an unlabelled page by the page once fetched, and records where its redirects ended', async () => {
    const { id } = await batch({ items: [{ url: 'https://example.com/pricing' }] });
    await settle();

    const [content] = fake.contents;
    expect(content).toMatchObject({
      title: 'Title of https://example.com/pricing',
      sourceUrl: 'https://example.com/pricing/',
      text: DRAFT_D,
      wordCount: expect.any(Number),
      textSha256: expect.any(String),
    });
    expect((await readBack(id)).items[0].source).toEqual({
      kind: 'url',
      url: 'https://example.com/pricing/',
    });
  });

  it('fails only the item whose page failed to load, was too long, or whose judge failed; the rest complete', async () => {
    mocks.fetchPage.mockImplementation(async (url: string) => {
      if (url.endsWith('/long')) {
        throw new IntakeError(IntakeErrorCodes.TEXT_TOO_LONG, 'The page is too long.');
      }
      if (url.endsWith('/gone')) {
        throw new IntakeError(IntakeErrorCodes.FETCH_FAILED, 'The page could not be fetched.');
      }
      return { text: PAGES[url], title: null, url };
    });
    mocks.runJudge.mockImplementation(async (slot: string, req: unknown) => {
      // DRAFT_B's ethos judge fails: that review is partial.
      if (slot === 'judge_ethos' && JSON.stringify(req).includes('See how in a demo')) {
        throw new JudgeRunError('provider_error', 'The provider failed.');
      }
      return reply(slot);
    });

    const { id } = await batch({
      items: [
        ...texts(DRAFT_A),
        { url: 'https://example.com/gone' },
        { url: 'https://example.com/long' },
        ...texts(DRAFT_B),
        { url: 'https://example.com/pricing' },
      ],
    });

    const done = await untilEnded(id);
    expect(done.items.map((i) => [i.status, i.errorCode])).toEqual([
      ['completed', null],
      ['failed', 'FETCH_FAILED'],
      ['failed', 'TEXT_TOO_LONG'],
      ['partial', null],
      ['completed', null],
    ]);
    expect(done.status).toBe('partial');
    expect(done.counts).toMatchObject({ completed: 2, partial: 1, failed: 2, purged: 0 });
    // A page that could not be read called no judge, kept no text, and never started.
    const gone = fake.assessments.find((a) => a.id === done.items[1].assessmentId);
    expect(gone).toMatchObject({ status: 'FAILED', startedAt: null, costUsd: 0 });
    expect(fake.contents.filter((c) => c.text === null)).toHaveLength(2);
  });

  it('refuses the whole batch for one pasted text, naming it, storing nothing', async () => {
    const res = await post({ judges: TWO, items: [...texts(DRAFT_A), { text: '   ' }] });

    const body = await json(res);
    expect(res.status).toBe(400);
    expect(body.error).toMatchObject({ code: 'CONTENT_EMPTY', details: { position: 1 } });
    expect(fake.assessments).toEqual([]);
    expect(fake.sets).toEqual([]);
  });

  it('refuses an item that is not text or an http(s) page', async () => {
    for (const item of [
      { url: 'ftp://example.com/x' },
      { text: DRAFT_A, url: 'https://example.com/pricing' },
      {},
    ]) {
      const res = await post({ judges: TWO, items: [item] });
      expect(res.status).toBe(400);
    }
    expect(fake.sets).toEqual([]);
  });
});

describe('POST /api/v1/batches — how many items (APP_BATCH_MAX_ITEMS)', () => {
  const many = (n: number) => Array.from({ length: n }, () => ({ text: DRAFT_A }));

  it('refuses an empty batch', async () => {
    const res = await post({ judges: TWO, items: [] });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('VALIDATION_ERROR');
  });

  it('takes 10 items when the setting is unset, and refuses 11, storing nothing', async () => {
    const res = await post({ profile: 'quick', items: many(11) });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('at most 10 items');
    expect(fake.assessments).toEqual([]);

    expect((await batch({ judges: undefined, profile: 'quick', items: many(10) })).total).toBe(10);
  });

  it('reads the setting from the environment on each request', async () => {
    mockEnv.APP_BATCH_MAX_ITEMS = 3;
    expect((await post({ profile: 'quick', items: many(4) })).status).toBe(400);

    mockEnv.APP_BATCH_MAX_ITEMS = 100;
    expect((await batch({ judges: undefined, profile: 'quick', items: many(40) })).total).toBe(40);
  });

  it('refuses more than 100 whatever the setting says', async () => {
    mockEnv.APP_BATCH_MAX_ITEMS = 500;
    expect((await post({ profile: 'quick', items: many(101) })).status).toBe(400);
  });
});

describe('POST /api/v1/batches — the budget, for every item together', () => {
  /** A $10 budget with `spent` used, and an estimate of $1.00 an item (as the comparison test). */
  function budget(spent: number) {
    mocks.loadOrgQuotas.mockResolvedValue({ monthlyBudgetUsd: 10 });
    mocks.monthSpend.mockResolvedValue({ _sum: { totalCostUsd: spent } });
    const judges = Array.from({ length: 9 }, (_, i) => `judge_${i}`);
    for (let i = 0; i < 3; i += 1) fake.seed({ status: 'COMPLETED', costUsd: 1, judges });
  }

  it('refuses the whole batch with 402 when the workspace can cover two of its three items, storing nothing', async () => {
    budget(7.5);
    const before = fake.assessments.length;

    const res = await post({
      profile: 'full',
      items: [...texts(DRAFT_A, DRAFT_B), { url: 'https://example.com/pricing' }],
    });

    const body = await json(res);
    expect(res.status).toBe(402);
    expect(body.error).toMatchObject({
      code: 'BUDGET_EXCEEDED',
      details: { estimateUsd: 3, remainingUsd: 2.5 },
    });
    expect(fake.assessments).toHaveLength(before);
    expect(fake.contents).toHaveLength(before);
    expect(fake.sets).toEqual([]);
    expect(fake.holds).toEqual([]);
    expect(mocks.fetchPage).not.toHaveBeenCalled();
    expect(batchItemLimiter.peek(`user:${ALICE}`).remaining).toBe(BATCH_ITEMS_PER_HOUR);
  });

  it('stores the batch when every item fits, and releases its holds once they are stored', async () => {
    budget(6.5);

    await batch({ judges: undefined, profile: 'full', items: texts(DRAFT_A, DRAFT_B, DRAFT_C) });

    expect(fake.sets).toHaveLength(1);
    expect(fake.holds).toEqual([]);
  });
});

describe('POST /api/v1/batches — the per-user allowance', () => {
  it('counts each item against the batch allowance, not the per-minute review cap', async () => {
    await batch({ items: texts(DRAFT_A, DRAFT_B, DRAFT_C) });

    expect(batchItemLimiter.peek(`user:${ALICE}`).remaining).toBe(BATCH_ITEMS_PER_HOUR - 3);
    expect(aiAssessmentLimiter.peek(`user:${ALICE}`).remaining).toBe(6);
  });

  it('refuses with 429 a batch the allowance has no room for, counting none of it', async () => {
    for (let i = 0; i < BATCH_ITEMS_PER_HOUR - 2; i += 1) batchItemLimiter.check(`user:${ALICE}`);

    const res = await post({ judges: TWO, items: texts(DRAFT_A, DRAFT_B, DRAFT_C) });

    expect(res.status).toBe(429);
    expect(batchItemLimiter.peek(`user:${ALICE}`).remaining).toBe(2);
    expect(fake.sets).toEqual([]);
    expect(fake.holds).toEqual([]);
  });

  it('counts items that call no AI reviewer too: each is still a queued run, and a page a fetch', async () => {
    await batch({
      judges: undefined,
      profile: 'quick',
      items: [...texts(DRAFT_A), { url: 'https://example.com/pricing' }],
    });

    expect(batchItemLimiter.peek(`user:${ALICE}`).remaining).toBe(BATCH_ITEMS_PER_HOUR - 2);
  });

  it('counts none of a batch the write refuses after every check passed', async () => {
    fake.db.assessmentSet.create.mockRejectedValueOnce(new Error('the write failed'));

    const res = await post({ judges: TWO, items: texts(DRAFT_A, DRAFT_B, DRAFT_C) });

    expect(res.status).toBe(500);
    expect(fake.sets).toEqual([]);
    expect(fake.holds).toEqual([]);
    expect(batchItemLimiter.peek(`user:${ALICE}`).remaining).toBe(BATCH_ITEMS_PER_HOUR);
  });
});

describe('POST /api/v1/batches — more items than running places', () => {
  it('starts as many as the workspace has places for; the rest wait, and every item ends final', async () => {
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

    const { id, items } = await batch({
      items: [
        ...texts(DRAFT_A, DRAFT_B, DRAFT_C, DRAFT_D, DRAFT_E, DRAFT_A),
        { url: 'https://example.com/pricing' },
        { url: 'https://example.com/about' },
      ],
    });
    expect(items).toHaveLength(8);
    // Three take the workspace's places; five wait queued.
    await new Promise((r) => setTimeout(r, 1));
    expect(fake.assessments.filter((a) => a.status === 'QUEUED')).toHaveLength(5);

    const done = await untilEnded(id);
    expect(done.status).toBe('completed');
    expect(done.counts.completed).toBe(8);
    expect(most).toBeLessThanOrEqual(RUNNING_PER_WORKSPACE * TWO.length);
    expect(fake.places).toEqual([]);
  });
});

describe('a batch and the verdict machinery', () => {
  it('is never asked for a verdict: it stays settled, and recovery finds nothing due', async () => {
    const { id } = await batch({ items: texts(DRAFT_A, DRAFT_B, DRAFT_C) });
    await settle();

    expect(engine.buildVerdictRequest).not.toHaveBeenCalled();
    expect(mocks.callAgent).not.toHaveBeenCalled();
    expect(fake.sets.find((s) => s.id === id)).toMatchObject({
      verdictStatus: 'SKIPPED',
      verdictReason: 'not_asked',
      verdictAttempts: 0,
      verdictHeldUsd: 0,
    });
    const recovered = await runAsOrg(WS_A, () => recoverVerdicts());
    expect(recovered).toEqual({ started: 0, skipped: 0, gaveUp: 0 });
  });
});

describe('app.batch.finished', () => {
  it('is sent once, when the last item ends, with ids, states and scores', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mocks.runJudge.mockImplementation(async (slot: string, req: unknown) => {
      // DRAFT_C's reviewers wait until the test releases them.
      if (JSON.stringify(req).includes('It does not have to')) await gate;
      return reply(slot);
    });

    const { id } = await batch({ items: texts(DRAFT_A, DRAFT_B, DRAFT_C) });
    await settle();
    // Two of three have ended: their own events, and none for the batch.
    expect(fake.assessments.filter((a) => a.status === 'COMPLETED')).toHaveLength(2);
    expect(batchEvents()).toEqual([]);

    release();
    await settle();

    expect(batchEvents()).toHaveLength(1);
    const [data] = batchEvents();
    expect(data).toMatchObject({
      eventId: `batch:${id}`,
      batchId: id,
      status: 'completed',
      total: 3,
      counts: expect.objectContaining({ completed: 3 }),
    });
    expect(JSON.stringify(data)).not.toContain('Item 1');
    expect(fake.sets.find((s) => s.id === id)?.notifiedAt).toBeInstanceOf(Date);

    // The sweep finds it already sent.
    const swept = await runAsOrg(WS_A, () =>
      sweepFinishedEvents(new Date(Date.now() + 5 * 60_000))
    );
    expect(swept.batches).toBe(0);
    expect(batchEvents()).toHaveLength(1);
  });

  it('is sent by the sweep for a batch whose send was lost', async () => {
    mocks.emit.mockImplementation(async (type: string) => {
      if (type === BATCH_FINISHED) throw new Error('lost');
    });
    const { id } = await batch({ items: texts(DRAFT_A) });
    await settle();
    expect(fake.sets.find((s) => s.id === id)?.notifiedAt ?? null).toBeNull();

    mocks.emit.mockResolvedValue(undefined);
    const swept = await runAsOrg(WS_A, () =>
      sweepFinishedEvents(new Date(Date.now() + 5 * 60_000))
    );

    expect(swept.batches).toBe(1);
    expect(batchEvents().at(-1)).toMatchObject({ batchId: id, status: 'completed' });
  });
});

describe('a batch whose items are purged by retention', () => {
  it('reads a purged item as purged, keeping its place, without failing the batch', async () => {
    const { id } = await batch({ items: texts(DRAFT_A, DRAFT_B, DRAFT_C) });
    await settle();
    const before = await readBack(id);
    // Every item reviewed first, so the purge has something to take.
    expect(before.counts.completed).toBe(3);
    // The second item's review is past a 30-day window; the others are not.
    const aged = fake.assessments.find((a) => a.id === before.items[1].assessmentId);
    if (!aged) throw new Error('no review');
    aged.createdAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const agedContent = fake.contents.find((c) => c.id === aged.contentId);
    if (agedContent) agedContent.createdAt = aged.createdAt;
    mocks.orgSettings.mockResolvedValue({ settings: { app: { retention: { days: 30 } } } });

    const purged = await runAsOrg(WS_A, () => purgeExpiredContent());

    expect(purged).toMatchObject({ assessments: 1, contents: 1, comparisons: 0 });
    const done = await readBack(id);
    expect(done.status).toBe('partial');
    expect(done.counts).toMatchObject({ completed: 2, purged: 1 });
    expect(done.items[1]).toEqual({
      position: 1,
      label: 'Item 2',
      assessmentId: null,
      status: 'purged',
      source: null,
      overall: null,
      band: null,
      errorCode: null,
    });
    expect(done.items[0].assessmentId).toBe(before.items[0].assessmentId);
  });
});

describe('GET and DELETE', () => {
  it('lists the workspace’s batches newest first with their counts, filtered by project, and not another’s', async () => {
    const first = await batch({ items: texts(DRAFT_A) });
    const second = await batch({ items: texts(DRAFT_B, DRAFT_C) });
    signedIn(BOB, WS_B);
    await batch({ items: texts(DRAFT_A) });
    signedIn(ALICE, WS_A);
    await settle();

    const res = await getList();
    const body = await json(res);
    const items = (body.data as unknown as unknown[]).map((i) => batchSummarySchema.parse(i));
    expect(items.map((i) => i.id)).toEqual([second.id, first.id]);
    expect(items[0]).toMatchObject({ total: 2, counts: expect.objectContaining({ completed: 2 }) });
    expect(items[0]).not.toHaveProperty('items');
    expect(body.meta).toMatchObject({ total: 2 });

    const none = await json(await getList('?projectId=project-x'));
    expect(none.data).toEqual([]);
  });

  it('answers 404 for another workspace’s batch, and for a comparison', async () => {
    const { id } = await batch({ items: texts(DRAFT_A) });
    signedIn(BOB, WS_B);
    expect((await getOne(id)).status).toBe(404);
    expect((await del(id)).status).toBe(404);
    signedIn(ALICE, WS_A);
    const set = fake.sets.find((s) => s.id === id);
    if (set) set.kind = 'COMPARISON';
    expect((await getOne(id)).status).toBe(404);
  });

  it('deletes the batch and its items’ places, keeping their reviews', async () => {
    const { id } = await batch({ items: texts(DRAFT_A, DRAFT_B) });
    await settle();

    const res = await del(id);

    expect(res.status).toBe(200);
    expect(fake.sets).toEqual([]);
    expect(fake.assessments).toHaveLength(2);
    expect((await getOne(id)).status).toBe(404);
  });
});

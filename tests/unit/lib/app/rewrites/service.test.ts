/**
 * Tests: rewrites (t-81) — startRewrite, getRewrite and listRewrites, over
 * the assessments' stateful in-memory store.
 *
 * Real: the HowDoesThisLand engine (so the prompt is the real one), the
 * project-context rendering, the event channel, the ending write and the
 * charge. Mocked: Prisma (the fake in `fake-db.ts`), `engineForVersion` (the
 * real engine over the 0.5.1 model), `streamAgent` (scripted, writing the
 * cost rows a call writes) and the budget check, which `budget.test.ts`
 * covers: here it runs `create` in a transaction, as it does once a rewrite
 * fits.
 *
 * @see lib/app/rewrites/service.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, type FakeDb, type Row } from '@/tests/unit/lib/app/assessments/fake-db';

const mocks = vi.hoisted(() => ({
  streamAgent: vi.fn(),
  streamCeilingUsd: vi.fn(),
  engineForVersion: vi.fn(),
  reserve: vi.fn(),
}));

let fake: FakeDb;
vi.mock('@/lib/db/client', () => ({
  get prisma() {
    return fake.db;
  },
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/app/judges/run-judge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/judges/run-judge')>()),
  streamAgent: mocks.streamAgent,
  streamCeilingUsd: mocks.streamCeilingUsd,
}));
vi.mock('@/lib/app/assessments/engine', () => ({ engineForVersion: mocks.engineForVersion }));
vi.mock('@/lib/app/usage/budget', () => ({ reserveRewriteBudget: mocks.reserve }));

import { APIError } from '@/lib/api/errors';
import { LEASE_MS } from '@/lib/app/assessments/limits';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import type { Assessment } from '@/lib/app/frameworks/howdoesthisland/engine/types';
import {
  JudgeRunError,
  type AgentStreamCall,
  type AgentStreamReply,
} from '@/lib/app/judges/run-judge';
import { rewriteMaxTokens } from '@/lib/app/frameworks/howdoesthisland/engine/rewrite';
import { DRAFT_SAVE_MS, REWRITE_CALL_MS } from '@/lib/app/rewrites/limits';
import { logger } from '@/lib/logging';
import {
  getRewrite,
  listRewrites,
  OVERRAN_REWRITE,
  startRewrite,
  type RewriteEvent,
} from '@/lib/app/rewrites/service';
import { runAsOrg } from '@/lib/tenancy/context';
import {
  loadCases,
  loadModel,
} from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

const ORG = 'org-a';
const inOrg = <T>(fn: () => Promise<T>) => runAsOrg(ORG, fn);

const engine = createHowDoesThisLandEngine(loadModel(), { culture: false });
const ev01 = loadCases().find((c) => c.file === 'eval/ev01.json');
if (!ev01) throw new Error('baseline case eval/ev01.json is missing');
const TEXT = ev01.input.text;
const CTX = ev01.input.ctx;
const RESULT: Assessment = engine.assemble(
  TEXT,
  CTX,
  engine.quickScan(TEXT, CTX),
  ev01.judgeOutputs,
  null
);

const BRIEF_NOW = { offer: 'Folding bikes for commuters, built in Leeds.' };
const BRIEF_THEN = { offer: 'Bikes.' };
const PASSAGE = 'Our frames carry a ten-year guarantee.';

/** A finished review of ev01 in a project, with the context its judges read. */
function finishedReview(over: Row = {}): Row {
  const review = fake.seed({
    status: 'COMPLETED',
    result: RESULT,
    context: CTX,
    projectId: 'project-1',
    projectContext: {
      brief: BRIEF_THEN,
      documents: [{ id: 'doc-1', title: 'Guarantee' }],
      passages: [{ documentId: 'doc-1', chunkId: 'chunk-1', text: PASSAGE }],
    },
    ...over,
  });
  const content = fake.contents.find((c) => c.id === review.contentId);
  if (content) content.text = TEXT;
  return review;
}

/** A call that streams `pieces`, writing the cost row a real call writes for it. */
function streams(pieces: string[], costUsd = 0.04) {
  mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
    for (const piece of pieces) await call.onText(piece);
    fake.addCost(ORG, costUsd, { ...call.costMetadata, frameworkVersion: call.frameworkVersion });
    const reply: AgentStreamReply = {
      text: pieces.join(''),
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      usage: { input: 4000, output: 900, attempts: 1 },
      costUsd,
      costLogIds: ['cost-x'],
      finishReason: 'stop',
    };
    return reply;
  });
}

/** The one call `streamAgent` was given. */
function theCall(): AgentStreamCall {
  expect(mocks.streamAgent).toHaveBeenCalledTimes(1);
  return mocks.streamAgent.mock.calls[0][0] as AgentStreamCall;
}

async function collect(events: AsyncIterable<RewriteEvent>): Promise<RewriteEvent[]> {
  const out: RewriteEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

async function refusal(promise: Promise<unknown>): Promise<APIError> {
  const err: unknown = await promise.then(
    () => null,
    (e: unknown) => e
  );
  if (!(err instanceof APIError)) throw new Error(`expected an APIError, got ${String(err)}`);
  return err;
}

const charges = () => fake.credits.filter((c) => c.kind === 'CHARGE');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  fake = createFakeDb();
  // Charging began before every rewrite here.
  fake.grant(ORG, 1_000_000);
  fake.projects.push({ id: 'project-1', orgId: ORG, brief: BRIEF_NOW });
  mocks.engineForVersion.mockResolvedValue({
    version: { id: 'version-1' },
    engine,
    label: 'howdoesthisland@0.5.1',
  });
  mocks.reserve.mockImplementation(
    (_orgId: string, create: (tx: unknown, e: unknown) => Promise<unknown>) =>
      fake.db.$transaction((tx) => create(tx, { estimateUsd: 0.05, basis: 'rewrites' }))
  );
  streams(['A sharper ', 'draft.']);
});

describe('startRewrite on a finished review', () => {
  it('streams the row, each piece, then the row ended, and keeps the draft', async () => {
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: true }, { userId: 'user-1' })
    );
    const events = await collect(started.events);

    expect(events.map((e) => e.type)).toEqual([
      'rewrite',
      'rewrite_text',
      'rewrite_text',
      'rewrite_done',
    ]);
    expect(events[0]).toMatchObject({
      rewrite: { status: 'running', draft: '', focus: 'balanced', assessmentId: review.id },
    });
    expect(events.slice(1, 3)).toEqual([
      { type: 'rewrite_text', text: 'A sharper ' },
      { type: 'rewrite_text', text: 'draft.' },
    ]);
    expect(events[3]).toMatchObject({
      type: 'rewrite_done',
      rewrite: {
        status: 'completed',
        draft: 'A sharper draft.',
        model: 'claude-sonnet-5-5',
        costUsd: 0.04,
        error: null,
      },
    });

    const [row] = fake.rewrites;
    expect(row).toMatchObject({
      orgId: ORG,
      assessmentId: review.id,
      status: 'COMPLETED',
      draft: 'A sharper draft.',
      provider: 'anthropic',
      modelName: 'claude-sonnet-5-5',
      costUsd: 0.04,
      heldUsd: 0.05,
      createdByUserId: 'user-1',
      leaseExpiresAt: null,
    });
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(await started.done).toEqual(
      (events[3] as Extract<RewriteEvent, { type: 'rewrite_done' }>).rewrite
    );
  });

  it('charges the rewrite once, for its own cost rows, not its review’s', async () => {
    const review = finishedReview();
    fake.addCost(ORG, 0.3, { assessmentId: review.id, judge: 'judge_ethos' });
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: 'user-1' })
    );
    await started.done;

    const [row] = fake.rewrites;
    // $0.04 is 4 credits: the review's $0.30 is not this rewrite's.
    expect(charges()).toEqual([
      expect.objectContaining({ orgId: ORG, amount: -4, reference: `rewrite:${String(row.id)}` }),
    ]);
  });

  it('asks the editor with the real prompt, little thinking, and its own cost tags', async () => {
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: 'user-1' })
    );
    await started.done;

    const call = theCall();
    const [row] = fake.rewrites;
    expect(call).toMatchObject({
      agentSlug: 'hdtl-editor',
      role: 'editor',
      frameworkVersion: 'howdoesthisland@0.5.1',
      userId: 'user-1',
      costMetadata: { editor: 'rewrite', rewriteId: row.id },
    });
    expect(call.costMetadata).not.toHaveProperty('assessmentId');
    const request = call.request();
    expect(request.reasoningEffort).toBe('low');
    expect(request.prompt).toContain('Weakest appeal:');
    expect(request.prompt.endsWith(`<content>\n${TEXT}\n</content>`)).toBe(true);
  });

  it('hands the budget check what this request can cost at most, at the editor’s price (t-86)', async () => {
    mocks.streamCeilingUsd.mockResolvedValue(0.42);
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: 'user-1' })
    );
    await started.done;

    const ceiling = mocks.reserve.mock.calls[0][2] as () => Promise<number | null>;
    expect(await ceiling()).toBe(0.42);
    const [target, request] = mocks.streamCeilingUsd.mock.calls[0] as [
      Record<string, unknown>,
      { prompt: string; maxTokens: number },
    ];
    expect(target).toEqual({
      agentSlug: 'hdtl-editor',
      role: 'editor',
      name: 'editor',
      target: 'the editor',
    });
    // The request the call is made with: the same prompt, the text's own ceiling.
    expect(request.prompt).toBe(theCall().request().prompt);
    expect(request.maxTokens).toBe(rewriteMaxTokens(TEXT));
  });

  it('reads the project’s brief as it is now, with the passages the judges read', async () => {
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    await started.done;

    const { prompt } = theCall().request();
    expect(prompt).toContain(BRIEF_NOW.offer);
    expect(prompt).not.toContain('What they offer: Bikes.');
    expect(prompt).toContain(`[From "Guarantee"]\n${PASSAGE}`);
  });

  it('reads a brief written after the review, though its judges had none', async () => {
    const review = finishedReview({ projectContext: { brief: null, documents: [], passages: [] } });
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    await started.done;
    expect(theCall().request().prompt).toContain(BRIEF_NOW.offer);
  });

  it('keeps the brief the review stored when its project is gone', async () => {
    const review = finishedReview({ projectId: null });
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    await started.done;
    const { prompt } = theCall().request();
    expect(prompt).toContain('What they offer: Bikes.');
    expect(prompt).toContain(PASSAGE);
  });

  it('has no project block for a review outside a project', async () => {
    const review = finishedReview({ projectId: null, projectContext: null });
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    await started.done;
    expect(theCall().request().prompt).not.toContain('<project_context>');
  });

  it('rewrites a partial review, with the focus asked for', async () => {
    const review = finishedReview({ status: 'PARTIAL' });
    const started = await inOrg(() =>
      startRewrite(
        { assessmentId: String(review.id), focus: 'pathos', stream: false },
        { userId: null }
      )
    );
    expect(await started.done).toMatchObject({ status: 'completed', focus: 'pathos' });
    expect(theCall().request().prompt).toContain('Focus on raising pathos');
  });
});

describe('startRewrite refusals, before anything is written or spent', () => {
  it('404s another workspace’s review', async () => {
    const review = finishedReview({ orgId: 'org-b' });
    const err = await refusal(
      inOrg(() =>
        startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
      )
    );
    expect(err.status).toBe(404);
    expect(fake.rewrites).toEqual([]);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it.each(['QUEUED', 'RUNNING', 'FAILED', 'CANCELLED'])('409s a %s review', async (status) => {
    const review = finishedReview({ status, result: status === 'FAILED' ? null : RESULT });
    const err = await refusal(
      inOrg(() =>
        startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
      )
    );
    expect(err).toMatchObject({ status: 409, code: 'ASSESSMENT_NOT_REWRITABLE' });
    expect(fake.rewrites).toEqual([]);
  });

  it('409s a finished review with no result, saying so', async () => {
    const review = finishedReview({ result: null });
    const err = await refusal(
      inOrg(() =>
        startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
      )
    );
    expect(err).toMatchObject({ status: 409, code: 'ASSESSMENT_NOT_REWRITABLE' });
    expect(err.message).toBe('This review has no result to rewrite from.');
  });

  it('409s a review whose framework version can no longer be run', async () => {
    mocks.engineForVersion.mockResolvedValue(null);
    const review = finishedReview();
    const err = await refusal(
      inOrg(() =>
        startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
      )
    );
    expect(err).toMatchObject({ status: 409, code: 'ASSESSMENT_NOT_REWRITABLE' });
  });

  it('400s a focus the framework does not have, naming those it has', async () => {
    const review = finishedReview();
    const err = await refusal(
      inOrg(() =>
        startRewrite(
          { assessmentId: String(review.id), focus: 'influence', stream: false },
          { userId: null }
        )
      )
    );
    expect(err).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { focus: ['balanced', 'ethos', 'pathos', 'logos', 'kairos'] },
    });
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it('lets the budget’s refusal through, with nothing written', async () => {
    mocks.reserve.mockRejectedValue(new APIError('No credits.', 'INSUFFICIENT_CREDITS', 402));
    const review = finishedReview();
    const err = await refusal(
      inOrg(() =>
        startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
      )
    );
    expect(err).toMatchObject({ status: 402, code: 'INSUFFICIENT_CREDITS' });
    expect(fake.rewrites).toEqual([]);
    expect(mocks.streamAgent).not.toHaveBeenCalled();
  });
});

describe('a reader that goes', () => {
  it('does not stop the rewrite: it is still saved and charged', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      await call.onText('First. ');
      await gate;
      await call.onText('Second.');
      fake.addCost(ORG, 0.02, { ...call.costMetadata });
      return {
        text: 'First. Second.',
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        usage: { input: 1, output: 1, attempts: 1 },
        costUsd: 0.02,
        costLogIds: [],
        finishReason: 'stop',
      } satisfies AgentStreamReply;
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: true }, { userId: null })
    );

    // The reader takes the first event and stops listening.
    for await (const event of started.events) {
      expect(event.type).toBe('rewrite');
      break;
    }
    release();

    expect(await started.done).toMatchObject({ status: 'completed', draft: 'First. Second.' });
    expect(fake.rewrites[0]).toMatchObject({ status: 'COMPLETED', draft: 'First. Second.' });
    expect(charges()).toHaveLength(1);
  });
});

describe('a rewrite that fails', () => {
  it('ends failed with the editor’s reason, keeps what it wrote, and is charged what it was billed', async () => {
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      await call.onText('A draft that');
      fake.addCost(ORG, 0.03, { ...call.costMetadata, error: 'truncated' });
      const err = new JudgeRunError('truncated', "The editor's reply was cut off at its limit.");
      err.spend = {
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        usage: { input: 1, output: 1, attempts: 1 },
        costUsd: 0.03,
      };
      throw err;
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: true }, { userId: null })
    );
    const events = await collect(started.events);

    expect(events.at(-1)).toMatchObject({
      type: 'rewrite_done',
      rewrite: {
        status: 'failed',
        draft: 'A draft that',
        errorCode: 'truncated',
        error: "The editor's reply was cut off at its limit.",
        costUsd: 0.03,
      },
    });
    expect(fake.rewrites[0]).toMatchObject({ status: 'FAILED', modelName: 'claude-sonnet-5-5' });
    expect(charges()).toEqual([expect.objectContaining({ amount: -3 })]);
  });

  it('ends failed on anything else it throws, without the error’s text', async () => {
    mocks.streamAgent.mockRejectedValue(new Error('database exploded: secret detail'));
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    const ended = await started.done;
    expect(ended).toMatchObject({ status: 'failed', errorCode: 'internal_error' });
    expect(ended.error).not.toContain('secret');
  });
});

describe('while it runs', () => {
  it(`saves what it has written and renews its lease every ${DRAFT_SAVE_MS / 1000}s`, async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      await call.onText('So far.');
      await gate;
      return {
        text: 'So far.',
        provider: 'anthropic',
        model: 'm',
        usage: { input: 1, output: 1, attempts: 1 },
        costUsd: 0,
        costLogIds: [],
        finishReason: 'stop',
      } satisfies AgentStreamReply;
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    const before = fake.rewrites[0].leaseExpiresAt as Date;

    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_MS);
    expect(fake.rewrites[0]).toMatchObject({ status: 'RUNNING', draft: 'So far.' });
    expect((fake.rewrites[0].leaseExpiresAt as Date).getTime()).toBe(
      before.getTime() + DRAFT_SAVE_MS
    );
    expect((fake.rewrites[0].leaseExpiresAt as Date).getTime()).toBe(Date.now() + LEASE_MS);

    release();
    await started.done;
  });

  it('saves the draft as soon as it has its first piece, before the first interval (t-85)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      await call.onText('First.');
      await call.onText(' Second.');
      await gate;
      throw new JudgeRunError('provider_error', 'stopped');
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    await vi.advanceTimersByTimeAsync(0);
    // Saved once, at the first piece; the next waits for the interval.
    expect(fake.rewrites[0]).toMatchObject({ status: 'RUNNING', draft: 'First.' });

    release();
    await started.done;
  });

  it('keeps what its call is priced from on the row as the call starts (t-85)', async () => {
    const start = {
      agentId: 'agent-editor',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      isLocal: false,
      promptTokens: 6_000,
    };
    let kept: unknown;
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      await call.onStart?.(start);
      kept = fake.rewrites[0].callStart;
      throw new JudgeRunError('provider_error', 'stopped');
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    await started.done;
    expect(kept).toEqual({ ...start, frameworkVersion: 'howdoesthisland@0.5.1' });
  });

  it('goes on with the call when what it is priced from cannot be kept, and says so', async () => {
    let reached = false;
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      fake.db.rewrite.updateMany.mockRejectedValueOnce(new Error('connection reset'));
      await call.onStart?.({
        agentId: 'a',
        provider: 'p',
        model: 'm',
        isLocal: false,
        promptTokens: 1,
      });
      reached = true;
      throw new JudgeRunError('provider_error', 'stopped');
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    await started.done;
    expect(reached).toBe(true);
    expect(fake.rewrites[0].callStart).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'A rewrite could not keep what its call is priced from',
      expect.objectContaining({ error: 'connection reset' })
    );
  });

  it('stops the call when a save finds the row gone, as when its review is deleted, and still charges it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let signal: AbortSignal | undefined;
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      signal = call.signal;
      await call.onText('Part.');
      await new Promise<void>((resolve) => call.signal?.addEventListener('abort', () => resolve()));
      // A stopped stream's cost row lands only now, after the delete's charge.
      fake.addCost(ORG, 0.03, { ...call.costMetadata, estimated: true });
      throw new JudgeRunError('provider_error', "The editor's call failed.");
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    // The review is deleted, and its rewrites with it.
    await fake.db.assessment.deleteMany({ where: { id: review.id } });
    expect(fake.rewrites).toEqual([]);

    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_MS);
    expect(signal?.aborted).toBe(true);
    expect(await started.done).toMatchObject({ status: 'failed', assessmentId: review.id });
    expect(fake.rewrites).toEqual([]);
    expect(charges()).toEqual([expect.objectContaining({ amount: -3 })]);
  });

  it('stops a call that runs past REWRITE_CALL_MS on any host, and charges what it recorded', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    let signal: AbortSignal | undefined;
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      signal = call.signal;
      await call.onText('Part of it.');
      await new Promise<void>((resolve) => call.signal?.addEventListener('abort', () => resolve()));
      // Stopped, the call writes its own row, as any stopped call does.
      fake.addCost(ORG, 0.05, { ...call.costMetadata, estimated: true });
      const err = new JudgeRunError('provider_error', "The editor's call failed.");
      err.spend = {
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        usage: { input: 1, output: 1, attempts: 1 },
        costUsd: 0.05,
      };
      throw err;
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );

    await vi.advanceTimersByTimeAsync(REWRITE_CALL_MS - DRAFT_SAVE_MS);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_MS);
    expect(signal?.aborted).toBe(true);

    expect(await started.done).toMatchObject({
      status: 'failed',
      draft: 'Part of it.',
      error: OVERRAN_REWRITE,
      errorCode: 'timed_out',
      costUsd: 0.05,
    });
    expect(fake.rewrites[0]).toMatchObject({ status: 'FAILED', errorCode: 'timed_out' });
    expect(charges()).toEqual([expect.objectContaining({ amount: -5 })]);
  });

  it('saves at once on its first real piece, not on empty ones before it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let savesBeforeText = -1;
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      const before = fake.db.rewrite.updateMany.mock.calls.length;
      await call.onText('');
      await call.onText('');
      await Promise.resolve();
      savesBeforeText = fake.db.rewrite.updateMany.mock.calls.length - before;
      throw new JudgeRunError('provider_error', 'stopped');
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    await started.done;
    expect(savesBeforeText).toBe(0);
  });

  it('keeps a call’s own reason when the deadline passes as it fails another way', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      await call.onText('Part.');
      await gate;
      throw new JudgeRunError('truncated', "The editor's reply was cut off at its limit.");
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    await vi.advanceTimersByTimeAsync(REWRITE_CALL_MS);
    release();
    expect(await started.done).toMatchObject({ status: 'failed', errorCode: 'truncated' });
  });

  it('stops the call before the provider is asked when its row is gone as it starts', async () => {
    let aborted: boolean | undefined;
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      // Its review is deleted before the call starts.
      fake.rewrites.splice(0);
      await call.onStart?.({
        agentId: 'a',
        provider: 'p',
        model: 'm',
        isLocal: false,
        promptTokens: 1,
      });
      aborted = call.signal?.aborted;
      throw new JudgeRunError('provider_error', 'stopped');
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    await started.done;
    expect(aborted).toBe(true);
  });

  it('gives way, as it ends, to recovery’s estimate of it: charged once, for its own row', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      await call.onText('All of it.');
      await gate;
      fake.addCost(ORG, 0.04, { ...call.costMetadata });
      return {
        text: 'All of it.',
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        usage: { input: 1, output: 1, attempts: 1 },
        costUsd: 0.04,
        costLogIds: [],
        finishReason: 'stop',
      } satisfies AgentStreamReply;
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    const rewriteId = String(fake.rewrites[0].id);
    // It stalled past its lifetime: recovery priced it from its draft, but
    // had not charged it yet.
    fake.addCost(ORG, 0.02, { editor: 'rewrite', rewriteId, error: 'lost', estimated: true });
    release();

    expect(await started.done).toMatchObject({ status: 'completed', costUsd: 0.04 });
    expect(fake.costRows.map((r) => r.totalCostUsd)).toEqual([0.04]);
    expect(charges()).toEqual([expect.objectContaining({ amount: -4 })]);
  });

  it('runs on from recovery’s `lost`, replaces it with its own ending, and charges what landed after', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      await call.onText('All of it.');
      await gate;
      fake.addCost(ORG, 0.04, { ...call.costMetadata });
      return {
        text: 'All of it.',
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        usage: { input: 1, output: 1, attempts: 1 },
        costUsd: 0.04,
        costLogIds: [],
        finishReason: 'stop',
      } satisfies AgentStreamReply;
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    // Its saves failed past the lease, and recovery ended it, charging nothing.
    Object.assign(fake.rewrites[0], {
      status: 'FAILED',
      errorCode: 'lost',
      error: 'It stopped before finishing.',
      leaseExpiresAt: null,
    });
    // Its next save finds it: running again, not stopped.
    await vi.advanceTimersByTimeAsync(DRAFT_SAVE_MS);
    expect(fake.rewrites[0]).toMatchObject({ status: 'RUNNING', errorCode: null, error: null });
    expect(theCall().signal?.aborted).toBe(false);
    release();

    expect(await started.done).toMatchObject({ status: 'completed', draft: 'All of it.' });
    expect(fake.rewrites[0]).toMatchObject({ status: 'COMPLETED', errorCode: null, costUsd: 0.04 });
    expect(charges()).toEqual([expect.objectContaining({ amount: -4 })]);
  });

  it('does not write over a rewrite that ended another way', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      await gate;
      await call.onText('Late.');
      return {
        text: 'Late.',
        provider: 'anthropic',
        model: 'm',
        usage: { input: 1, output: 1, attempts: 1 },
        costUsd: 0,
        costLogIds: [],
        finishReason: 'stop',
      } satisfies AgentStreamReply;
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    Object.assign(fake.rewrites[0], { status: 'COMPLETED', draft: 'Earlier.' });
    release();
    expect(await started.done).toMatchObject({ status: 'completed', draft: 'Earlier.' });
  });
});

describe('a review that cannot be rewritten after all', () => {
  it('refuses a stored result the engine cannot read with 409, holding nothing', async () => {
    const review = finishedReview({ result: { scores: {} } });
    const err = await refusal(
      inOrg(() =>
        startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
      )
    );
    expect(err).toMatchObject({ status: 409, code: 'ASSESSMENT_NOT_REWRITABLE' });
    expect(err.message).toContain('stored result can no longer be read');
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it('answers 404 for a review deleted between the read and the row’s write', async () => {
    mocks.reserve.mockRejectedValue(Object.assign(new Error('fk'), { code: 'P2003' }));
    const review = finishedReview();
    const err = await refusal(
      inOrg(() =>
        startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
      )
    );
    expect(err.status).toBe(404);
    expect(mocks.streamAgent).not.toHaveBeenCalled();
  });
});

describe('an ending write that fails', () => {
  /** Start a rewrite whose call waits, so the ending write can be made to fail first. */
  async function startGated() {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
      await call.onText('The whole draft.');
      await gate;
      fake.addCost(ORG, 0.02, { ...call.costMetadata });
      return {
        text: 'The whole draft.',
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        usage: { input: 1, output: 1, attempts: 1 },
        costUsd: 0.02,
        costLogIds: [],
        finishReason: 'stop',
      } satisfies AgentStreamReply;
    });
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    return { started, release };
  }

  it('is tried once more, and then ends and charges the rewrite', async () => {
    const { started, release } = await startGated();
    fake.db.$transaction.mockRejectedValueOnce(new Error('pool timeout'));
    release();
    expect(await started.done).toMatchObject({ status: 'completed', draft: 'The whole draft.' });
    expect(fake.rewrites[0]).toMatchObject({ status: 'COMPLETED' });
    expect(charges()).toHaveLength(1);
  });

  it('twice failed, answers the row as it is, running with the whole draft, for recovery to end', async () => {
    const { started, release } = await startGated();
    fake.db.$transaction
      .mockRejectedValueOnce(new Error('pool timeout'))
      .mockRejectedValueOnce(new Error('pool timeout'));
    release();
    expect(await started.done).toMatchObject({
      status: 'running',
      draft: 'The whole draft.',
      completedAt: null,
    });
    expect(fake.rewrites[0]).toMatchObject({ status: 'RUNNING', draft: 'The whole draft.' });
    expect(charges()).toEqual([]);
  });
});

describe('a request that does not stream', () => {
  it('has no events to read, and still ends and charges the rewrite', async () => {
    const review = finishedReview();
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    expect(await collect(started.events)).toEqual([]);
    expect(await started.done).toMatchObject({ status: 'completed', draft: 'A sharper draft.' });
    expect(charges()).toHaveLength(1);
  });
});

describe('getRewrite and listRewrites', () => {
  async function rewriteOf(review: Row): Promise<string> {
    const started = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), stream: false }, { userId: null })
    );
    return (await started.done).id;
  }

  it('reads one of the workspace’s rewrites, and 404s another workspace’s', async () => {
    const id = await rewriteOf(finishedReview());
    expect(await inOrg(() => getRewrite(id))).toMatchObject({ id, status: 'completed' });
    const err = await refusal(runAsOrg('org-b', () => getRewrite(id)));
    expect(err.status).toBe(404);
  });

  it('lists a review’s rewrites newest first, and 404s a review not in the workspace', async () => {
    const review = finishedReview();
    const first = await rewriteOf(review);
    fake.rewrites[0].createdAt = new Date(Date.now() - 10_000);
    const second = await rewriteOf(review);
    expect((await inOrg(() => listRewrites(String(review.id)))).map((r) => r.id)).toEqual([
      second,
      first,
    ]);
    const err = await refusal(runAsOrg('org-b', () => listRewrites(String(review.id))));
    expect(err.status).toBe(404);
  });
});

describe('startRewrite: answering a rewrite’s placeholders (t-83)', () => {
  const GAPPY = 'Ask [ADD: a client] about the [ADD: saving]. [ADD: A client] will tell you.';

  /** A finished rewrite of `review` whose draft is {@link GAPPY}. */
  async function gappyRewrite(review: Row, focus = 'pathos') {
    streams([GAPPY]);
    const first = await inOrg(() =>
      startRewrite({ assessmentId: String(review.id), focus, stream: false }, { userId: null })
    );
    const ended = await first.done;
    mocks.streamAgent.mockClear();
    streams(['Filled.']);
    return ended;
  }

  it('reads the draft’s placeholders onto the rewrite, a repeated one once', async () => {
    const review = finishedReview();
    const ended = await gappyRewrite(review);
    expect(ended.placeholders.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'p1', label: 'a client' },
      { id: 'p2', label: 'saving' },
    ]);
    expect(ended.placeholders[0].at).toHaveLength(2);
    expect((await inOrg(() => getRewrite(ended.id))).placeholders).toEqual(ended.placeholders);
  });

  it('starts from that draft with each answer, leaving the unanswered, in its focus', async () => {
    const review = finishedReview();
    const earlier = await gappyRewrite(review);
    const started = await inOrg(() =>
      startRewrite(
        {
          assessmentId: String(review.id),
          fromRewriteId: earlier.id,
          answers: { p1: 'Leeds Plumbing' },
          stream: false,
        },
        { userId: null }
      )
    );
    const done = await started.done;

    const { prompt } = theCall().request();
    expect(prompt).toContain(`<earlier_draft>\n${GAPPY}\n</earlier_draft>`);
    // Each spelling of the fact is answered, so both places it sits are filled.
    expect(prompt).toContain(
      '<answers>\n- [ADD: a client]: Leeds Plumbing\n- [ADD: A client]: Leeds Plumbing\n</answers>'
    );
    expect(prompt).toContain('Focus on raising pathos');
    expect(done).toMatchObject({ status: 'completed', focus: 'pathos', draft: 'Filled.' });
    // A rewrite of its own, the earlier one left as it was.
    expect(fake.rewrites).toHaveLength(2);
    expect(fake.rewrites.find((r) => r.id === earlier.id)?.draft).toBe(GAPPY);
  });

  it('takes a focus asked for over the earlier rewrite’s', async () => {
    const review = finishedReview();
    const earlier = await gappyRewrite(review);
    const started = await inOrg(() =>
      startRewrite(
        {
          assessmentId: String(review.id),
          focus: 'logos',
          fromRewriteId: earlier.id,
          answers: { p2: '£400 a year' },
          stream: false,
        },
        { userId: null }
      )
    );
    await started.done;
    expect(theCall().request().prompt).toContain('Focus on raising logos');
  });

  it('400s an answer to a placeholder the draft does not have, naming those it has', async () => {
    const review = finishedReview();
    const earlier = await gappyRewrite(review);
    const err = await refusal(
      inOrg(() =>
        startRewrite(
          {
            assessmentId: String(review.id),
            fromRewriteId: earlier.id,
            answers: { p1: 'Leeds Plumbing', p9: 'nothing' },
            stream: false,
          },
          { userId: null }
        )
      )
    );
    expect(err).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      details: { answers: { unknown: ['p9'], placeholders: ['p1', 'p2'] } },
    });
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(fake.rewrites).toHaveLength(1);
  });

  it('404s a rewrite of another review, or another workspace’s', async () => {
    const review = finishedReview();
    const earlier = await gappyRewrite(review);
    const other = finishedReview();
    for (const [assessmentId, org] of [
      [String(other.id), ORG],
      [String(review.id), 'org-b'],
    ] as const) {
      const err = await refusal(
        runAsOrg(org, () =>
          startRewrite(
            { assessmentId, fromRewriteId: earlier.id, answers: { p1: 'x' }, stream: false },
            { userId: null }
          )
        )
      );
      expect(err.status).toBe(404);
    }
    expect(fake.rewrites).toHaveLength(1);
  });

  it('409s a rewrite that has not finished', async () => {
    const review = finishedReview();
    const earlier = await gappyRewrite(review);
    const row = fake.rewrites.find((r) => r.id === earlier.id);
    if (!row) throw new Error('no row');
    row.status = 'FAILED';
    const err = await refusal(
      inOrg(() =>
        startRewrite(
          {
            assessmentId: String(review.id),
            fromRewriteId: earlier.id,
            answers: { p1: 'x' },
            stream: false,
          },
          { userId: null }
        )
      )
    );
    expect(err).toMatchObject({ status: 409, code: 'REWRITE_NOT_FINISHED' });
    expect(fake.rewrites).toHaveLength(1);
  });
});

/**
 * Tests: the assessment job (t-22) — runAssessment, cancelAssessment and the
 * recovery job, over a stateful in-memory store.
 *
 * Mocked: Prisma (the fake in `fake-db.ts`, so every assertion is on the rows
 * a run leaves), the engine (a stub whose `assemble` reports which judges'
 * outputs it was given), `runJudge` (scripted per slot) and `runEditor`
 * (skipping by default; its own tests are `editor.test.ts`), and the budget
 * check at claim (fitting by default; its own tests are `budget.test.ts`). Real: how the
 * editor's outcome is stored and costed. Real: the fan-out,
 * the lease and claim logic, the tenant context and the privacy scope.
 *
 * The load-bearing chain is job → runJudge → JudgeRun row: each test drives
 * the job and reads the rows, never the job's internals.
 *
 * @see lib/app/assessments/run.ts · lib/app/assessments/recover.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { createFakeDb, type FakeDb, type Row } from '@/tests/unit/lib/app/assessments/fake-db';

const mocks = vi.hoisted(() => ({
  runJudge: vi.fn(),
  runEditor: vi.fn(),
  engineForVersion: vi.fn(),
  budgetRefusal: vi.fn(),
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
  runJudge: mocks.runJudge,
}));
vi.mock('@/lib/app/assessments/engine', () => ({ engineForVersion: mocks.engineForVersion }));
// The check itself is `budget.test.ts`'s; here, what the run does with its answer (t-53).
vi.mock('@/lib/app/usage/budget', () => ({ budgetRefusal: mocks.budgetRefusal }));
vi.mock('@/lib/app/assessments/editor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/assessments/editor')>()),
  runEditor: mocks.runEditor,
}));

import {
  CANCEL_GRACE_MS,
  JUDGES_IN_FLIGHT,
  LEASE_MS,
  LEASE_RENEW_MS,
} from '@/lib/app/assessments/limits';
import { recoverAssessments } from '@/lib/app/assessments/recover';
import { cancelAssessment, runAssessment } from '@/lib/app/assessments/run';
import { JudgeProfileError } from '@/lib/app/frameworks/engine';
import { JudgeRunError } from '@/lib/app/judges/run-judge';
import { logger } from '@/lib/logging';
import { currentPrivacyScope } from '@/lib/orchestration/privacy/scope';
import { runAsOrg } from '@/lib/tenancy/context';

const ORG = 'org-a';
const inOrg = <T>(fn: () => Promise<T>) => runAsOrg(ORG, fn);

const engine = {
  quickScan: vi.fn(() => ({ quick: true })),
  assemble: vi.fn(
    (_text: string, _ctx: unknown, quick: unknown, outputs: Record<string, unknown> = {}) => ({
      scores: { overall: 40 + Object.keys(outputs).length, band: 'mixed' },
      judged: Object.keys(outputs).sort(),
      quick,
    })
  ),
  activeJudgeSlots: vi.fn(),
  buildJudgeRequest: vi.fn(),
  outputSchema: vi.fn(),
  validateJudgeReply: vi.fn(),
};

function reply(slot: string) {
  return {
    slot,
    output: { from: slot },
    drops: [{ at: 'highlights[0]', reason: 'quote_not_found' }],
    provider: 'openai',
    model: 'gpt-4.1',
    usage: { input: 100, output: 20, attempts: 1 },
    costUsd: 0.01,
    costLogIds: [`cost-${slot}`],
    finishReason: 'stop',
  };
}

/** A promise the test resolves by hand. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Long enough for runs the recovery job started, and did not wait for, to end. */
const settle = () => new Promise((r) => setTimeout(r, 20));

const runsOf = (assessmentId: unknown) =>
  fake.judgeRuns.filter((r) => r.assessmentId === assessmentId);

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeDb();
  mocks.engineForVersion.mockResolvedValue({
    version: { id: 'version-1', status: 'PUBLISHED' },
    engine,
    label: 'howdoesthisland@0.5.1',
  });
  mocks.runJudge.mockImplementation(async (slot: string) => reply(slot));
  mocks.runEditor.mockResolvedValue({ status: 'skipped', reason: 'too_few_judges' });
  mocks.budgetRefusal.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a run that completes', () => {
  it('goes QUEUED → COMPLETED, saving a JudgeRun per judge and storing assemble()’s result', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_b'] });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('completed');

    expect(mocks.runJudge.mock.calls.map((c) => c[0])).toEqual(['judge_a', 'judge_b']);
    expect(mocks.runJudge).toHaveBeenCalledWith(
      'judge_a',
      expect.objectContaining({
        frameworkVersion: 'howdoesthisland@0.5.1',
        text: 'The text.',
        ctx: a.context,
        assessmentId: a.id,
        userId: 'user-1',
      })
    );
    expect(runsOf(a.id)).toEqual([
      expect.objectContaining({
        orgId: ORG,
        judge: 'judge_a',
        status: 'SUCCEEDED',
        provider: 'openai',
        modelName: 'gpt-4.1',
        attempts: 1,
        costUsd: 0.01,
        tokens: { input: 100, output: 20 },
      }),
      expect.objectContaining({ judge: 'judge_b', status: 'SUCCEEDED' }),
    ]);
    // The reply is its own row, which retention deletes sooner (t-26).
    const [runA, runB] = runsOf(a.id);
    expect(runA).not.toHaveProperty('output');
    expect(runA).not.toHaveProperty('dropped');
    expect(fake.replies).toEqual([
      expect.objectContaining({
        orgId: ORG,
        judgeRunId: runA?.id,
        output: { from: 'judge_a' },
        dropped: [{ at: 'highlights[0]', reason: 'quote_not_found' }],
      }),
      expect.objectContaining({ judgeRunId: runB?.id, output: { from: 'judge_b' } }),
    ]);
    expect(a).toMatchObject({
      status: 'COMPLETED',
      result: { scores: { overall: 42, band: 'mixed' }, judged: ['judge_a', 'judge_b'] },
      overall: 42,
      band: 'mixed',
      costUsd: 0.02,
      attempts: 1,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    expect(a.completedAt).toBeInstanceOf(Date);
  });

  it('saves each JudgeRun as it lands, before the next judge has finished', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_b'] });
    const gate = deferred();
    let rowsWhileBWaits: Row[] = [];
    mocks.runJudge.mockImplementation(async (slot: string) => {
      if (slot === 'judge_b') {
        await gate.promise;
        rowsWhileBWaits = runsOf(a.id).map((r) => ({ ...r }));
      }
      return reply(slot);
    });

    const running = inOrg(() => runAssessment(String(a.id)));
    await flush();
    // judge_a has landed; judge_b is still out.
    expect(runsOf(a.id).map((r) => r.judge)).toEqual(['judge_a']);
    expect(a.status).toBe('RUNNING');
    gate.resolve();
    await running;
    expect(rowsWhileBWaits.map((r) => r.judge)).toEqual(['judge_a']);
  });

  it('runs a quick profile (no judges) to COMPLETED on the quick scan alone', async () => {
    const a = fake.seed({ judges: [], profile: 'quick' });
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('completed');
    expect(mocks.runJudge).not.toHaveBeenCalled();
    expect(a).toMatchObject({ status: 'COMPLETED', result: { judged: [] }, overall: 40 });
  });

  it('runs inside the assessment’s privacy scope, for its workspace and requester', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    let seen: ReturnType<typeof currentPrivacyScope>;
    mocks.runJudge.mockImplementation(async (slot: string) => {
      seen = currentPrivacyScope();
      return reply(slot);
    });
    await inOrg(() => runAssessment(String(a.id)));
    expect(seen).toMatchObject({
      scopeId: `assessment:${String(a.id)}`,
      orgId: ORG,
      userId: 'user-1',
    });
  });
});

describe('the editor’s summary', () => {
  const SUMMARY = {
    verdict: 'It lands.',
    changes: [{ recommendation: 'rec_1', change: 'Cut the opener.', why: 'It delays the ask.' }],
    works: ['The close.'],
  };
  const editorSpend = {
    provider: 'openai',
    model: 'gpt-5',
    usage: { input: 900, output: 150, attempts: 1 },
    costUsd: 0.005,
  };

  it('asks the editor after the judges, with the assembled result, and stores its summary', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_b'] });
    mocks.runEditor.mockImplementation(async () => {
      // The judges have all been saved before the editor is asked.
      expect(runsOf(a.id).map((r) => r.judge)).toEqual(['judge_a', 'judge_b']);
      return {
        status: 'written',
        summary: SUMMARY,
        drops: [{ at: 'changes[1]', reason: 'unknown_id', detail: 'rec_9' }],
        spend: editorSpend,
        latencyMs: 5,
      };
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('completed');

    expect(mocks.runEditor).toHaveBeenCalledTimes(1);
    expect(mocks.runEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        engine,
        frameworkVersion: 'howdoesthisland@0.5.1',
        text: 'The text.',
        ctx: a.context,
        result: expect.objectContaining({ judged: ['judge_a', 'judge_b'] }),
        judges: ['judge_a', 'judge_b'],
        answered: 2,
        assessmentId: a.id,
        userId: 'user-1',
      })
    );
    expect(a).toMatchObject({
      status: 'COMPLETED',
      result: {
        judged: ['judge_a', 'judge_b'],
        editor: {
          status: 'written',
          summary: SUMMARY,
          dropped: [{ at: 'changes[1]', reason: 'unknown_id', detail: 'rec_9' }],
          model: 'gpt-5',
          costUsd: 0.005,
        },
      },
    });
    // Two judges at 0.01 and the editor's 0.005.
    expect(a.costUsd).toBeCloseTo(0.025);
  });

  it('leaves the assessment COMPLETED, without a summary and marked, when the editor fails', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_b'] });
    mocks.runEditor.mockResolvedValue({
      status: 'failed',
      code: 'malformed',
      message: 'The editor’s reply was not usable, twice.',
      spend: { ...editorSpend, usage: { input: 1800, output: 300, attempts: 2 }, costUsd: 0.01 },
      latencyMs: 9,
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('completed');

    expect(a).toMatchObject({
      status: 'COMPLETED',
      error: null,
      result: {
        judged: ['judge_a', 'judge_b'],
        editor: { status: 'failed', errorCode: 'malformed', model: 'gpt-5', costUsd: 0.01 },
      },
    });
    expect((a.result as Record<string, unknown>).editor).not.toHaveProperty('summary');
    // What the failed editor was billed still counts.
    expect(a.costUsd).toBeCloseTo(0.03);
  });

  it('logs, and still finishes, when the editor’s cost cannot be added', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_b'] });
    mocks.runEditor.mockResolvedValue({
      status: 'failed',
      code: 'malformed',
      message: 'x',
      spend: { ...editorSpend, costUsd: 0.007 },
      latencyMs: 9,
    });
    const real = fake.db.assessment.updateMany.getMockImplementation();
    fake.db.assessment.updateMany.mockImplementation((args) =>
      JSON.stringify(args.data.costUsd) === JSON.stringify({ increment: 0.007 })
        ? Promise.reject(new Error('connection reset'))
        : real!(args)
    );

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('completed');

    expect(mocks.runEditor).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Could not add the editor’s cost to the assessment',
      expect.any(Error),
      { assessmentId: a.id, costUsd: 0.007 }
    );
    expect(a).toMatchObject({ status: 'COMPLETED', result: { editor: { status: 'failed' } } });
  });

  it('counts only the judges that answered, and a partial run stays PARTIAL', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_b', 'judge_c'] });
    mocks.runJudge.mockImplementation(async (slot: string) => {
      if (slot === 'judge_b') throw new JudgeRunError('refused', 'no');
      return reply(slot);
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('partial');
    expect(mocks.runEditor).toHaveBeenCalledWith(
      expect.objectContaining({ judges: ['judge_a', 'judge_b', 'judge_c'], answered: 2 })
    );
    expect(a).toMatchObject({
      status: 'PARTIAL',
      result: { editor: { status: 'skipped', reason: 'too_few_judges' } },
    });
  });

  it('records a skipped editor on the result, at no cost', async () => {
    const a = fake.seed({ judges: [], profile: 'quick' });
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('completed');
    expect(a).toMatchObject({
      result: { editor: { status: 'skipped', reason: 'too_few_judges' } },
      costUsd: 0,
    });
  });

  it('requeues the run when the editor’s step fails on an error that is not its own', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_b'] });
    mocks.runEditor.mockRejectedValue(new Error('database gone'));
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('requeued');
    expect(a).toMatchObject({ status: 'QUEUED', result: null, leaseToken: null });
  });

  it('counts the editor’s cost on an assessment cancelled while it ran, not writing it again', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_b'] });
    mocks.runEditor.mockImplementation(async () => {
      await inOrg(() => cancelAssessment(String(a.id)));
      return { status: 'written', summary: SUMMARY, drops: [], spend: editorSpend, latencyMs: 1 };
    });
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('cancelled');
    expect(a).toMatchObject({ status: 'CANCELLED', result: null });
    expect(a.costUsd).toBeCloseTo(0.025);
  });
});

describe('a judge that fails', () => {
  it('falls back to the quick scan for that judge and marks the result PARTIAL, recording why', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_b'] });
    mocks.runJudge.mockImplementation(async (slot: string) => {
      if (slot === 'judge_b')
        throw new JudgeRunError('over_budget', 'The judge_b judge is over its monthly budget.');
      return reply(slot);
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('partial');

    // assemble() was given judge_a's output only: judge_b's dimensions are the quick scan's.
    expect(a).toMatchObject({ status: 'PARTIAL', result: { judged: ['judge_a'] }, costUsd: 0.01 });
    expect(runsOf(a.id).find((r) => r.judge === 'judge_b')).toMatchObject({
      status: 'FAILED',
      errorCode: 'over_budget',
      errorMessage: 'The judge_b judge is over its monthly budget.',
    });
  });

  it('queues the assessment again on an error that is not a judge’s, with no live lease', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    mocks.runJudge.mockRejectedValueOnce(new Error('connection reset'));
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('requeued');
    expect(a).toMatchObject({ status: 'QUEUED', leaseToken: null, leaseExpiresAt: null });
    expect(a.attempts).toBe(1);

    // The next run takes it up under the attempts it has left.
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('completed');
    expect(a).toMatchObject({ status: 'COMPLETED', attempts: 2 });
  });

  it('stores what a failed judge was billed, and counts it in the assessment’s cost', async () => {
    const a = fake.seed();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      if (slot !== 'judge_b') return reply(slot);
      const err = new JudgeRunError(
        'malformed',
        'The judge_b judge’s reply was not usable, twice.'
      );
      err.spend = {
        provider: 'openai',
        model: 'gpt-4.1',
        usage: { input: 200, output: 40, attempts: 2 },
        costUsd: 0.02,
      };
      throw err;
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('partial');
    expect(runsOf(a.id).find((r) => r.judge === 'judge_b')).toMatchObject({
      status: 'FAILED',
      errorCode: 'malformed',
      provider: 'openai',
      modelName: 'gpt-4.1',
      attempts: 2,
      costUsd: 0.02,
      tokens: { input: 200, output: 40 },
    });
    expect(a.costUsd).toBeCloseTo(0.03);
  });

  it('fails the assessment when its framework version can no longer be run', async () => {
    const a = fake.seed();
    mocks.engineForVersion.mockResolvedValue(null);
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('failed');
    expect(a.status).toBe('FAILED');
    expect(mocks.runJudge).not.toHaveBeenCalled();
  });

  it('fails the assessment at once when the engine cannot score the text, not re-queuing it', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    engine.assemble.mockImplementationOnce(() => {
      throw new Error('no dimension for judge_a');
    });
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('failed');
    expect(a).toMatchObject({
      status: 'FAILED',
      error: 'The framework could not score this text.',
      leaseToken: null,
      attempts: 1,
    });
    // Its judge was saved and counted before assembly threw.
    expect(a.costUsd).toBeCloseTo(0.01);
  });

  it('fails a judge the engine no longer runs as that judge, and finishes PARTIAL', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_culture'] });
    // Asked once per missing slot, in order: judge_a runs, judge_culture is off.
    engine.activeJudgeSlots
      .mockImplementationOnce((slots: readonly string[]) => slots)
      .mockImplementationOnce(() => {
        throw new JudgeProfileError(
          'The judge_culture judge does not run with the culture switch off'
        );
      });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('partial');
    expect(mocks.runJudge.mock.calls.map((c) => c[0])).toEqual(['judge_a']);
    expect(runsOf(a.id).find((r) => r.judge === 'judge_culture')).toMatchObject({
      status: 'FAILED',
      errorCode: 'slot_unavailable',
      costUsd: 0,
    });
    expect(a).toMatchObject({ status: 'PARTIAL', result: { judged: ['judge_a'] } });
  });

  it('fails the assessment at once when the quick scan throws, calling no judge', async () => {
    const a = fake.seed();
    engine.quickScan.mockImplementationOnce(() => {
      throw new Error('bad text');
    });
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('failed');
    expect(a.status).toBe('FAILED');
    expect(mocks.runJudge).not.toHaveBeenCalled();
  });
});

describe('cancel', () => {
  it('stops further judge calls; the ones in flight land and the assessment stays CANCELLED', async () => {
    const slots = Array.from({ length: JUDGES_IN_FLIGHT + 3 }, (_, i) => `judge_${i}`);
    const a = fake.seed({ judges: slots });
    let cancelled = false;
    mocks.runJudge.mockImplementation(async (slot: string) => {
      if (!cancelled) {
        cancelled = true;
        expect(await inOrg(() => cancelAssessment(String(a.id)))).toBe(true);
      }
      return reply(slot);
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('cancelled');

    // The first wave started before the cancel; nothing started after it.
    expect(mocks.runJudge).toHaveBeenCalledTimes(JUDGES_IN_FLIGHT);
    expect(runsOf(a.id)).toHaveLength(JUDGES_IN_FLIGHT);
    expect(a).toMatchObject({ status: 'CANCELLED', result: null });
  });

  it('a cancel that lands while the result is being assembled is not overwritten', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    engine.assemble.mockImplementationOnce(() => {
      Object.assign(a, { status: 'CANCELLED', leaseToken: null });
      return { scores: { overall: 41, band: 'mixed' }, judged: ['judge_a'], quick: true };
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('cancelled');
    expect(a).toMatchObject({ status: 'CANCELLED', result: null, overall: null });
  });

  it('counts what the judges in flight cost, though the assessment is not written again', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_b'] });
    mocks.runJudge.mockImplementation(async (slot: string) => {
      if (slot === 'judge_a') await inOrg(() => cancelAssessment(String(a.id)));
      return reply(slot);
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('cancelled');
    expect(runsOf(a.id)).toHaveLength(2);
    expect(a.costUsd).toBeCloseTo(0.02);
  });

  it('a run that lost its lease saves nothing after its successor was cancelled', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    mocks.runJudge.mockImplementation(async () => {
      // A successor claims it and saves judge_a; then the user cancels.
      Object.assign(a, { leaseToken: 'new-run' });
      fake.judgeRuns.push({
        id: 'theirs',
        assessmentId: a.id,
        judge: 'judge_a',
        status: 'SUCCEEDED',
        output: { from: 'new-run' },
        costUsd: 0.05,
      });
      await inOrg(() => cancelAssessment(String(a.id)));
      throw new JudgeRunError('refused', 'The provider declined to run the judge_a judge.');
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('cancelled');
    expect(runsOf(a.id)).toEqual([
      expect.objectContaining({ id: 'theirs', status: 'SUCCEEDED', costUsd: 0.05 }),
    ]);
  });

  it('keeps its place in the workspace’s limit until its judges in flight land', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    const gate = deferred();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      await gate.promise;
      return reply(slot);
    });
    const live = { status: 'RUNNING', leaseExpiresAt: new Date(Date.now() + 30_000), attempts: 1 };
    fake.seed({ ...live, leaseToken: 'run-1' });
    fake.seed({ ...live, leaseToken: 'run-2' });
    const waiting = fake.seed({ judges: [] });

    const running = inOrg(() => runAssessment(String(a.id)));
    await flush();
    expect(await inOrg(() => cancelAssessment(String(a.id)))).toBe(true);
    // Its judge is still out, so the workspace is still at its limit.
    expect(await inOrg(() => runAssessment(String(waiting.id)))).toBe('not_claimed');

    gate.resolve();
    expect(await running).toBe('cancelled');
    expect(a).toMatchObject({ status: 'CANCELLED', leaseExpiresAt: null });
    // The place is free again: the waiting one starts, whoever claims it (the
    // run's own `startNextQueued`, as here, or the next caller).
    await settle();
    expect(waiting).toMatchObject({ status: 'COMPLETED', attempts: 1 });
  });

  it('answers cancelled, and frees its place, when an error follows the cancel', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    mocks.runJudge.mockImplementation(async () => {
      await inOrg(() => cancelAssessment(String(a.id)));
      throw new Error('connection reset');
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('cancelled');
    expect(a).toMatchObject({ status: 'CANCELLED', leaseExpiresAt: null });
  });

  it('answers cancelled when the engine fails to score a text cancelled under it', async () => {
    const a = fake.seed({ judges: [] });
    engine.quickScan.mockImplementationOnce(() => {
      Object.assign(a, { status: 'CANCELLED' });
      throw new Error('bad text');
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('cancelled');
    expect(a).toMatchObject({ status: 'CANCELLED', error: null, leaseExpiresAt: null });
  });

  it('refuses to cancel a final assessment, or another workspace’s', async () => {
    const done = fake.seed({ status: 'COMPLETED' });
    const theirs = fake.seed({ orgId: 'org-b' });
    expect(await inOrg(() => cancelAssessment(String(done.id)))).toBe(false);
    expect(await inOrg(() => cancelAssessment(String(theirs.id)))).toBe(false);
    expect(theirs.status).toBe('QUEUED');
  });
});

describe('the lease', () => {
  it('is not claimed while another run holds it', async () => {
    const a = fake.seed({
      status: 'RUNNING',
      leaseToken: 'theirs',
      leaseExpiresAt: new Date(Date.now() + 30_000),
      attempts: 1,
    });
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('not_claimed');
    expect(mocks.runJudge).not.toHaveBeenCalled();
    expect(a).toMatchObject({ leaseToken: 'theirs', attempts: 1 });
  });

  it('is not claimed for a final assessment', async () => {
    const a = fake.seed({ status: 'COMPLETED' });
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('not_claimed');
    expect(mocks.runJudge).not.toHaveBeenCalled();
  });

  it('is renewed while the run is alive', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const a = fake.seed({ judges: ['judge_a'] });
    const gate = deferred();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      await gate.promise;
      return reply(slot);
    });

    const running = inOrg(() => runAssessment(String(a.id)));
    await flush();
    const first = (a.leaseExpiresAt as Date).getTime();
    await new Promise((r) => setTimeout(r, 5));
    vi.advanceTimersByTime(LEASE_RENEW_MS);
    await flush();
    expect((a.leaseExpiresAt as Date).getTime()).toBeGreaterThan(first);
    expect((a.leaseExpiresAt as Date).getTime()).toBeLessThanOrEqual(Date.now() + LEASE_MS);
    gate.resolve();
    await running;
    expect(a.status).toBe('COMPLETED');
  });

  it('is renewed after a cancel while the judges in flight land, until the run clears it (t-56)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const slots = Array.from({ length: JUDGES_IN_FLIGHT + 2 }, (_, i) => `judge_${i}`);
    const a = fake.seed({ judges: slots });
    const gate = deferred();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      await gate.promise;
      return reply(slot);
    });

    const running = inOrg(() => runAssessment(String(a.id)));
    await flush();
    expect(await inOrg(() => cancelAssessment(String(a.id)))).toBe(true);
    const first = (a.leaseExpiresAt as Date).getTime();
    await new Promise((r) => setTimeout(r, 5));
    vi.advanceTimersByTime(LEASE_RENEW_MS);
    await flush();

    // Cancelled, and its lease still renewed while the first wave is out.
    expect(a.status).toBe('CANCELLED');
    expect((a.leaseExpiresAt as Date).getTime()).toBeGreaterThan(first);

    gate.resolve();
    expect(await running).toBe('cancelled');
    // No judge started after the cancel, and the run gave its place up once they landed.
    expect(mocks.runJudge).toHaveBeenCalledTimes(JUDGES_IN_FLIGHT);
    expect(runsOf(a.id)).toHaveLength(JUDGES_IN_FLIGHT);
    expect(a.leaseExpiresAt).toBeNull();
  });

  it('a renewal that lands after a cancelled run gave its place up does not take it back', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const a = fake.seed({ judges: ['judge_a'] });
    const judge = deferred();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      await judge.promise;
      return reply(slot);
    });

    const running = inOrg(() => runAssessment(String(a.id)));
    await flush();
    expect(await inOrg(() => cancelAssessment(String(a.id)))).toBe(true);
    // The next renewal is held up in the database until the run has ended.
    const renewal = deferred();
    const real = fake.db.assessment.updateMany.getMockImplementation();
    fake.db.assessment.updateMany.mockImplementationOnce(async (args) => {
      await renewal.promise;
      return real!(args);
    });
    vi.advanceTimersByTime(LEASE_RENEW_MS);
    judge.resolve();
    await flush();
    renewal.resolve();

    expect(await running).toBe('cancelled');
    // It found the lease already cleared, so freeing the place is what stands.
    expect(a.leaseExpiresAt).toBeNull();
  });

  it('nor does one that outlasted the next renewal', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const a = fake.seed({ judges: ['judge_a'] });
    const judge = deferred();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      await judge.promise;
      return reply(slot);
    });

    const running = inOrg(() => runAssessment(String(a.id)));
    await flush();
    expect(await inOrg(() => cancelAssessment(String(a.id)))).toBe(true);
    // The first renewal hangs in the database past the second, which lands.
    const slow = deferred();
    const real = fake.db.assessment.updateMany.getMockImplementation();
    fake.db.assessment.updateMany.mockImplementationOnce(async (args) => {
      await slow.promise;
      return real!(args);
    });
    vi.advanceTimersByTime(LEASE_RENEW_MS);
    vi.advanceTimersByTime(LEASE_RENEW_MS);
    judge.resolve();
    await flush();
    slow.resolve();

    expect(await running).toBe('cancelled');
    expect(a.leaseExpiresAt).toBeNull();
  });

  it('stops renewing a cancelled lease LEASE_MS short of CANCEL_GRACE_MS, so it runs out before the purge', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const a = fake.seed({ judges: ['judge_a'] });
    const judge = deferred();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      await judge.promise;
      return reply(slot);
    });

    const running = inOrg(() => runAssessment(String(a.id)));
    await flush();
    expect(await inOrg(() => cancelAssessment(String(a.id)))).toBe(true);
    // A judge that never lands: one more lease would outlast the grace the purge allows.
    a.completedAt = new Date(Date.now() - (CANCEL_GRACE_MS - LEASE_MS) - 1);
    const lease = (a.leaseExpiresAt as Date).getTime();
    await new Promise((r) => setTimeout(r, 5));
    vi.advanceTimersByTime(LEASE_RENEW_MS);
    await flush();

    expect((a.leaseExpiresAt as Date).getTime()).toBe(lease);
    judge.resolve();
    expect(await running).toBe('cancelled');
  });

  it('does not bring back a cancelled lease that lapsed, whose place another run may have', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const a = fake.seed({ judges: ['judge_a'] });
    const judge = deferred();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      await judge.promise;
      return reply(slot);
    });

    const running = inOrg(() => runAssessment(String(a.id)));
    await flush();
    expect(await inOrg(() => cancelAssessment(String(a.id)))).toBe(true);
    // Renewals failed long enough for the lease to run out.
    const lapsed = new Date(Date.now() - 1000);
    a.leaseExpiresAt = lapsed;
    vi.advanceTimersByTime(LEASE_RENEW_MS);
    await flush();

    expect(a.leaseExpiresAt).toEqual(lapsed);
    judge.resolve();
    expect(await running).toBe('cancelled');
  });

  it('once taken over, the old run writes nothing more to the assessment', async () => {
    const slots = Array.from({ length: JUDGES_IN_FLIGHT + 2 }, (_, i) => `judge_${i}`);
    const a = fake.seed({ judges: slots });
    mocks.runJudge.mockImplementation(async (slot: string) => {
      // Another run takes the assessment over while the first wave is out.
      Object.assign(a, { leaseToken: 'new-run' });
      return reply(slot);
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('lease_lost');

    // The first wave lands; no further judge starts.
    expect(mocks.runJudge).toHaveBeenCalledTimes(JUDGES_IN_FLIGHT);
    expect(a).toMatchObject({ status: 'RUNNING', leaseToken: 'new-run', result: null });
    // Its judges landed after the takeover, so none is stored over the new run's.
    expect(runsOf(a.id)).toHaveLength(0);
  });

  it('a judge that lands after a takeover leaves the new run’s row as it is', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    mocks.runJudge.mockImplementation(async (slot: string) => {
      // The new run claims it, and its judge_a lands first.
      Object.assign(a, { leaseToken: 'new-run' });
      fake.judgeRuns.push({
        id: 'theirs',
        assessmentId: a.id,
        judge: 'judge_a',
        status: 'SUCCEEDED',
        output: { from: 'new-run' },
        costUsd: 0.05,
      });
      return reply(slot);
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('lease_lost');
    expect(runsOf(a.id)).toEqual([
      expect.objectContaining({ id: 'theirs', output: { from: 'new-run' }, costUsd: 0.05 }),
    ]);
  });
});

describe('the concurrency limits', () => {
  it(`keeps at most ${JUDGES_IN_FLIGHT} judges in flight within one run`, async () => {
    const slots = Array.from({ length: 9 }, (_, i) => `judge_${i}`);
    const a = fake.seed({ judges: slots });
    let inFlight = 0;
    let most = 0;
    mocks.runJudge.mockImplementation(async (slot: string) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await flush();
      inFlight -= 1;
      return reply(slot);
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('completed');
    expect(most).toBe(JUDGES_IN_FLIGHT);
    expect(runsOf(a.id)).toHaveLength(9);
  });

  it('leaves a fourth assessment QUEUED while three run in the workspace', async () => {
    const live = { status: 'RUNNING', leaseExpiresAt: new Date(Date.now() + 30_000), attempts: 1 };
    for (const n of [1, 2, 3]) fake.seed({ ...live, leaseToken: `run-${n}` });
    const fourth = fake.seed();

    expect(await inOrg(() => runAssessment(String(fourth.id)))).toBe('not_claimed');
    expect(fourth).toMatchObject({ status: 'QUEUED', attempts: 0 });
  });

  it('starts the next queued assessment when a run ends, without the recovery job', async () => {
    const live = { status: 'RUNNING', leaseExpiresAt: new Date(Date.now() + 30_000), attempts: 1 };
    fake.seed({ ...live, leaseToken: 'run-1' });
    fake.seed({ ...live, leaseToken: 'run-2' });
    const first = fake.seed({ judges: ['judge_a'] });
    const queued = fake.seed({ judges: ['judge_a'] });

    // The first takes the last place; the second is left queued at the limit.
    const gate = deferred();
    mocks.runJudge.mockImplementationOnce(async (slot: string) => {
      await gate.promise;
      return reply(slot);
    });
    const running = inOrg(() => runAssessment(String(first.id)));
    await flush();
    expect(await inOrg(() => runAssessment(String(queued.id)))).toBe('not_claimed');

    gate.resolve();
    expect(await running).toBe('completed');
    await settle();
    expect(queued).toMatchObject({ status: 'COMPLETED', attempts: 1 });
  });

  it('counts only this workspace’s runs, and only live leases', async () => {
    const live = { status: 'RUNNING', leaseExpiresAt: new Date(Date.now() + 30_000), attempts: 1 };
    for (const n of [1, 2, 3]) fake.seed({ ...live, orgId: 'org-b', leaseToken: `b-${n}` });
    fake.seed({ status: 'RUNNING', leaseExpiresAt: new Date(Date.now() - 1), attempts: 1 });
    const mine = fake.seed({ judges: ['judge_a'] });

    expect(await inOrg(() => runAssessment(String(mine.id)))).toBe('completed');
  });
});

describe('the budget, checked again as the review is claimed (t-53)', () => {
  const figures = {
    estimateUsd: 1,
    basis: 'profile',
    remainingUsd: 0.5,
    inFlightUsd: 1,
    limitUsd: 10,
    usagePage: '/usage',
  };
  const refusal = {
    code: 'BUDGET_EXCEEDED',
    reason: 'This review would cost about $1.00, more than the $0.50 left.',
    message: 'This review would cost about $1.00, more than the $0.50 left. See /usage.',
    details: figures,
  };

  it('finishes a review that would now pass the budget FAILED, with the refusal, calling no judge', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_b'], profile: 'full' });
    mocks.budgetRefusal.mockResolvedValueOnce(refusal);

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('failed');

    // Named as the review being claimed, so only reviews created before it are held back.
    expect(mocks.budgetRefusal).toHaveBeenCalledWith(ORG, 'full', 2, {
      id: a.id,
      createdAt: a.createdAt,
    });
    expect(mocks.runJudge).not.toHaveBeenCalled();
    expect(mocks.runEditor).not.toHaveBeenCalled();
    expect(engine.quickScan).not.toHaveBeenCalled();
    expect(a).toMatchObject({
      status: 'FAILED',
      error: refusal.reason,
      errorCode: 'BUDGET_EXCEEDED',
      errorDetails: figures,
      costUsd: 0,
      result: null,
      startedAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    expect(a.completedAt).toBeInstanceOf(Date);
    expect(runsOf(a.id)).toEqual([]);
  });

  it('runs a review that still fits as before', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_b'] });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('completed');

    expect(mocks.budgetRefusal).toHaveBeenCalledTimes(1);
    expect(mocks.runJudge.mock.calls.map((c) => c[0])).toEqual(['judge_a', 'judge_b']);
    expect(a).toMatchObject({
      status: 'COMPLETED',
      error: null,
      errorCode: null,
      errorDetails: null,
    });
  });

  it('does not check a re-drive that already has judge runs, whose spend a refusal would throw away', async () => {
    const a = fake.seed(
      { judges: ['judge_a', 'judge_b'], status: 'RUNNING', attempts: 1, costUsd: 0.01 },
      [{ judge: 'judge_a', status: 'SUCCEEDED', costUsd: 0.01, output: { from: 'judge_a' } }]
    );
    mocks.budgetRefusal.mockResolvedValue(refusal);

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('completed');

    expect(mocks.budgetRefusal).not.toHaveBeenCalled();
    expect(mocks.runJudge.mock.calls.map((c) => c[0])).toEqual(['judge_b']);
  });

  it('frees the place it was claimed into, so the next queued review starts', async () => {
    const live = { status: 'RUNNING', leaseExpiresAt: new Date(Date.now() + 30_000), attempts: 1 };
    fake.seed({ ...live, leaseToken: 'run-1' });
    fake.seed({ ...live, leaseToken: 'run-2' });
    const refused = fake.seed({ judges: ['judge_a'] });
    const next = fake.seed({ judges: ['judge_a'] });
    mocks.budgetRefusal.mockResolvedValueOnce(refusal);

    expect(await inOrg(() => runAssessment(String(refused.id)))).toBe('failed');
    await settle();

    expect(refused).toMatchObject({ status: 'FAILED', errorCode: 'BUDGET_EXCEEDED' });
    expect(next).toMatchObject({ status: 'COMPLETED', attempts: 1 });
  });
});

describe('the recovery job', () => {
  it('skips a stalled assessment it cannot claim, at the time it is given', async () => {
    const live = { status: 'RUNNING', leaseExpiresAt: new Date(Date.now() + 30_000), attempts: 1 };
    for (const n of [1, 2, 3]) fake.seed({ ...live, leaseToken: `run-${n}` });
    // The workspace is full, so the queued one is left for a later pass.
    const queued = fake.seed();
    expect(await inOrg(() => recoverAssessments(new Date()))).toEqual({
      redriven: 0,
      gaveUp: 0,
      chargedCancelled: 0,
    });
    expect(queued).toMatchObject({ status: 'QUEUED', attempts: 0 });
  });

  it('clears this workspace’s dead running places (t-28), and no live or other one', async () => {
    const dead = new Date(Date.now() - 1);
    const later = new Date(Date.now() + 30_000);
    fake.places.push(
      { id: 'dead', orgId: ORG, leaseExpiresAt: dead },
      { id: 'live', orgId: ORG, leaseExpiresAt: later },
      { id: 'theirs', orgId: 'org-b', leaseExpiresAt: dead }
    );
    await inOrg(() => recoverAssessments());
    expect(fake.places.map((p) => p.id)).toEqual(['live', 'theirs']);
  });

  /** A population with one of each case the job decides about. */
  function population() {
    const expired = new Date(Date.now() - 5_000);
    return {
      // Its run died after two of three judges landed: only judge_c is missing.
      died: fake.seed(
        {
          judges: ['judge_a', 'judge_b', 'judge_c'],
          status: 'RUNNING',
          leaseToken: 'dead',
          leaseExpiresAt: expired,
          attempts: 1,
          costUsd: 0.01, // judge_a's, added when it was saved
        },
        [
          { judge: 'judge_a', status: 'SUCCEEDED', output: { from: 'judge_a' }, costUsd: 0.01 },
          { judge: 'judge_b', status: 'FAILED', errorCode: 'malformed' },
        ]
      ),
      // Queued, and never started.
      queued: fake.seed({ judges: ['judge_a'] }),
      // Out of attempts.
      spent: fake.seed({
        status: 'RUNNING',
        leaseToken: 'dead',
        leaseExpiresAt: expired,
        attempts: 3,
      }),
      // Held by a live run.
      held: fake.seed({
        status: 'RUNNING',
        leaseToken: 'alive',
        leaseExpiresAt: new Date(Date.now() + 60_000),
        attempts: 1,
      }),
      // Final.
      done: fake.seed({ status: 'COMPLETED', result: { kept: true } }),
      // Another workspace's.
      theirs: fake.seed({
        orgId: 'org-b',
        status: 'RUNNING',
        leaseToken: 'dead',
        leaseExpiresAt: expired,
        attempts: 1,
      }),
    };
  }

  it('re-drives expired runs, rerunning only the missing judges, and gives up after three attempts', async () => {
    const p = population();

    expect(await inOrg(() => recoverAssessments())).toEqual({
      redriven: 2,
      gaveUp: 1,
      chargedCancelled: 0,
    });
    await settle();

    // Only judge_c was called for the run that died; judge_a's output was reused.
    expect(
      mocks.runJudge.mock.calls.filter((c) => c[1].assessmentId === p.died.id).map((c) => c[0])
    ).toEqual(['judge_c']);
    expect(p.died).toMatchObject({
      status: 'PARTIAL', // judge_b's earlier failure stands
      attempts: 2,
      result: { judged: ['judge_a', 'judge_c'] },
      costUsd: 0.02,
    });
    expect(p.queued).toMatchObject({ status: 'COMPLETED', attempts: 1 });
    expect(p.spent).toMatchObject({ status: 'FAILED', leaseToken: null });
    expect(p.spent.error).toMatch(/3 times/);
    expect(p.held).toMatchObject({ status: 'RUNNING', leaseToken: 'alive', attempts: 1 });
    expect(p.done).toMatchObject({ status: 'COMPLETED', result: { kept: true } });
    expect(p.theirs).toMatchObject({ status: 'RUNNING', leaseToken: 'dead', attempts: 1 });
  });

  it('is idempotent: a second pass over the same population changes nothing', async () => {
    population();
    await inOrg(() => recoverAssessments());
    await settle();
    const calls = mocks.runJudge.mock.calls.length;
    const snapshot = structuredClone({ a: fake.assessments, r: fake.judgeRuns });

    expect(await inOrg(() => recoverAssessments())).toEqual({
      redriven: 0,
      gaveUp: 0,
      chargedCancelled: 0,
    });

    expect(mocks.runJudge).toHaveBeenCalledTimes(calls);
    expect({ a: fake.assessments, r: fake.judgeRuns }).toEqual(snapshot);
  });

  it('never starts more runs than the workspace’s limit allows', async () => {
    for (let n = 0; n < 5; n += 1) fake.seed({ judges: ['judge_a'] });
    let running = 0;
    let most = 0;
    mocks.runJudge.mockImplementation(async (slot: string) => {
      running += 1;
      most = Math.max(most, running);
      await flush();
      running -= 1;
      return reply(slot);
    });

    const first = await inOrg(() => recoverAssessments());
    expect(first.redriven).toBe(3);
    expect(fake.assessments.filter((a) => a.status === 'QUEUED')).toHaveLength(2);
    await settle();
    expect(most).toBeLessThanOrEqual(3);
  });

  it('does not wait for the runs it starts', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    const gate = deferred();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      await gate.promise;
      return reply(slot);
    });

    expect(await inOrg(() => recoverAssessments())).toEqual({
      redriven: 1,
      gaveUp: 0,
      chargedCancelled: 0,
    });
    expect(a.status).toBe('RUNNING');

    gate.resolve();
    await settle();
    expect(a.status).toBe('COMPLETED');
  });

  it('runs a judge again whose earlier failure was the moment’s, keeping what it cost', async () => {
    const a = fake.seed(
      {
        judges: ['judge_a', 'judge_b'],
        status: 'RUNNING',
        leaseToken: 'dead',
        leaseExpiresAt: new Date(Date.now() - 5_000),
        attempts: 1,
        costUsd: 0.014,
      },
      [
        { judge: 'judge_a', status: 'SUCCEEDED', output: { from: 'judge_a' }, costUsd: 0.01 },
        {
          judge: 'judge_b',
          status: 'FAILED',
          errorCode: 'provider_error',
          provider: 'openai',
          modelName: 'gpt-4.1',
          attempts: 1,
          tokens: { input: 80, output: 0 },
          costUsd: 0.004,
        },
      ]
    );

    await inOrg(() => recoverAssessments());
    await settle();

    expect(mocks.runJudge.mock.calls.map((c) => c[0])).toEqual(['judge_b']);
    expect(a).toMatchObject({ status: 'COMPLETED', result: { judged: ['judge_a', 'judge_b'] } });
    expect(a.costUsd).toBeCloseTo(0.024);
    // Its row counts both runs' attempts and tokens, as its cost does.
    expect(runsOf(a.id).find((r) => r.judge === 'judge_b')).toMatchObject({
      status: 'SUCCEEDED',
      errorCode: null,
      attempts: 2,
      tokens: { input: 180, output: 20 },
    });
    expect(runsOf(a.id).find((r) => r.judge === 'judge_b')?.costUsd).toBeCloseTo(0.014);
  });

  it('fails on its last attempt with the reason, not leaving it queued', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    mocks.runJudge.mockRejectedValue(new Error('connection reset'));
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('requeued');
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('requeued');
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('failed');
    expect(a).toMatchObject({ status: 'FAILED', attempts: 3, leaseToken: null });
    expect(a.error).toMatch(/not a judge/);
    expect(a.completedAt).toEqual(expect.any(Date));
  });
});

describe('a succeeded judge whose reply is gone (t-26)', () => {
  it('is counted as failed on a re-drive, not called again, so nothing is billed twice', async () => {
    // The purge never deletes a live run's replies; this is the guard if one goes anyway.
    const a = fake.seed(
      {
        status: 'RUNNING',
        leaseToken: 'dead',
        leaseExpiresAt: new Date(Date.now() - 5_000),
        attempts: 1,
        judges: ['judge_a', 'judge_b'],
      },
      [{ judge: 'judge_a', status: 'SUCCEEDED', costUsd: 0.01 }]
    );

    expect(await inOrg(() => recoverAssessments())).toEqual({
      redriven: 1,
      gaveUp: 0,
      chargedCancelled: 0,
    });
    await settle();

    expect(mocks.runJudge.mock.calls.map((c) => c[0])).toEqual(['judge_b']);
    expect(a).toMatchObject({ status: 'PARTIAL', result: { judged: ['judge_b'] } });
  });
});

describe('edges of the run', () => {
  const conflict = () =>
    new Prisma.PrismaClientKnownRequestError('could not serialize access', {
      code: 'P2034',
      clientVersion: 'test',
    });

  it('retries a claim that lost a serialization conflict', async () => {
    const a = fake.seed({ judges: [] });
    fake.db.$transaction.mockRejectedValueOnce(conflict());
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('completed');
    // The claim, twice: the finish's own transaction is not a claim.
    const claims = fake.db.$transaction.mock.calls.filter(
      (call: unknown[]) =>
        (call[1] as { isolationLevel?: string } | undefined)?.isolationLevel === 'Serializable'
    );
    expect(claims).toHaveLength(2);
  });

  it('leaves the assessment queued after three conflicts in a row', async () => {
    const a = fake.seed();
    fake.db.$transaction.mockRejectedValue(conflict());
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('not_claimed');
    expect(fake.db.$transaction).toHaveBeenCalledTimes(3);
    expect(a).toMatchObject({ status: 'QUEUED', attempts: 0 });
  });

  it('leaves the assessment as it was on any other claim error, and logs it', async () => {
    const a = fake.seed();
    fake.db.$transaction.mockRejectedValueOnce(new Error('connection refused'));
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('not_claimed');
    expect(fake.db.$transaction).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ status: 'QUEUED', attempts: 0 });
    expect(logger.error).toHaveBeenCalledWith(
      'Assessment claim failed',
      expect.any(Error),
      expect.objectContaining({ assessmentId: a.id })
    );
  });

  it('does not claim another workspace’s assessment', async () => {
    const theirs = fake.seed({ orgId: 'org-b', judges: ['judge_a'] });
    expect(await inOrg(() => runAssessment(String(theirs.id)))).toBe('not_claimed');
    expect(theirs).toMatchObject({ status: 'QUEUED', attempts: 0 });
    expect(mocks.runJudge).not.toHaveBeenCalled();
  });

  it('clears an earlier run’s note when it is claimed again', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    mocks.runJudge.mockRejectedValueOnce(new Error('connection reset'));
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('requeued');
    expect(a.error).toMatch(/not a judge/);

    // While the next run is out, the note is gone: were its process killed
    // now, the give-up would not report the first run's reason.
    const gate = deferred();
    mocks.runJudge.mockImplementationOnce(async (slot: string) => {
      await gate.promise;
      return reply(slot);
    });
    const next = inOrg(() => runAssessment(String(a.id)));
    await flush();
    expect(a).toMatchObject({ status: 'RUNNING', error: null, attempts: 2 });
    gate.resolve();
    expect(await next).toBe('completed');
  });

  it('does not claim an assessment that has had its three runs', async () => {
    const a = fake.seed({
      status: 'RUNNING',
      attempts: 3,
      leaseExpiresAt: new Date(Date.now() - 1),
    });
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('not_claimed');
    expect(a.attempts).toBe(3);
  });

  it('stores no overall score or band when the result carries none', async () => {
    const a = fake.seed({ judges: [] });
    engine.assemble.mockReturnValueOnce({ judged: [], quick: true } as never);
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('completed');
    expect(a).toMatchObject({ status: 'COMPLETED', overall: null, band: null });
  });

  it('enters a privacy scope with no user for an assessment nobody signed in for', async () => {
    const a = fake.seed({ judges: ['judge_a'], createdByUserId: null });
    let seen: ReturnType<typeof currentPrivacyScope>;
    mocks.runJudge.mockImplementation(async (slot: string) => {
      seen = currentPrivacyScope();
      return reply(slot);
    });
    await inOrg(() => runAssessment(String(a.id)));
    expect(seen).toBeDefined();
    expect(seen).not.toHaveProperty('userId');
  });

  it('answers lease_lost when another run takes over while the result is assembled', async () => {
    const a = fake.seed({ judges: [] });
    engine.assemble.mockImplementationOnce(() => {
      Object.assign(a, { leaseToken: 'new-run' });
      return { scores: { overall: 40, band: 'mixed' }, judged: [], quick: true };
    });
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('lease_lost');
    expect(a).toMatchObject({ status: 'RUNNING', leaseToken: 'new-run', result: null });
  });

  it('stops starting judges once a renewal finds the lease gone', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const slots = Array.from({ length: JUDGES_IN_FLIGHT + 2 }, (_, i) => `judge_${i}`);
    const a = fake.seed({ judges: slots });
    const gate = deferred();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      await gate.promise;
      return reply(slot);
    });

    const running = inOrg(() => runAssessment(String(a.id)));
    await flush();
    // Taken over, then put back: only the renewal saw it go.
    const token = a.leaseToken;
    Object.assign(a, { leaseToken: 'other' });
    vi.advanceTimersByTime(LEASE_RENEW_MS);
    await flush();
    Object.assign(a, { leaseToken: token });
    gate.resolve();

    expect(await running).toBe('lease_lost');
    expect(mocks.runJudge).toHaveBeenCalledTimes(JUDGES_IN_FLIGHT);
  });

  it('logs a renewal that fails, and carries on', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const a = fake.seed({ judges: ['judge_a'] });
    const gate = deferred();
    mocks.runJudge.mockImplementation(async (slot: string) => {
      await gate.promise;
      return reply(slot);
    });

    const running = inOrg(() => runAssessment(String(a.id)));
    await flush();
    fake.db.assessment.updateMany.mockRejectedValueOnce(new Error('timeout'));
    vi.advanceTimersByTime(LEASE_RENEW_MS);
    await flush();
    gate.resolve();

    expect(await running).toBe('completed');
    expect(logger.warn).toHaveBeenCalledWith('Assessment lease renewal failed', {
      assessmentId: a.id,
      error: 'timeout',
    });
  });

  it('answers lease_lost when the row is gone after the claim', async () => {
    const a = fake.seed();
    const real = fake.db.assessment.findUnique.getMockImplementation();
    // The claim's read sees it; the run's read does not.
    fake.db.assessment.findUnique.mockImplementationOnce(real as never).mockResolvedValueOnce(null);
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('lease_lost');
    expect(mocks.runJudge).not.toHaveBeenCalled();
  });
});

describe('the charge in CopyCredits (t-58)', () => {
  /** Each judge call writes its cost row, as `runJudge` does, naming the review. */
  function billing(costUsd = 0.0123) {
    mocks.runJudge.mockImplementation(async (slot: string, input: { assessmentId?: string }) => {
      fake.addCost(ORG, costUsd, { assessmentId: input.assessmentId, judge: slot });
      return reply(slot);
    });
  }

  const charges = () => fake.credits.filter((c) => c.kind === 'CHARGE');
  const chargeOf = (a: Row) => ({
    orgId: ORG,
    kind: 'CHARGE',
    reference: `assessment:${String(a.id)}`,
  });

  it('charges a completed review once, for its cost rows rounded up to a whole credit', async () => {
    billing(0.0123);
    const a = fake.seed({ judges: ['judge_a', 'judge_b'] });
    // Another review's row and another workspace's: neither is this review's.
    fake.addCost(ORG, 5, { assessmentId: 'someone-else' });
    fake.addCost('org-b', 5, { assessmentId: a.id });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('completed');

    // $0.0246 is 2.46 credits: 3.
    expect(charges()).toEqual([expect.objectContaining({ ...chargeOf(a), amount: -3 })]);
  });

  it('charges a partial review for every billed call, the failed judge’s included', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_b'] });
    mocks.runJudge.mockImplementation(async (slot: string, input: { assessmentId?: string }) => {
      fake.addCost(ORG, 0.02, { assessmentId: input.assessmentId, judge: slot });
      if (slot === 'judge_b') throw new JudgeRunError('refused', 'no');
      return reply(slot);
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('partial');
    expect(charges()).toEqual([expect.objectContaining({ ...chargeOf(a), amount: -4 })]);
  });

  it('charges a review that failed after its judges were billed', async () => {
    billing(0.05);
    const a = fake.seed({ judges: ['judge_a'] });
    engine.assemble.mockImplementationOnce(() => {
      throw new Error('cannot score');
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('failed');
    expect(charges()).toEqual([expect.objectContaining({ ...chargeOf(a), amount: -5 })]);
  });

  it('charges a review that stopped on its last attempt for every attempt’s rows', async () => {
    const a = fake.seed({ judges: ['judge_a'], attempts: 2 });
    // An earlier attempt's spend.
    fake.addCost(ORG, 0.03, { assessmentId: a.id, judge: 'judge_a' });
    mocks.runJudge.mockImplementation(async (slot: string, input: { assessmentId?: string }) => {
      fake.addCost(ORG, 0.03, { assessmentId: input.assessmentId, judge: slot });
      throw new Error('database gone');
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('failed');
    expect(charges()).toEqual([expect.objectContaining({ ...chargeOf(a), amount: -6 })]);
  });

  it('charges a re-queued review nothing until it ends, then everything once', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    mocks.runJudge.mockImplementationOnce(
      async (slot: string, input: { assessmentId?: string }) => {
        fake.addCost(ORG, 0.03, { assessmentId: input.assessmentId, judge: slot });
        throw new Error('database gone');
      }
    );

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('requeued');
    expect(charges()).toEqual([]);

    billing(0.03);
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('completed');
    expect(charges()).toEqual([expect.objectContaining({ ...chargeOf(a), amount: -6 })]);
  });

  it('charges a cancelled run once its judges in flight have landed, for all of them', async () => {
    const a = fake.seed({ judges: ['judge_a', 'judge_b'] });
    mocks.runJudge.mockImplementation(async (slot: string, input: { assessmentId?: string }) => {
      if (slot === 'judge_a') {
        await inOrg(() => cancelAssessment(String(a.id)));
        // Cancelled, with this judge still to land: not charged yet.
        expect(charges()).toEqual([]);
      }
      fake.addCost(ORG, 0.04, { assessmentId: input.assessmentId, judge: slot });
      return reply(slot);
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('cancelled');
    expect(charges()).toEqual([expect.objectContaining({ ...chargeOf(a), amount: -8 })]);
    expect(a.leaseExpiresAt).toBeNull();
  });

  it('charges a cancel with no run to finish it as it cancels, for what earlier runs spent', async () => {
    const a = fake.seed({ status: 'QUEUED', attempts: 1, judges: ['judge_a'] });
    fake.addCost(ORG, 0.011, { assessmentId: a.id, judge: 'judge_a' });

    expect(await inOrg(() => cancelAssessment(String(a.id)))).toBe(true);

    expect(a).toMatchObject({ status: 'CANCELLED', leaseExpiresAt: null });
    expect(charges()).toEqual([expect.objectContaining({ ...chargeOf(a), amount: -2 })]);
  });

  it('leaves a cancel with a live run to that run, charging nothing yet', async () => {
    const a = fake.seed({
      status: 'RUNNING',
      leaseToken: 'alive',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    fake.addCost(ORG, 0.02, { assessmentId: a.id });

    expect(await inOrg(() => cancelAssessment(String(a.id)))).toBe(true);
    expect(a.leaseToken).toBe('alive');
    expect(charges()).toEqual([]);
  });

  it('the recovery job charges a cancelled review whose run died, once', async () => {
    const a = fake.seed({
      status: 'CANCELLED',
      leaseToken: 'dead',
      leaseExpiresAt: new Date(Date.now() - 5_000),
      completedAt: new Date(Date.now() - 60_000),
    });
    fake.addCost(ORG, 0.02, { assessmentId: a.id });
    // Cancelled long before reviews were charged: left alone.
    const old = fake.seed({
      status: 'CANCELLED',
      leaseToken: 'dead',
      leaseExpiresAt: new Date(Date.now() - 5_000),
      completedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });
    fake.addCost(ORG, 0.02, { assessmentId: old.id });

    expect(await inOrg(() => recoverAssessments())).toEqual({
      redriven: 0,
      gaveUp: 0,
      chargedCancelled: 1,
    });
    expect(await inOrg(() => recoverAssessments())).toEqual({
      redriven: 0,
      gaveUp: 0,
      chargedCancelled: 0,
    });
    expect(charges()).toEqual([expect.objectContaining({ ...chargeOf(a), amount: -2 })]);
    expect(a.leaseExpiresAt).toBeNull();
  });

  it('the recovery job charges a review it gives up on, in the write that gives up', async () => {
    const a = fake.seed({
      status: 'RUNNING',
      leaseToken: 'dead',
      leaseExpiresAt: new Date(Date.now() - 5_000),
      attempts: 3,
    });
    fake.addCost(ORG, 0.07, { assessmentId: a.id });

    expect(await inOrg(() => recoverAssessments())).toMatchObject({ gaveUp: 1 });
    expect(a.status).toBe('FAILED');
    expect(charges()).toEqual([expect.objectContaining({ ...chargeOf(a), amount: -7 })]);
  });

  it('a recovered review is charged once, for its first attempt’s rows and the re-drive’s', async () => {
    billing(0.01);
    const a = fake.seed(
      {
        status: 'RUNNING',
        leaseToken: 'dead',
        leaseExpiresAt: new Date(Date.now() - 5_000),
        attempts: 1,
        judges: ['judge_a', 'judge_b'],
      },
      [{ judge: 'judge_a', status: 'FAILED', errorCode: 'rate_limited', costUsd: 0.01 }]
    );
    fake.addCost(ORG, 0.01, { assessmentId: a.id, judge: 'judge_a' });

    expect(await inOrg(() => recoverAssessments())).toMatchObject({ redriven: 1 });
    await settle();
    // A second pass finds it final and charges nothing more.
    await inOrg(() => recoverAssessments());

    expect(a.status).toBe('COMPLETED');
    expect(charges()).toEqual([expect.objectContaining({ ...chargeOf(a), amount: -3 })]);
  });

  it('charges a review deleted while its run went on, from its rows', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    mocks.runJudge.mockImplementation(async (slot: string, input: { assessmentId?: string }) => {
      fake.addCost(ORG, 0.05, { assessmentId: input.assessmentId, judge: slot });
      fake.assessments.splice(fake.assessments.indexOf(a), 1);
      return reply(slot);
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('lease_lost');
    expect(charges()).toEqual([expect.objectContaining({ ...chargeOf(a), amount: -5 })]);
  });

  it('charges a run that lost its lease nothing: the run that has it charges as it ends', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    mocks.runJudge.mockImplementation(async (slot: string, input: { assessmentId?: string }) => {
      fake.addCost(ORG, 0.05, { assessmentId: input.assessmentId, judge: slot });
      Object.assign(a, { leaseToken: 'successor' });
      return reply(slot);
    });

    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('lease_lost');
    expect(charges()).toEqual([]);
  });

  it('charges nothing for a review that spent nothing, or was refused before any judge', async () => {
    const quick = fake.seed({ judges: [] });
    expect(await inOrg(() => runAssessment(String(quick.id)))).toBe('completed');

    const refused = fake.seed({ judges: ['judge_a'] });
    mocks.budgetRefusal.mockResolvedValueOnce({
      code: 'INSUFFICIENT_CREDITS',
      reason: 'No CopyCredits left.',
      message: 'No CopyCredits left.',
      details: {
        estimateCredits: 1,
        basis: 'none',
        balanceCredits: 0,
        heldCredits: 0,
        remainingCredits: 0,
        usagePage: '/usage',
      },
    });
    expect(await inOrg(() => runAssessment(String(refused.id)))).toBe('failed');

    expect(refused).toMatchObject({ errorCode: 'INSUFFICIENT_CREDITS' });
    expect(charges()).toEqual([]);
  });
});

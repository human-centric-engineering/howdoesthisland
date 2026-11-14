/**
 * Tests: the assessment job (t-22) — runAssessment, cancelAssessment and the
 * recovery job, over a stateful in-memory store.
 *
 * Mocked: Prisma (the fake in `fake-db.ts`, so every assertion is on the rows
 * a run leaves), the engine (a stub whose `assemble` reports which judges'
 * outputs it was given) and `runJudge` (scripted per slot). Real: the fan-out,
 * the lease and claim logic, the tenant context and the privacy scope.
 *
 * The load-bearing chain is job → runJudge → JudgeRun row: each test drives
 * the job and reads the rows, never the job's internals.
 *
 * @see lib/app/assessments/run.ts · lib/app/assessments/recover.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, type FakeDb, type Row } from '@/tests/unit/lib/app/assessments/fake-db';

const mocks = vi.hoisted(() => ({
  runJudge: vi.fn(),
  engineForVersion: vi.fn(),
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

import { JUDGES_IN_FLIGHT, LEASE_MS, LEASE_RENEW_MS } from '@/lib/app/assessments/limits';
import { recoverAssessments } from '@/lib/app/assessments/recover';
import { cancelAssessment, runAssessment } from '@/lib/app/assessments/run';
import { JudgeRunError } from '@/lib/app/judges/run-judge';
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
        output: { from: 'judge_a' },
        dropped: [{ at: 'highlights[0]', reason: 'quote_not_found' }],
      }),
      expect.objectContaining({ judge: 'judge_b', status: 'SUCCEEDED' }),
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

  it('fails the assessment on an error that is not a judge’s, leaving no live lease', async () => {
    const a = fake.seed({ judges: ['judge_a'] });
    mocks.runJudge.mockRejectedValue(new Error('connection reset'));
    expect(await inOrg(() => runAssessment(String(a.id)))).toBe('failed');
    expect(a).toMatchObject({ status: 'FAILED', leaseToken: null });
    expect(a.error).toEqual(expect.any(String));
  });

  it('fails the assessment when its framework version can no longer be run', async () => {
    const a = fake.seed();
    mocks.engineForVersion.mockResolvedValue(null);
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

  it('counts only this workspace’s runs, and only live leases', async () => {
    const live = { status: 'RUNNING', leaseExpiresAt: new Date(Date.now() + 30_000), attempts: 1 };
    for (const n of [1, 2, 3]) fake.seed({ ...live, orgId: 'org-b', leaseToken: `b-${n}` });
    fake.seed({ status: 'RUNNING', leaseExpiresAt: new Date(Date.now() - 1), attempts: 1 });
    const mine = fake.seed({ judges: ['judge_a'] });

    expect(await inOrg(() => runAssessment(String(mine.id)))).toBe('completed');
  });
});

describe('the recovery job', () => {
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
        },
        [
          { judge: 'judge_a', status: 'SUCCEEDED', output: { from: 'judge_a' }, costUsd: 0.01 },
          { judge: 'judge_b', status: 'FAILED', errorCode: 'provider_error' },
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

    expect(await inOrg(() => recoverAssessments())).toEqual({ redriven: 2, gaveUp: 1 });

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
    const calls = mocks.runJudge.mock.calls.length;
    const snapshot = structuredClone({ a: fake.assessments, r: fake.judgeRuns });

    expect(await inOrg(() => recoverAssessments())).toEqual({ redriven: 0, gaveUp: 0 });

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
    expect(most).toBeLessThanOrEqual(3);
    expect(fake.assessments.filter((a) => a.status === 'QUEUED')).toHaveLength(2);
  });
});

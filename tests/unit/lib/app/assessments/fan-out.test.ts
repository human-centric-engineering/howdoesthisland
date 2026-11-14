/**
 * Tests: runJudges, the judge fan-out with no rows (t-22).
 *
 * What the stored job's tests do not cover: the fan-out on its own, as the
 * ephemeral path (t-24) will use it, with no `onLanded` or `shouldContinue`,
 * and an error that is not a judge's.
 *
 * @see lib/app/assessments/fan-out.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ runJudge: vi.fn() }));
vi.mock('@/lib/app/judges/run-judge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/judges/run-judge')>()),
  runJudge: mocks.runJudge,
}));

import { runJudges, type RunJudgesInput } from '@/lib/app/assessments/fan-out';
import type { FrameworkEngine } from '@/lib/app/frameworks/engine';
import { JudgeRunError } from '@/lib/app/judges/run-judge';

const input = (over: Partial<RunJudgesInput> = {}): RunJudgesInput => ({
  engine: {} as FrameworkEngine,
  frameworkVersion: 'howdoesthisland@0.5.1',
  text: 'The text.',
  ctx: { audience: {} },
  slots: ['judge_a', 'judge_b', 'judge_c'],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runJudge.mockImplementation(async (slot: string) => ({ slot, output: { slot } }));
});

describe('runJudges', () => {
  it('runs every slot with no rows and returns what landed', async () => {
    const { landed, stopped } = await runJudges(input());
    expect(stopped).toBe(false);
    expect(landed.map((l) => [l.slot, l.ok])).toEqual([
      ['judge_a', true],
      ['judge_b', true],
      ['judge_c', true],
    ]);
    // No assessment id on an ephemeral run, so its cost rows carry none.
    expect(mocks.runJudge.mock.calls[0][1]).not.toHaveProperty('assessmentId');
  });

  it('records a judge’s failure and carries on with the others', async () => {
    mocks.runJudge.mockImplementation(async (slot: string) => {
      if (slot === 'judge_b') throw new JudgeRunError('refused', 'The provider declined.');
      return { slot, output: {} };
    });
    const { landed } = await runJudges(input());
    expect(landed.find((l) => l.slot === 'judge_b')).toMatchObject({
      ok: false,
      code: 'refused',
      message: 'The provider declined.',
    });
    expect(landed.filter((l) => l.ok)).toHaveLength(2);
  });

  it('rejects on an error that is not a judge’s, after the judges in flight settle', async () => {
    let settled = 0;
    mocks.runJudge.mockImplementation(async (slot: string) => {
      if (slot === 'judge_a') throw new Error('database down');
      await new Promise((r) => setTimeout(r, 5));
      settled += 1;
      return { slot, output: {} };
    });
    await expect(runJudges(input())).rejects.toThrow('database down');
    expect(settled).toBe(2);
  });

  it('rejects when shouldContinue throws, after the judges in flight settle', async () => {
    let settled = 0;
    let asks = 0;
    mocks.runJudge.mockImplementation(async (slot: string) => {
      await new Promise((r) => setTimeout(r, 5));
      settled += 1;
      return { slot, output: {} };
    });
    const run = runJudges(
      input({
        slots: ['judge_a', 'judge_b', 'judge_c', 'judge_d'],
        concurrency: 2,
        shouldContinue: async () => {
          asks += 1;
          // The first two start; the next check's read fails.
          if (asks > 2) throw new Error('database down');
          return true;
        },
      })
    );
    await expect(run).rejects.toThrow('database down');
    expect(settled).toBe(2);
    expect(mocks.runJudge).toHaveBeenCalledTimes(2);
  });

  it('carries what a failed judge was billed onto its landing', async () => {
    const spend = {
      provider: 'openai',
      model: 'gpt-4.1',
      usage: { input: 10, output: 2, attempts: 2 },
      costUsd: 0.002,
    };
    mocks.runJudge.mockImplementation(async () => {
      const err = new JudgeRunError('malformed', 'Not usable, twice.');
      err.spend = spend;
      throw err;
    });
    const { landed } = await runJudges(input({ slots: ['judge_a'] }));
    expect(landed[0]).toMatchObject({ ok: false, code: 'malformed', spend });
  });

  it('is not stopped when the check says no after the last judge was taken', async () => {
    let asks = 0;
    const { landed, stopped } = await runJudges(
      input({
        slots: ['judge_a', 'judge_b'],
        concurrency: 2,
        // The second worker's first check is slow and says no; by then the
        // first worker has taken both judges, so none was left unstarted.
        shouldContinue: async () => {
          asks += 1;
          if (asks !== 2) return true;
          await new Promise((r) => setTimeout(r, 20));
          return false;
        },
      })
    );
    expect(landed.map((l) => l.slot)).toEqual(['judge_a', 'judge_b']);
    expect(stopped).toBe(false);
  });

  it('starts no judge once shouldContinue says no', async () => {
    const { landed, stopped } = await runJudges(
      input({ concurrency: 1, shouldContinue: async () => mocks.runJudge.mock.calls.length < 1 })
    );
    expect(stopped).toBe(true);
    expect(landed.map((l) => l.slot)).toEqual(['judge_a']);
  });
});

/**
 * The calibration runner (t-37): quick mode on the 0.5.1 set, AI mode against
 * stubbed judges, and the service around them (the set checked against the
 * version, the run stored, the comparison with the last run of its mode).
 *
 * The engine and the set are the real ones. `runJudges` is stubbed, so no
 * provider and no database is reached: the runner itself never writes an
 * Assessment, and the stub would be the only way it could.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { runJudges as RunJudges } from '@/lib/app/assessments/fan-out';
import {
  CalibrationError,
  runCalibration,
  scoreSet,
  type RunCalibrationDeps,
} from '@/lib/app/calibration/run';
import { calibrationSetSchema, type CalibrationSet } from '@/lib/app/calibration/schema';
import type { CalibrationStore, NewRun, StoredRun } from '@/lib/app/calibration/store';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import type { StoredVersion } from '@/lib/app/frameworks/repo';

const DATA = 'lib/app/frameworks/howdoesthisland/data';
const model = z.looseObject({}).parse(JSON.parse(readFileSync(`${DATA}/model-0.5.1.json`, 'utf8')));
const set: CalibrationSet = calibrationSetSchema.parse(
  JSON.parse(readFileSync(`${DATA}/eval-0.5.1.json`, 'utf8'))
);
const engine = () => createHowDoesThisLandEngine(model, { culture: true });

const VERSION: StoredVersion = {
  id: 'ver-1',
  frameworkSlug: 'howdoesthisland',
  version: '0.5.1',
  schemaVersion: '1',
  status: 'DRAFT',
  sourceSha256: 'sha-1',
  publishedAt: null,
};

type Landed = Awaited<ReturnType<typeof RunJudges>>['landed'][number];

/** Every judge answers with an empty reply, at a cent, except those in `failing`. */
function stubJudges(failing: readonly string[] = []) {
  return vi.fn<typeof RunJudges>(async (input) => ({
    stopped: false,
    landed: input.slots.map((slot): Landed =>
      failing.includes(slot)
        ? {
            slot,
            ok: false,
            code: 'over_budget',
            message: 'Over budget.',
            latencyMs: 1,
            spend: {
              provider: 'openai',
              model: 'gpt-x',
              usage: { input: 1, output: 0, attempts: 1 },
              costUsd: 0.005,
            },
          }
        : {
            slot,
            ok: true,
            latencyMs: 1,
            reply: {
              slot,
              output: {},
              drops: [],
              provider: 'openai',
              model: slot === 'judge_lenses' ? 'gpt-y' : 'gpt-x',
              usage: { input: 10, output: 5, attempts: 1 },
              costUsd: 0.01,
              costLogIds: ['cost-1'],
              finishReason: 'stop',
            },
          }
    ),
  }));
}

describe('scoreSet() in quick mode', () => {
  it('scores every case of the 0.5.1 set, the same way every time', async () => {
    const input = {
      engine: engine(),
      cases: set.cases,
      mode: 'quick' as const,
      frameworkVersion: 'howdoesthisland@0.5.1',
      runId: 'r',
    };
    const first = await scoreSet(input);
    const second = await scoreSet(input);
    expect(first.rows.map((r) => r.case)).toEqual(set.cases.map((c) => c.id));
    expect(first.totals.cases).toBe(26);
    expect(first.totals.byKind.lever.n).toBeGreaterThan(0);
    expect(first.totals.byKind.group.n).toBeGreaterThan(0);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ costUsd: 0, judgeModels: {} });
    expect(first.totals.judgeFailures).toBe(0);
  });
});

describe('scoreSet() in ai mode', () => {
  const run = (runJudges: typeof RunJudges) =>
    scoreSet({
      engine: engine(),
      cases: set.cases.slice(0, 2),
      mode: 'ai',
      frameworkVersion: 'howdoesthisland@0.5.1',
      runId: 'cal-1',
      startedByUserId: 'user-1',
      runJudges,
    });

  it('runs all nine judges per case, ephemeral, tagged with the run, and no assessment', async () => {
    const judges = stubJudges();
    await run(judges);
    expect(judges).toHaveBeenCalledTimes(2);
    const call = judges.mock.calls[0][0];
    expect(call.slots).toHaveLength(9);
    expect(call).toMatchObject({
      ephemeral: true,
      costTags: { calibrationRunId: 'cal-1' },
      userId: 'user-1',
      frameworkVersion: 'howdoesthisland@0.5.1',
      text: set.cases[0].text,
    });
    expect(call).not.toHaveProperty('assessmentId');
    expect(call).not.toHaveProperty('onLanded');
  });

  it('records what the judges cost and the model each answered with', async () => {
    const scored = await run(stubJudges());
    // 2 cases × 9 judges × $0.01.
    expect(scored.costUsd).toBe(0.18);
    expect(scored.judgeModels.judge_ethos).toEqual(['openai/gpt-x']);
    expect(scored.judgeModels.judge_lenses).toEqual(['openai/gpt-y']);
    expect(Object.keys(scored.judgeModels)).toHaveLength(9);
    expect(scored.totals.judgeFailures).toBe(0);
  });

  it('counts a failed judge, and what it was billed, and still scores the case', async () => {
    const scored = await run(stubJudges(['judge_culture']));
    expect(scored.totals.judgeFailures).toBe(2);
    expect(scored.rows[0].judgeFailures).toEqual([{ slot: 'judge_culture', code: 'over_budget' }]);
    expect(scored.rows[0].checks.length).toBeGreaterThan(0);
    expect(scored.costUsd).toBe(0.17);
    expect(scored.judgeModels).not.toHaveProperty('judge_culture');
  });

  it('counts a judge the fan-out never started as a failure', async () => {
    const judges = vi.fn<typeof RunJudges>(async () => ({ stopped: true, landed: [] }));
    const scored = await run(judges);
    expect(scored.totals.judgeFailures).toBe(18);
    expect(scored.rows[0].judgeFailures[0]).toEqual({ slot: 'judge_ethos', code: 'not_run' });
  });
});

function fakeStore(previous: StoredRun | null = null) {
  const created: NewRun[] = [];
  const store: CalibrationStore = {
    createRun: vi.fn(async (run: NewRun) => {
      created.push(run);
      return {
        ...run,
        createdAt: new Date('2026-11-16T12:00:00Z'),
        frameworkVersion: '0.5.1',
      };
    }),
    latestRun: vi.fn(async () => previous),
    aiRunsOf: vi.fn(async () => []),
  };
  return { store, created };
}

function deps(store: CalibrationStore, runJudges = stubJudges()) {
  const scopes: string[] = [];
  const d: RunCalibrationDeps = {
    store,
    runJudges,
    runAsInstallOrg: async (fn) => {
      scopes.push('install');
      return fn();
    },
  };
  return { d, scopes };
}

describe('runCalibration()', () => {
  it('stores a quick run of the version, and compares it with nothing the first time', async () => {
    const { store, created } = fakeStore();
    const { d, scopes } = deps(store);
    const out = await runCalibration({ version: VERSION, model, set, mode: 'quick' }, d);

    expect(scopes).toEqual(['install']);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      frameworkVersionId: 'ver-1',
      sourceSha256: 'sha-1',
      setVersion: '0.5.1',
      mode: 'quick',
      costUsd: 0,
      startedByUserId: null,
    });
    expect(created[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.latestRun).toHaveBeenCalledWith({
      frameworkSlug: 'howdoesthisland',
      mode: 'quick',
    });
    expect(out.comparison).toBeNull();
  });

  it('compares a run with the last run of its mode', async () => {
    const first = fakeStore();
    await runCalibration({ version: VERSION, model, set, mode: 'quick' }, deps(first.store).d);
    const prior = first.created[0];
    const previous: StoredRun = {
      ...prior,
      id: 'run-0',
      createdAt: new Date('2026-11-15T12:00:00Z'),
      frameworkVersion: '0.5.0',
      // A point of agreement below what this run will get.
      totals: { ...prior.totals, agreement: prior.totals.agreement - 0.01 },
    };
    const { store } = fakeStore(previous);
    const out = await runCalibration(
      { version: VERSION, model, set, mode: 'quick' },
      deps(store).d
    );
    expect(out.comparison).toMatchObject({
      previousRunId: 'run-0',
      previousFrameworkVersion: '0.5.0',
      agreementDelta: 0.01,
      flips: [],
    });
  });

  it('tags the AI run’s judge calls with the id it stores the run under', async () => {
    const { store, created } = fakeStore();
    const judges = stubJudges();
    await runCalibration(
      { version: VERSION, model, set, mode: 'ai', startedByUserId: 'user-1' },
      deps(store, judges).d
    );
    const tag = judges.mock.calls[0][0].costTags?.calibrationRunId;
    expect(tag).toBe(created[0].id);
    expect(created[0]).toMatchObject({ mode: 'ai', startedByUserId: 'user-1', costUsd: 2.34 });
    expect(created[0].judgeModels.judge_ethos).toEqual(['openai/gpt-x']);
  });

  it('refuses a set written for another model version, before spending anything', async () => {
    const { store } = fakeStore();
    const judges = stubJudges();
    const other = { ...VERSION, version: '0.6.0' };
    await expect(
      runCalibration({ version: other, model, set, mode: 'ai' }, deps(store, judges).d)
    ).rejects.toMatchObject({ code: 'SET_MISMATCH' });
    expect(judges).not.toHaveBeenCalled();
    expect(store.createRun).not.toHaveBeenCalled();
  });

  it('refuses a set naming an id the version does not have, listing it', async () => {
    const { store } = fakeStore();
    const broken = structuredClone(set);
    broken.cases[0].expect.flags_present.push('rf_nope');
    const err: unknown = await runCalibration(
      { version: VERSION, model, set: broken, mode: 'quick' },
      deps(store).d
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CalibrationError);
    expect(err).toMatchObject({ code: 'DANGLING_REFERENCES', problems: ["ev01.flags: 'rf_nope'"] });
    expect(store.createRun).not.toHaveBeenCalled();
  });
});

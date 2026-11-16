/**
 * Calibration for the admin page (t-38): the list (versions, runs, each run's
 * change from the one before, a running run that has outlived its process),
 * and starting a run (a quick run waited for, an AI run finishing in the
 * background, the admin recorded on the run and on every judge call).
 *
 * The engine, the set and the framework store are the real ones, over an
 * in-memory repo and calibration store. The judges are stubbed.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  framework: { findUnique: vi.fn() },
  user: { findMany: vi.fn() },
}));
const scopes = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/db/client', () => ({ prisma: db }));
vi.mock('@/lib/tenancy/context', () => ({
  runAsSystem: (_reason: string, fn: () => Promise<unknown>) => {
    scopes.push('system');
    return fn();
  },
  runAsOrg: (orgId: string, fn: () => Promise<unknown>) => {
    scopes.push(`org:${orgId}`);
    return fn();
  },
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import type { runJudges as RunJudges } from '@/lib/app/assessments/fan-out';
import {
  listFrameworkCalibration,
  startCalibrationRun,
  STOPPED_AFTER_MS,
  type CalibrationAdminDeps,
} from '@/lib/app/calibration/admin';
import { tally } from '@/lib/app/calibration/score';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import { importVersion } from '@/lib/app/frameworks/store';
import { fakeCalibrationStore } from '@/tests/unit/lib/app/calibration/fake-store';
import { FakeFrameworkRepo } from '@/tests/unit/lib/app/frameworks/fake-repo';

const MODEL = 'lib/app/frameworks/howdoesthisland/data/model-0.5.1.json';
const NOW = new Date('2026-11-16T12:00:00Z');

type Landed = Awaited<ReturnType<typeof RunJudges>>['landed'][number];

/** Every judge answers with an empty reply at a cent, once `release` is called. */
function gatedJudges() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const judges = vi.fn<typeof RunJudges>(async (input) => {
    await gate;
    return {
      stopped: false,
      landed: input.slots.map(
        (slot): Landed =>
          ({
            slot,
            ok: true,
            reply: {
              output: {},
              provider: 'openai',
              model: 'gpt-x',
              costUsd: 0.01,
            },
          }) as unknown as Landed
      ),
    };
  });
  return { judges, release };
}

let repo: FakeFrameworkRepo;
let fake: ReturnType<typeof fakeCalibrationStore>;
let deps: CalibrationAdminDeps;

beforeEach(async () => {
  vi.clearAllMocks();
  scopes.length = 0;
  repo = new FakeFrameworkRepo();
  await importVersion(repo, howDoesThisLand, readFileSync(MODEL, 'utf8'));
  fake = fakeCalibrationStore(null, { now: () => NOW });
  deps = { store: fake.store, repo, runJudges: vi.fn(), now: () => NOW };
  db.user.findMany.mockResolvedValue([{ id: 'admin-1', name: 'Ada Admin' }]);
});

describe('startCalibrationRun()', () => {
  it('waits for a quick run and returns it complete, recorded as the admin’s', async () => {
    const started = await startCalibrationRun(
      { version: '0.5.1', mode: 'quick', userId: 'admin-1' },
      deps
    );
    expect(started.status).toBe('complete');
    const run = fake.runs.get(started.runId);
    expect(run).toMatchObject({ status: 'complete', mode: 'quick', startedByUserId: 'admin-1' });
    expect(run?.totals?.checks).toBeGreaterThan(0);
    expect(deps.runJudges).not.toHaveBeenCalled();
  });

  it('returns an AI run at once, running, and it finishes in the background', async () => {
    const { judges, release } = gatedJudges();
    deps.runJudges = judges;
    const started = await startCalibrationRun(
      { version: '0.5.1', mode: 'ai', userId: 'admin-1' },
      deps
    );

    expect(started.status).toBe('running');
    expect(fake.runs.get(started.runId)).toMatchObject({ status: 'running', totals: null });

    release();
    await vi.waitFor(() => expect(fake.runs.get(started.runId)?.status).toBe('complete'));
    expect(fake.runs.get(started.runId)?.startedByUserId).toBe('admin-1');
    // Every judge call is attributed to the admin and tagged with the run.
    expect(judges.mock.calls.length).toBe(26);
    for (const [input] of judges.mock.calls) {
      expect(input).toMatchObject({
        userId: 'admin-1',
        costTags: { calibrationRunId: started.runId },
      });
    }
    expect(scopes).toContain('org:install');
  });

  it('refuses a second AI run of a version while one is running', async () => {
    const { judges, release } = gatedJudges();
    deps.runJudges = judges;
    const first = await startCalibrationRun(
      { version: '0.5.1', mode: 'ai', userId: 'admin-1' },
      deps
    );
    await expect(
      startCalibrationRun({ version: '0.5.1', mode: 'ai', userId: 'admin-1' }, deps)
    ).rejects.toMatchObject({
      status: 409,
      code: 'CALIBRATION_RUNNING',
      details: { runId: first.runId },
    });
    // A quick run is not held up by it.
    await expect(
      startCalibrationRun({ version: '0.5.1', mode: 'quick', userId: 'admin-1' }, deps)
    ).resolves.toMatchObject({ status: 'complete' });
    release();
    await vi.waitFor(() => expect(fake.runs.get(first.runId)?.status).toBe('complete'));
  });

  it('does not count a run that has outlived its process as running', async () => {
    fake.runs.set('old', {
      id: 'old',
      frameworkVersionId: (await repo.findVersion('howdoesthisland', '0.5.1'))?.id ?? '',
      frameworkVersion: '0.5.1',
      sourceSha256: 'x',
      setVersion: '0.5.1',
      mode: 'ai',
      status: 'running',
      totals: null,
      rows: null,
      judgeModels: {},
      costUsd: 0,
      error: null,
      startedByUserId: null,
      createdAt: new Date(NOW.getTime() - STOPPED_AFTER_MS - 1),
      finishedAt: null,
    });
    const { judges, release } = gatedJudges();
    deps.runJudges = judges;
    const started = await startCalibrationRun(
      { version: '0.5.1', mode: 'ai', userId: 'admin-1' },
      deps
    );
    expect(started.status).toBe('running');
    release();
    await vi.waitFor(() => expect(fake.runs.get(started.runId)?.status).toBe('complete'));
  });

  it('answers 404 for a version that is not imported, storing nothing', async () => {
    await expect(
      startCalibrationRun({ version: '9.9.9', mode: 'quick', userId: 'admin-1' }, deps)
    ).rejects.toMatchObject({ status: 404 });
    expect(fake.store.startRun).not.toHaveBeenCalled();
  });
});

describe('listFrameworkCalibration()', () => {
  it('lists each version with its runs, each compared with the run of its mode before it', async () => {
    const version = await repo.findVersion('howdoesthisland', '0.5.1');
    db.framework.findUnique.mockResolvedValue({
      name: 'HowDoesThisLand',
      versions: [
        {
          id: version?.id,
          version: '0.5.1',
          status: 'PUBLISHED',
          sourceSha256: version?.sourceSha256,
          createdAt: NOW,
          publishedAt: NOW,
          calibration: null,
        },
      ],
    });
    let clock = 0;
    fake = fakeCalibrationStore(null, { now: () => new Date(NOW.getTime() + clock++ * 1000) });
    deps.store = fake.store;
    const first = await startCalibrationRun(
      { version: '0.5.1', mode: 'quick', userId: 'admin-1' },
      deps
    );
    const second = await startCalibrationRun(
      { version: '0.5.1', mode: 'quick', userId: 'admin-1' },
      deps
    );
    // A run from the CLI, still running: no results, and no comparison.
    fake.runs.set('cli-run', {
      ...(fake.runs.get(first.runId) ?? never()),
      id: 'cli-run',
      mode: 'ai',
      status: 'running',
      totals: null,
      rows: null,
      startedByUserId: null,
      createdAt: new Date(NOW.getTime() + 10_000),
    });

    const listed = await listFrameworkCalibration(deps);
    expect(listed.versions).toHaveLength(1);
    const [v] = listed.versions;
    expect(v).toMatchObject({ version: '0.5.1', status: 'published', runnable: true });
    expect(v.runs.map((r) => r.id)).toEqual(['cli-run', second.runId, first.runId]);

    const [cli, newer, older] = v.runs;
    expect(cli).toMatchObject({ status: 'running', startedBy: null, comparison: null });
    expect(older.comparison).toBeNull();
    // Two quick runs of one version agree exactly.
    expect(newer.comparison).toMatchObject({
      previousRunId: first.runId,
      agreementDelta: 0,
      flips: [],
    });
    expect(newer.comparison?.byKind.appeal.delta).toBe(0);
    expect(newer.startedBy).toEqual({ id: 'admin-1', name: 'Ada Admin' });
    expect(newer.ofCurrentFile).toBe(true);
    // One read of the starters' names, not one per run.
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('shows a run still running past the limit as stopped', async () => {
    const version = await repo.findVersion('howdoesthisland', '0.5.1');
    db.framework.findUnique.mockResolvedValue({
      name: 'HowDoesThisLand',
      versions: [
        {
          id: version?.id,
          version: '0.5.1',
          status: 'DRAFT',
          sourceSha256: 'other-file',
          createdAt: NOW,
          publishedAt: null,
          calibration: null,
        },
      ],
    });
    const rows = [
      {
        case: 'ev01',
        checks: [
          { kind: 'appeal' as const, key: 'e', expected: 'low', got: 1, result: 'ok' as const },
        ],
        judgeFailures: [],
      },
    ];
    fake.runs.set('stale', {
      id: 'stale',
      frameworkVersionId: version?.id ?? '',
      frameworkVersion: '0.5.1',
      sourceSha256: version?.sourceSha256 ?? '',
      setVersion: '0.5.1',
      mode: 'ai',
      status: 'running',
      totals: null,
      rows: null,
      judgeModels: {},
      costUsd: 0,
      error: null,
      startedByUserId: 'gone-user',
      createdAt: new Date(NOW.getTime() - STOPPED_AFTER_MS - 1),
      finishedAt: null,
    });
    fake.runs.set('done', {
      ...(fake.runs.get('stale') ?? never()),
      id: 'done',
      status: 'complete',
      totals: tally(rows),
      rows,
      createdAt: new Date(NOW.getTime() - 1000),
    });
    const [v] = (await listFrameworkCalibration(deps)).versions;
    const stale = v.runs.find((r) => r.id === 'stale');
    // A user who is gone is shown as nobody, not as an id.
    expect(stale).toMatchObject({ status: 'stopped', startedBy: null, ofCurrentFile: false });
    expect(v.status).toBe('draft');
    expect(v.calibration).toBeNull();
  });
});

function never(): never {
  throw new Error('missing fixture');
}

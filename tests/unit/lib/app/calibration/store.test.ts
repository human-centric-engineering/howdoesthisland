/**
 * Calibration runs in the database (t-37, t-38), against a mocked Prisma:
 * every read and write in the system scope, a run owned by the install org
 * and stored as running before it has results, only a complete run read back
 * for comparing and publishing, and the stored JSON parsed on the way back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  calibrationRun: {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
}));
const scope = vi.hoisted(() => ({ reasons: [] as string[] }));

vi.mock('@/lib/db/client', () => ({ prisma: db }));
vi.mock('@/lib/tenancy/context', () => ({
  runAsSystem: (reason: string, fn: () => Promise<unknown>) => {
    scope.reasons.push(reason);
    return fn();
  },
}));

import { tally } from '@/lib/app/calibration/score';
import { prismaCalibrationStore as store, type NewRun } from '@/lib/app/calibration/store';

const rows = [
  {
    case: 'ev01',
    checks: [
      { kind: 'appeal' as const, key: 'ethos', expected: 'low', got: 10, result: 'ok' as const },
    ],
    judgeFailures: [],
  },
];
const run: NewRun = {
  id: 'cal-1',
  frameworkVersionId: 'ver-1',
  sourceSha256: 'sha-1',
  setVersion: '0.5.1',
  mode: 'ai',
  judgeModels: { judge_ethos: ['openai/gpt-x'] },
  totals: tally(rows),
  rows,
  costUsd: 0.5,
  startedByUserId: null,
};
const dbRow = (over: Record<string, unknown> = {}) => ({
  ...run,
  mode: 'AI',
  createdAt: new Date('2026-11-16T12:00:00Z'),
  frameworkVersion: { version: '0.5.1' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  scope.reasons.length = 0;
});

describe('prismaCalibrationStore', () => {
  it('stores a run as the install org’s and running, with no results, in the system scope', async () => {
    db.calibrationRun.create.mockResolvedValue({ id: 'cal-1' });
    const { judgeModels: _m, totals: _t, rows: _r, costUsd: _c, ...start } = run;
    await store.startRun(start);
    expect(scope.reasons).toEqual(['calibration: start a run']);
    const { data } = db.calibrationRun.create.mock.calls[0][0];
    expect(data).toMatchObject({ id: 'cal-1', orgId: 'install', mode: 'AI', status: 'RUNNING' });
    expect(data).not.toHaveProperty('totals');
    expect(data).not.toHaveProperty('rows');
  });

  it('finishes only a running run, with its results, and reads it back', async () => {
    db.calibrationRun.update.mockResolvedValue(dbRow());
    const stored = await store.finishRun('cal-1', run);
    expect(db.calibrationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'cal-1', status: 'RUNNING' },
        data: expect.objectContaining({ status: 'COMPLETE', costUsd: 0.5, totals: run.totals }),
      })
    );
    expect(stored).toMatchObject({ id: 'cal-1', mode: 'ai', frameworkVersion: '0.5.1' });
    expect(stored.totals).toEqual(run.totals);
  });

  it('fails only a running run, keeping why', async () => {
    db.calibrationRun.updateMany.mockResolvedValue({ count: 1 });
    await store.failRun('cal-1', 'provider unreachable');
    expect(db.calibrationRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'cal-1', status: 'RUNNING' },
      data: expect.objectContaining({ status: 'FAILED', error: 'provider unreachable' }),
    });
  });

  it('lists the framework’s runs of every status, a running one without results', async () => {
    db.calibrationRun.findMany.mockResolvedValue([
      dbRow({ id: 'cal-2', status: 'RUNNING', totals: null, rows: null, judgeModels: {} }),
      dbRow({ status: 'COMPLETE', startedByUserId: 'admin-1', error: null, finishedAt: null }),
    ]);
    const listed = await store.listRuns('howdoesthisland');
    expect(db.calibrationRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { frameworkVersion: { framework: { slug: 'howdoesthisland' } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    );
    expect(listed[0]).toMatchObject({ id: 'cal-2', status: 'running', totals: null, rows: null });
    expect(listed[1]).toMatchObject({ status: 'complete', startedByUserId: 'admin-1' });
    expect(listed[1].totals).toEqual(run.totals);
  });

  it('reads the newest complete run of a mode across the framework’s versions', async () => {
    db.calibrationRun.findFirst.mockResolvedValue(dbRow({ mode: 'QUICK' }));
    const last = await store.latestRun({ frameworkSlug: 'howdoesthisland', mode: 'quick' });
    expect(db.calibrationRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          mode: 'QUICK',
          status: 'COMPLETE',
          frameworkVersion: { framework: { slug: 'howdoesthisland' } },
        },
        orderBy: { createdAt: 'desc' },
      })
    );
    expect(last?.mode).toBe('quick');

    db.calibrationRun.findFirst.mockResolvedValue(null);
    expect(await store.latestRun({ frameworkSlug: 'howdoesthisland', mode: 'ai' })).toBeNull();
  });

  it('reads a version’s complete AI runs, newest first', async () => {
    db.calibrationRun.findMany.mockResolvedValue([dbRow()]);
    const runs = await store.aiRunsOf('ver-1');
    expect(db.calibrationRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { frameworkVersionId: 'ver-1', mode: 'AI', status: 'COMPLETE' },
        orderBy: { createdAt: 'desc' },
      })
    );
    expect(runs).toHaveLength(1);
    expect(db.calibrationRun.findMany.mock.calls[0][0]).not.toHaveProperty('take');
  });

  it('refuses stored JSON that is not a run’s, rather than trusting it', async () => {
    db.calibrationRun.findMany.mockResolvedValue([dbRow({ totals: { agreement: 'high' } })]);
    await expect(store.aiRunsOf('ver-1')).rejects.toThrow();
  });
});

/**
 * Calibration runs in the database (t-37, t-38), against a mocked Prisma:
 * every read and write in the system scope, a run owned by the install org
 * and stored as running before it has results, only a complete run read back
 * for comparing and publishing, and the stored JSON parsed on the way back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const calibrationRun = {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  };
  // The transaction client is the same mocks: what matters is what ran inside it.
  const tx = { calibrationRun };
  return {
    calibrationRun,
    frameworkVersion: { findMany: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>, _opts?: unknown) => fn(tx)),
  };
});
const scope = vi.hoisted(() => ({ reasons: [] as string[] }));

vi.mock('@/lib/db/client', () => ({ prisma: db }));
vi.mock('@/lib/tenancy/context', () => ({
  runAsSystem: (reason: string, fn: () => Promise<unknown>) => {
    scope.reasons.push(reason);
    return fn();
  },
}));

import { tally } from '@/lib/app/calibration/score';
import {
  CalibrationRunningError,
  prismaCalibrationStore as store,
  STOPPED_AFTER_MS,
  type NewRun,
} from '@/lib/app/calibration/store';

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
  heartbeatAt: new Date('2026-11-16T12:00:00Z'),
  frameworkVersion: { version: '0.5.1' },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  scope.reasons.length = 0;
});

describe('prismaCalibrationStore', () => {
  const { judgeModels: _m, totals: _t, rows: _r, costUsd: _c, ...start } = run;

  it('stores a run as the install org’s and running, with no results, in the system scope', async () => {
    const createdAt = new Date('2026-11-16T12:00:00Z');
    db.calibrationRun.findFirst.mockResolvedValue(null);
    db.calibrationRun.create.mockResolvedValue({ createdAt });
    await expect(store.startRun(start)).resolves.toEqual({ createdAt });
    expect(scope.reasons).toEqual(['calibration: start a run']);
    const { data } = db.calibrationRun.create.mock.calls[0][0];
    expect(data).toMatchObject({ id: 'cal-1', orgId: 'install', mode: 'AI', status: 'RUNNING' });
    expect(data.heartbeatAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty('totals');
    expect(data).not.toHaveProperty('rows');
  });

  it('starts an AI run in one serializable transaction with the look for a live one', async () => {
    db.calibrationRun.findFirst.mockResolvedValue(null);
    db.calibrationRun.create.mockResolvedValue({ createdAt: new Date() });
    const before = Date.now();
    await store.startRun(start);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
    expect(db.calibrationRun.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      db.calibrationRun.create.mock.invocationCallOrder[0]
    );
    const { where } = db.calibrationRun.findFirst.mock.calls[0][0];
    expect(where).toMatchObject({ frameworkVersionId: 'ver-1', mode: 'AI', status: 'RUNNING' });
    // Live means beaten within the stop limit.
    expect(where.heartbeatAt.gte.getTime()).toBeGreaterThanOrEqual(before - STOPPED_AFTER_MS);
  });

  it('refuses an AI run while another of the version’s is alive, storing nothing', async () => {
    db.calibrationRun.findFirst.mockResolvedValue({ id: 'cal-0' });
    const err: unknown = await store.startRun(start).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CalibrationRunningError);
    expect(err).toMatchObject({ runId: 'cal-0' });
    expect(db.calibrationRun.create).not.toHaveBeenCalled();
  });

  it('tries a start that lost a race again, and then sees the run that won', async () => {
    // Through the pg driver adapter, the clash is a DriverAdapterError.
    const clash = Object.assign(new Error('TransactionWriteConflict'), {
      name: 'DriverAdapterError',
      cause: { kind: 'TransactionWriteConflict' },
    });
    db.$transaction.mockRejectedValueOnce(clash);
    db.calibrationRun.findFirst.mockResolvedValue({ id: 'cal-winner' });
    await expect(store.startRun(start)).rejects.toMatchObject({ runId: 'cal-winner' });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it('does not retry an error that is not a clash', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('connection refused'));
    await expect(store.startRun(start)).rejects.toThrow('connection refused');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('gives up on a start that keeps losing races', async () => {
    const clash = Object.assign(new Error('TransactionWriteConflict'), {
      name: 'DriverAdapterError',
      cause: { kind: 'TransactionWriteConflict' },
    });
    for (let i = 0; i < 5; i++) db.$transaction.mockRejectedValueOnce(clash);
    await expect(store.startRun(start)).rejects.toBe(clash);
    expect(db.$transaction).toHaveBeenCalledTimes(5);
  });

  it('starts a quick run without the look', async () => {
    db.calibrationRun.create.mockResolvedValue({ createdAt: new Date() });
    await store.startRun({ ...start, mode: 'quick' });
    expect(db.calibrationRun.findFirst).not.toHaveBeenCalled();
    expect(db.calibrationRun.create).toHaveBeenCalledTimes(1);
  });

  it('touches only a running run’s beat', async () => {
    db.calibrationRun.updateMany.mockResolvedValue({ count: 1 });
    await store.touchRun('cal-1');
    expect(db.calibrationRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'cal-1', status: 'RUNNING' },
      data: { heartbeatAt: expect.any(Date) },
    });
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
    await store.failRun('cal-1', 'provider unreachable', 0.42);
    expect(db.calibrationRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'cal-1', status: 'RUNNING' },
      data: expect.objectContaining({
        status: 'FAILED',
        error: 'provider unreachable',
        costUsd: 0.42,
      }),
    });
  });

  it('lists each version’s newest runs of every status, merged newest first', async () => {
    db.frameworkVersion.findMany.mockResolvedValue([{ id: 'ver-1' }, { id: 'ver-0' }]);
    db.calibrationRun.findMany.mockImplementation(
      async ({ where }: { where: { frameworkVersionId: string } }) =>
        where.frameworkVersionId === 'ver-1'
          ? [
              dbRow({
                id: 'cal-2',
                status: 'RUNNING',
                totals: null,
                rows: null,
                judgeModels: {},
                createdAt: new Date('2026-11-16T14:00:00Z'),
              }),
              dbRow({
                status: 'COMPLETE',
                startedByUserId: 'admin-1',
                error: null,
                finishedAt: null,
                createdAt: new Date('2026-11-16T12:00:00Z'),
              }),
            ]
          : [
              dbRow({
                id: 'cal-old',
                frameworkVersionId: 'ver-0',
                status: 'COMPLETE',
                createdAt: new Date('2026-11-16T13:00:00Z'),
              }),
            ]
    );
    const listed = await store.listRuns('howdoesthisland');
    expect(db.frameworkVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { framework: { slug: 'howdoesthisland' } } })
    );
    // Each version's own newest runs, so a busy version cannot crowd out another.
    for (const id of ['ver-1', 'ver-0']) {
      expect(db.calibrationRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { frameworkVersionId: id },
          orderBy: { createdAt: 'desc' },
          take: 100,
        })
      );
    }
    expect(listed.map((r) => r.id)).toEqual(['cal-2', 'cal-old', 'cal-1']);
    expect(listed[0]).toMatchObject({ status: 'running', totals: null, rows: null });
    expect(listed[2]).toMatchObject({ status: 'complete', startedByUserId: 'admin-1' });
    expect(listed[2].totals).toEqual(run.totals);
  });

  it('reads the newest complete run of a mode across the framework’s versions', async () => {
    db.calibrationRun.findFirst.mockResolvedValue(dbRow({ mode: 'QUICK' }));
    const before = new Date('2026-11-17T00:00:00Z');
    const last = await store.latestRun({ frameworkSlug: 'howdoesthisland', mode: 'quick', before });
    expect(db.calibrationRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          mode: 'QUICK',
          status: 'COMPLETE',
          createdAt: { lt: before },
          frameworkVersion: { framework: { slug: 'howdoesthisland' } },
        },
        orderBy: { createdAt: 'desc' },
      })
    );
    expect(last?.mode).toBe('quick');

    db.calibrationRun.findFirst.mockResolvedValue(null);
    expect(
      await store.latestRun({ frameworkSlug: 'howdoesthisland', mode: 'ai', before })
    ).toBeNull();
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

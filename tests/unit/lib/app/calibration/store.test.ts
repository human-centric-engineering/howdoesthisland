/**
 * Calibration runs in the database (t-37), against a mocked Prisma: every
 * read and write in the system scope, a run owned by the install org, and
 * the stored JSON parsed on the way back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  calibrationRun: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
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
  it('stores a run as the install org’s, in the system scope', async () => {
    db.calibrationRun.create.mockResolvedValue(dbRow());
    const stored = await store.createRun(run);
    expect(scope.reasons).toEqual(['calibration: store a run']);
    expect(db.calibrationRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: 'cal-1', orgId: 'install', mode: 'AI', costUsd: 0.5 }),
      })
    );
    expect(stored).toMatchObject({ id: 'cal-1', mode: 'ai', frameworkVersion: '0.5.1' });
    expect(stored.totals).toEqual(run.totals);
  });

  it('reads the newest run of a mode across the framework’s versions', async () => {
    db.calibrationRun.findFirst.mockResolvedValue(dbRow({ mode: 'QUICK' }));
    const last = await store.latestRun({ frameworkSlug: 'howdoesthisland', mode: 'quick' });
    expect(db.calibrationRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mode: 'QUICK', frameworkVersion: { framework: { slug: 'howdoesthisland' } } },
        orderBy: { createdAt: 'desc' },
      })
    );
    expect(last?.mode).toBe('quick');

    db.calibrationRun.findFirst.mockResolvedValue(null);
    expect(await store.latestRun({ frameworkSlug: 'howdoesthisland', mode: 'ai' })).toBeNull();
  });

  it('reads a version’s AI runs, newest first', async () => {
    db.calibrationRun.findMany.mockResolvedValue([dbRow()]);
    const runs = await store.aiRunsOf('ver-1', 50);
    expect(db.calibrationRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { frameworkVersionId: 'ver-1', mode: 'AI' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    );
    expect(runs).toHaveLength(1);
  });

  it('refuses stored JSON that is not a run’s, rather than trusting it', async () => {
    db.calibrationRun.findMany.mockResolvedValue([dbRow({ totals: { agreement: 'high' } })]);
    await expect(store.aiRunsOf('ver-1', 50)).rejects.toThrow();
  });
});

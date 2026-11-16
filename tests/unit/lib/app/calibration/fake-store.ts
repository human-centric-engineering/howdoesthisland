/**
 * An in-memory calibration store for the tests (t-38), with the database's
 * rule that only a `RUNNING` run finishes or fails.
 */
import { vi } from 'vitest';
import type {
  CalibrationRunLister,
  CalibrationStore,
  ListedRun,
  NewRun,
  RunStart,
  StoredRun,
} from '@/lib/app/calibration/store';

export function fakeCalibrationStore(
  previous: StoredRun | null = null,
  opts: { frameworkVersion?: string; now?: () => Date } = {}
) {
  const created: NewRun[] = [];
  const runs = new Map<string, ListedRun>();
  const now = opts.now ?? (() => new Date('2026-11-16T12:00:00Z'));
  const frameworkVersion = opts.frameworkVersion ?? '0.5.1';
  const store = {
    startRun: vi.fn(async (run: RunStart) => {
      runs.set(run.id, {
        ...run,
        frameworkVersion,
        status: 'running',
        totals: null,
        rows: null,
        judgeModels: {},
        costUsd: 0,
        error: null,
        createdAt: now(),
        finishedAt: null,
      });
    }),
    finishRun: vi.fn(async (id: string, results: Parameters<CalibrationStore['finishRun']>[1]) => {
      const run = runs.get(id);
      if (!run || run.status !== 'running') throw new Error(`run ${id} is not running`);
      runs.set(id, { ...run, ...results, status: 'complete', finishedAt: now() });
      const start: RunStart = {
        id,
        frameworkVersionId: run.frameworkVersionId,
        sourceSha256: run.sourceSha256,
        setVersion: run.setVersion,
        mode: run.mode,
        startedByUserId: run.startedByUserId,
      };
      created.push({ ...start, ...results });
      return { ...start, ...results, createdAt: run.createdAt, frameworkVersion };
    }),
    failRun: vi.fn(async (id: string, error: string) => {
      const run = runs.get(id);
      if (run?.status === 'running') {
        runs.set(id, { ...run, status: 'failed', error, finishedAt: now() });
      }
    }),
    latestRun: vi.fn(async () => previous),
    aiRunsOf: vi.fn(async () => []),
    listRuns: vi.fn(async () =>
      [...runs.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    ),
  } satisfies CalibrationStore & CalibrationRunLister;
  /** `created`: each run as it finished, in order. `runs`: every run, by id, as it is now. */
  return { store, created, runs };
}

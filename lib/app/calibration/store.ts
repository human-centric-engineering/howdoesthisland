/**
 * Calibration runs in the database (t-37): the only writer of
 * `CalibrationRun`.
 *
 * A run is stored when it starts, as `RUNNING`, and finished with its
 * results (`COMPLETE`) or its error (`FAILED`) (t-38: the admin page starts
 * an AI run that finishes in the background, and shows it running). Only a
 * `COMPLETE` run is read back as a {@link StoredRun}: the comparison and the
 * publish gate never see one that has not finished.
 *
 * A run is the install org's (`orgId` = `INSTALL_ORG_ID`), and every read and
 * write here is made in the system scope, because the CLI that runs it and
 * the publish that reads it are not inside any workspace. The stored
 * `totals` and `rows` are read back through Zod, as any JSON column is.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RunForComparison } from '@/lib/app/calibration/compare';
import type { Totals } from '@/lib/app/calibration/score';
import { rowsSchema, totalsSchema } from '@/lib/app/calibration/wire';
import { prisma } from '@/lib/db/client';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { runAsSystem } from '@/lib/tenancy/context';

export { rowsSchema, totalsSchema };

/** What a run is stored with when it starts. */
export interface RunStart {
  id: string;
  frameworkVersionId: string;
  sourceSha256: string;
  setVersion: string;
  mode: 'quick' | 'ai';
  startedByUserId: string | null;
}

/** What a finished run adds. */
export interface RunResults {
  judgeModels: Record<string, string[]>;
  totals: Totals;
  rows: z.infer<typeof rowsSchema>;
  costUsd: number;
}

export type NewRun = RunStart & RunResults;

export type RunStatus = 'running' | 'complete' | 'failed';

/** A run as the admin page lists it: any status, its results only once complete. */
export interface ListedRun {
  id: string;
  frameworkVersionId: string;
  frameworkVersion: string;
  sourceSha256: string;
  setVersion: string;
  mode: 'quick' | 'ai';
  status: RunStatus;
  totals: Totals | null;
  rows: z.infer<typeof rowsSchema> | null;
  judgeModels: Record<string, string[]>;
  costUsd: number;
  error: string | null;
  startedByUserId: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface StoredRun extends RunForComparison {
  frameworkVersionId: string;
  sourceSha256: string;
  setVersion: string;
  mode: 'quick' | 'ai';
  judgeModels: Record<string, string[]>;
  rows: z.infer<typeof rowsSchema>;
  costUsd: number;
}

export interface CalibrationStore {
  /** Stores the run as `RUNNING`, with no results. */
  startRun(run: RunStart): Promise<void>;
  /** `RUNNING` → `COMPLETE`, with its results. */
  finishRun(id: string, results: RunResults): Promise<StoredRun>;
  /** `RUNNING` → `FAILED`, with why. */
  failRun(id: string, error: string): Promise<void>;
  /** The newest complete run of `mode` against any version of the framework. */
  latestRun(where: { frameworkSlug: string; mode: 'quick' | 'ai' }): Promise<StoredRun | null>;
  /** All of a version's complete AI runs, newest first. */
  aiRunsOf(frameworkVersionId: string): Promise<StoredRun[]>;
}

/** The most runs {@link CalibrationRunLister.listRuns} returns. */
export const LIST_LIMIT = 100;

/** The admin page's read (t-38): the framework's newest runs, of any status, newest first. */
export interface CalibrationRunLister {
  listRuns(frameworkSlug: string): Promise<ListedRun[]>;
}

const MODE = { quick: 'QUICK', ai: 'AI' } as const;
const STATUS = { RUNNING: 'running', COMPLETE: 'complete', FAILED: 'failed' } as const;
const COMPLETE = 'COMPLETE' as const;
const judgeModelsSchema = z.record(z.string(), z.array(z.string()));

const select = {
  id: true,
  frameworkVersionId: true,
  sourceSha256: true,
  setVersion: true,
  mode: true,
  judgeModels: true,
  totals: true,
  rows: true,
  costUsd: true,
  createdAt: true,
  frameworkVersion: { select: { version: true } },
} satisfies Prisma.CalibrationRunSelect;

interface RunRow {
  id: string;
  frameworkVersionId: string;
  sourceSha256: string;
  setVersion: string;
  mode: 'QUICK' | 'AI';
  judgeModels: unknown;
  totals: unknown;
  rows: unknown;
  costUsd: number;
  createdAt: Date;
  frameworkVersion: { version: string };
}

const listSelect = {
  ...select,
  status: true,
  error: true,
  startedByUserId: true,
  finishedAt: true,
} satisfies Prisma.CalibrationRunSelect;

interface ListRow extends RunRow {
  status: 'RUNNING' | 'COMPLETE' | 'FAILED';
  error: string | null;
  startedByUserId: string | null;
  finishedAt: Date | null;
}

function toListed(row: ListRow): ListedRun {
  const complete = row.status === COMPLETE;
  return {
    id: row.id,
    frameworkVersionId: row.frameworkVersionId,
    frameworkVersion: row.frameworkVersion.version,
    sourceSha256: row.sourceSha256,
    setVersion: row.setVersion,
    mode: row.mode === 'AI' ? 'ai' : 'quick',
    status: STATUS[row.status],
    totals: complete ? totalsSchema.parse(row.totals) : null,
    rows: complete ? rowsSchema.parse(row.rows) : null,
    judgeModels: judgeModelsSchema.parse(row.judgeModels),
    costUsd: row.costUsd,
    error: row.error,
    startedByUserId: row.startedByUserId,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

function toStored(row: RunRow): StoredRun {
  return {
    id: row.id,
    frameworkVersionId: row.frameworkVersionId,
    frameworkVersion: row.frameworkVersion.version,
    sourceSha256: row.sourceSha256,
    setVersion: row.setVersion,
    mode: row.mode === 'AI' ? 'ai' : 'quick',
    judgeModels: judgeModelsSchema.parse(row.judgeModels),
    totals: totalsSchema.parse(row.totals),
    rows: rowsSchema.parse(row.rows),
    costUsd: row.costUsd,
    createdAt: row.createdAt,
  };
}

const system = <T>(reason: string, fn: () => Promise<T>) =>
  runAsSystem(`calibration: ${reason}`, fn);

export const prismaCalibrationStore: CalibrationStore & CalibrationRunLister = {
  startRun: (run) =>
    system('start a run', async () => {
      await prisma.calibrationRun.create({
        data: {
          id: run.id,
          orgId: INSTALL_ORG_ID,
          frameworkVersionId: run.frameworkVersionId,
          sourceSha256: run.sourceSha256,
          setVersion: run.setVersion,
          mode: MODE[run.mode],
          status: 'RUNNING',
          judgeModels: {},
          startedByUserId: run.startedByUserId,
        },
        select: { id: true },
      });
    }),

  finishRun: (id, results) =>
    system('finish a run', async () =>
      toStored(
        await prisma.calibrationRun.update({
          // Only a running run finishes: one already finished keeps its results.
          where: { id, status: 'RUNNING' },
          data: {
            status: COMPLETE,
            judgeModels: results.judgeModels,
            // An interface has no index signature, so Prisma's JSON type needs telling.
            totals: results.totals as unknown as Prisma.InputJsonValue,
            rows: results.rows,
            costUsd: results.costUsd,
            finishedAt: new Date(),
          },
          select,
        })
      )
    ),

  failRun: (id, error) =>
    system('fail a run', async () => {
      await prisma.calibrationRun.updateMany({
        where: { id, status: 'RUNNING' },
        data: { status: 'FAILED', error: error.slice(0, 2000), finishedAt: new Date() },
      });
    }),

  latestRun: ({ frameworkSlug, mode }) =>
    system('read the last run', async () => {
      const row = await prisma.calibrationRun.findFirst({
        where: {
          mode: MODE[mode],
          status: COMPLETE,
          frameworkVersion: { framework: { slug: frameworkSlug } },
        },
        orderBy: { createdAt: 'desc' },
        select,
      });
      return row ? toStored(row) : null;
    }),

  aiRunsOf: (frameworkVersionId) =>
    system('read a version’s runs', async () => {
      const rows = await prisma.calibrationRun.findMany({
        where: { frameworkVersionId, mode: 'AI', status: COMPLETE },
        orderBy: { createdAt: 'desc' },
        select,
      });
      return rows.map(toStored);
    }),

  listRuns: (frameworkSlug) =>
    system('list the runs', async () => {
      const rows = await prisma.calibrationRun.findMany({
        where: { frameworkVersion: { framework: { slug: frameworkSlug } } },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
        select: listSelect,
      });
      return rows.map(toListed);
    }),
};

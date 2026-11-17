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
 * **Alive, and stopped.** A running run's `heartbeatAt` is touched every
 * {@link HEARTBEAT_MS} by the process running it ({@link CalibrationStore.touchRun}).
 * One whose beat is older than {@link STOPPED_AFTER_MS} is stopped: that
 * process went away (a deploy, a serverless host's time limit, a Ctrl-C) and
 * it will never finish. Nothing rewrites it; it stops counting as running.
 *
 * **One AI run of a version at a time.** {@link CalibrationStore.startRun}
 * checks that none of the version's AI runs is still alive and stores the new
 * one in a single `SERIALIZABLE` transaction, so two starts at once cannot
 * both pass the check: the loser's transaction fails, is tried again, and
 * then sees the other. It throws {@link CalibrationRunningError} when one is.
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
import { isSerializableConflict } from '@/lib/db/serializable-conflict';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { runAsSystem } from '@/lib/tenancy/context';
import { isRecord } from '@/lib/utils';

export { rowsSchema, totalsSchema };

/** How often a running run's process touches its `heartbeatAt`. */
export const HEARTBEAT_MS = 30_000;

/** A `RUNNING` run whose beat is older than this is stopped. Several beats, so a slow write is not a stop. */
export const STOPPED_AFTER_MS = 4 * HEARTBEAT_MS;

/** Whether a `RUNNING` run has stopped beating, as of `now`. */
export function hasStopped(heartbeatAt: Date, now: Date): boolean {
  return now.getTime() - heartbeatAt.getTime() > STOPPED_AFTER_MS;
}

/** Tries at starting a run; a concurrent start of the same version clears on a retry. */
const START_ATTEMPTS = 5;

/**
 * Whether a start lost a `SERIALIZABLE` clash with a concurrent one. Through
 * the pg driver adapter, a clash inside an interactive transaction arrives as
 * a `DriverAdapterError` whose `cause.kind` is `TransactionWriteConflict`,
 * not as `P2034` (seen against the dev database), so both are recognised.
 */
function lostStartRace(err: unknown): boolean {
  if (isSerializableConflict(err)) return true;
  if (!(err instanceof Error) || err.name !== 'DriverAdapterError') return false;
  const cause: unknown = err.cause;
  return isRecord(cause) && cause.kind === 'TransactionWriteConflict';
}

/** An AI run of the version is still running, so another may not start. */
export class CalibrationRunningError extends Error {
  constructor(readonly runId: string) {
    super(`An AI run of this version is still running (${runId}).`);
    this.name = 'CalibrationRunningError';
  }
}

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
  /** The running process's last beat. */
  heartbeatAt: Date;
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
  /**
   * Stores the run as `RUNNING`, with no results, and returns when it was
   * stored. Throws {@link CalibrationRunningError} for an AI run of a version
   * one of whose AI runs is still alive.
   */
  startRun(run: RunStart): Promise<{ createdAt: Date }>;
  /** Touches a running run's `heartbeatAt`. */
  touchRun(id: string): Promise<void>;
  /** `RUNNING` → `COMPLETE`, with its results. */
  finishRun(id: string, results: RunResults): Promise<StoredRun>;
  /** `RUNNING` → `FAILED`, with why and what its judges cost before it failed. */
  failRun(id: string, error: string, costUsd: number): Promise<void>;
  /** The newest complete run of `mode` against any version of the framework, stored before `before`. */
  latestRun(where: {
    frameworkSlug: string;
    mode: 'quick' | 'ai';
    before: Date;
  }): Promise<StoredRun | null>;
  /** All of a version's complete AI runs, newest first. */
  aiRunsOf(frameworkVersionId: string): Promise<StoredRun[]>;
}

/** The most runs of one version {@link CalibrationRunLister.listRuns} returns. */
export const LIST_LIMIT = 100;

/**
 * The admin page's read (t-38): each of the framework's versions' newest
 * {@link LIST_LIMIT} runs, of any status, newest first. Per version, so a
 * busy draft cannot push an older version's runs off the page.
 */
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
  heartbeatAt: true,
  finishedAt: true,
} satisfies Prisma.CalibrationRunSelect;

interface ListRow extends RunRow {
  status: 'RUNNING' | 'COMPLETE' | 'FAILED';
  error: string | null;
  startedByUserId: string | null;
  heartbeatAt: Date;
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
    heartbeatAt: row.heartbeatAt,
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
      for (let attempt = 1; ; attempt++) {
        try {
          return await prisma.$transaction(
            async (tx) => {
              if (run.mode === 'ai') {
                const alive = await tx.calibrationRun.findFirst({
                  where: {
                    frameworkVersionId: run.frameworkVersionId,
                    mode: 'AI',
                    status: 'RUNNING',
                    heartbeatAt: { gte: new Date(Date.now() - STOPPED_AFTER_MS) },
                  },
                  select: { id: true },
                });
                if (alive) throw new CalibrationRunningError(alive.id);
              }
              return tx.calibrationRun.create({
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
                  // This process's clock, as every later beat is.
                  heartbeatAt: new Date(),
                },
                select: { createdAt: true },
              });
            },
            // The check and the insert commit together or not at all: a start
            // racing this one fails here and, tried again, sees this run.
            { isolationLevel: 'Serializable' }
          );
        } catch (err) {
          if (attempt >= START_ATTEMPTS || !lostStartRace(err)) throw err;
        }
      }
    }),

  touchRun: (id) =>
    system('touch a run', async () => {
      await prisma.calibrationRun.updateMany({
        where: { id, status: 'RUNNING' },
        data: { heartbeatAt: new Date() },
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

  failRun: (id, error, costUsd) =>
    system('fail a run', async () => {
      await prisma.calibrationRun.updateMany({
        where: { id, status: 'RUNNING' },
        data: {
          status: 'FAILED',
          error: error.slice(0, 2000),
          costUsd,
          finishedAt: new Date(),
        },
      });
    }),

  latestRun: ({ frameworkSlug, mode, before }) =>
    system('read the last run', async () => {
      const row = await prisma.calibrationRun.findFirst({
        where: {
          mode: MODE[mode],
          status: COMPLETE,
          createdAt: { lt: before },
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
      const versions = await prisma.frameworkVersion.findMany({
        where: { framework: { slug: frameworkSlug } },
        select: { id: true },
      });
      // One read per version: a framework has a handful.
      const perVersion = await Promise.all(
        versions.map((v) =>
          prisma.calibrationRun.findMany({
            where: { frameworkVersionId: v.id },
            orderBy: { createdAt: 'desc' },
            take: LIST_LIMIT,
            select: listSelect,
          })
        )
      );
      return perVersion
        .flat()
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(toListed);
    }),
};

/**
 * Calibration runs in the database (t-37): the only writer of
 * `CalibrationRun`.
 *
 * A run is the install org's (`orgId` = `INSTALL_ORG_ID`), and every read and
 * write here is made in the system scope, because the CLI that runs it and
 * the publish that reads it are not inside any workspace. The stored
 * `totals` and `rows` are read back through Zod, as any JSON column is.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { RunForComparison } from '@/lib/app/calibration/compare';
import { CHECK_KINDS, type Totals } from '@/lib/app/calibration/score';
import { prisma } from '@/lib/db/client';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { runAsSystem } from '@/lib/tenancy/context';

const outcomeSchema = z.enum(['ok', 'near', 'miss']);
const tallySchema = z.object({
  ok: z.number(),
  near: z.number(),
  miss: z.number(),
  n: z.number(),
});
export const totalsSchema = z.object({
  byKind: z.object({
    appeal: tallySchema,
    overall: tallySchema,
    flag: tallySchema,
    duty: tallySchema,
    group: tallySchema,
    dimension: tallySchema,
    lever: tallySchema,
  }),
  agreement: z.number(),
  checks: z.number(),
  cases: z.number(),
  judgeFailures: z.number(),
}) satisfies z.ZodType<Totals>;

export const rowsSchema = z.array(
  z.object({
    case: z.string(),
    checks: z.array(
      z.object({
        kind: z.enum(CHECK_KINDS),
        key: z.string(),
        expected: z.string(),
        got: z.union([z.number(), z.string(), z.boolean(), z.null()]),
        result: outcomeSchema,
      })
    ),
    judgeFailures: z.array(z.object({ slot: z.string(), code: z.string() })),
  })
);

export interface NewRun {
  id: string;
  frameworkVersionId: string;
  sourceSha256: string;
  setVersion: string;
  mode: 'quick' | 'ai';
  judgeModels: Record<string, string[]>;
  totals: Totals;
  rows: z.infer<typeof rowsSchema>;
  costUsd: number;
  startedByUserId: string | null;
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
  createRun(run: NewRun): Promise<StoredRun>;
  /** The newest run of `mode` against any version of the framework. */
  latestRun(where: { frameworkSlug: string; mode: 'quick' | 'ai' }): Promise<StoredRun | null>;
  /** All of a version's AI runs, newest first. */
  aiRunsOf(frameworkVersionId: string): Promise<StoredRun[]>;
}

const MODE = { quick: 'QUICK', ai: 'AI' } as const;
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

export const prismaCalibrationStore: CalibrationStore = {
  createRun: (run) =>
    system('store a run', async () =>
      toStored(
        await prisma.calibrationRun.create({
          data: {
            id: run.id,
            orgId: INSTALL_ORG_ID,
            frameworkVersionId: run.frameworkVersionId,
            sourceSha256: run.sourceSha256,
            setVersion: run.setVersion,
            mode: MODE[run.mode],
            judgeModels: run.judgeModels,
            // An interface has no index signature, so Prisma's JSON type needs telling.
            totals: run.totals as unknown as Prisma.InputJsonValue,
            rows: run.rows,
            costUsd: run.costUsd,
            startedByUserId: run.startedByUserId,
          },
          select,
        })
      )
    ),

  latestRun: ({ frameworkSlug, mode }) =>
    system('read the last run', async () => {
      const row = await prisma.calibrationRun.findFirst({
        where: { mode: MODE[mode], frameworkVersion: { framework: { slug: frameworkSlug } } },
        orderBy: { createdAt: 'desc' },
        select,
      });
      return row ? toStored(row) : null;
    }),

  aiRunsOf: (frameworkVersionId) =>
    system('read a version’s runs', async () => {
      const rows = await prisma.calibrationRun.findMany({
        where: { frameworkVersionId, mode: 'AI' },
        orderBy: { createdAt: 'desc' },
        select,
      });
      return rows.map(toStored);
    }),
};

/**
 * The shapes of a calibration run's stored JSON and of what the admin API
 * sends (t-37, t-38). No database import, so the route registry can declare
 * them (`lib/app/api/registry.ts`).
 */
import { z } from 'zod';
import { CHECK_KINDS, type Totals } from '@/lib/app/calibration/score';

export const outcomeSchema = z.enum(['ok', 'near', 'miss']);
export const tallySchema = z.object({
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

/** `FrameworkVersion.calibration`, as the publish gate writes it (`gate.ts`). */
export const calibrationSnapshotSchema = z.object({
  runId: z.string(),
  ranAt: z.string(),
  agreement: z.number(),
  setVersion: z.string(),
  checks: z.number(),
  judgeModels: z.record(z.string(), z.array(z.string())),
});

const checkKindSchema = z.enum(CHECK_KINDS);
const kindChangeSchema = z.object({
  okRate: z.number().nullable(),
  previousOkRate: z.number().nullable(),
  delta: z.number().nullable(),
});

/** What changed since the run before (`compare.ts`). */
export const runComparisonSchema = z.object({
  previousRunId: z.string(),
  previousRanAt: z.string(),
  previousFrameworkVersion: z.string(),
  agreement: z.number(),
  previousAgreement: z.number(),
  agreementDelta: z.number(),
  byKind: z.object({
    appeal: kindChangeSchema,
    overall: kindChangeSchema,
    flag: kindChangeSchema,
    duty: kindChangeSchema,
    group: kindChangeSchema,
    dimension: kindChangeSchema,
    lever: kindChangeSchema,
  }),
  flips: z.array(
    z.object({
      case: z.string(),
      kind: checkKindSchema,
      key: z.string(),
      from: outcomeSchema,
      to: outcomeSchema,
    })
  ),
});

/** One run on the admin page (t-38), as sent: dates are ISO strings. */
export const adminRunSchema = z.object({
  id: z.string(),
  frameworkVersionId: z.string(),
  frameworkVersion: z.string(),
  sourceSha256: z.string(),
  setVersion: z.string(),
  mode: z.enum(['quick', 'ai']),
  status: z.enum(['running', 'complete', 'failed', 'stopped']),
  totals: totalsSchema.nullable(),
  rows: rowsSchema.nullable(),
  judgeModels: z.record(z.string(), z.array(z.string())),
  costUsd: z.number(),
  error: z.string().nullable(),
  startedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  ofCurrentFile: z.boolean(),
  comparison: runComparisonSchema.nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const adminVersionSchema = z.object({
  id: z.string(),
  version: z.string(),
  status: z.enum(['draft', 'published', 'retired']),
  sourceSha256: z.string(),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
  calibration: calibrationSnapshotSchema.nullable(),
  runnable: z.boolean(),
  runs: z.array(adminRunSchema),
});

export const frameworkCalibrationSchema = z.object({
  slug: z.string(),
  name: z.string(),
  versions: z.array(adminVersionSchema),
});

export const startedRunSchema = z.object({
  runId: z.string(),
  status: z.enum(['running', 'complete']),
});

export type AdminRunWire = z.infer<typeof adminRunSchema>;
export type AdminVersionWire = z.infer<typeof adminVersionSchema>;
export type FrameworkCalibrationWire = z.infer<typeof frameworkCalibrationSchema>;

/** The admin page's read (t-38). */
export const ADMIN_FRAMEWORKS_PATH = '/api/v1/admin/frameworks';

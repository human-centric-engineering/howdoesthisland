/**
 * What the assessments API answers with (t-24), and the reads behind it.
 *
 * The registry's response schemas are held to these types by a type test,
 * so a field added here and not there fails `npm run type-check`.
 *
 * Every read runs in the caller's tenant context and names `orgId`, so an
 * assessment of another workspace is not found: a 404, never a 403, so an id
 * is not confirmed to someone outside.
 */
import type { AssessmentStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import type { AssessmentState } from '@/lib/app/assessments/api/validations';
import { contextUsedView } from '@/lib/app/projects/context';
import type { ContextUsed } from '@/lib/app/projects/wire';
import { reviewRefusalDetailsSchema, type ReviewRefusalDetails } from '@/lib/app/usage/wire';
import { earlyQuickScan, type EarlyQuickScan } from '@/lib/app/assessments/early-scan';

/** A credit or budget refusal's figures as stored, or `null` when there are none in either shape. */
function budgetFigures(stored: Prisma.JsonValue): ReviewRefusalDetails | null {
  const parsed = reviewRefusalDetailsSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

export type FrameworkRef = { slug: string; version: string };

export type JudgeRunView = {
  judge: string;
  status: 'succeeded' | 'failed';
  /** The model it ran on, once it reached a provider. */
  model: string | null;
  costUsd: number;
  latencyMs: number | null;
  /** For `failed`: the `JudgeRunError` code. Its dimensions fell back to the quick scan. */
  errorCode: string | null;
};

export type AssessmentSummary = {
  id: string;
  stored: true;
  status: AssessmentState;
  profile: string;
  /** The judge slots the profile resolved to, in the version's order. */
  judges: string[];
  framework: FrameworkRef;
  /** The workspace's project it was reviewed in (t-70), or `null`. */
  projectId: string | null;
  /**
   * That project's id and name (t-79), so a list row can name it without a
   * read of its own; `null` outside a project. An archived project is still
   * named: its reviews keep their link to it.
   */
  project: { id: string; name: string } | null;
  title: string | null;
  source: { kind: 'text' | 'file' | 'url'; url: string | null; fileName: string | null };
  /** `null` for a page a batch has not fetched yet, or could not (t-101). */
  wordCount: number | null;
  overall: number | null;
  band: string | null;
  costUsd: number;
  error: string | null;
  /**
   * What kind of failure, for a `failed` one that has one:
   * `INSUFFICIENT_CREDITS` (t-58) or `BUDGET_EXCEEDED` (t-53) when it was
   * refused as it was claimed, having waited while other spend landed. No
   * judge was called.
   */
  errorCode: string | null;
  /** Its figures, for either: what the 402 refusal carries in `details`. */
  errorDetails: ReviewRefusalDetails | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

export type AssessmentDetail = AssessmentSummary & {
  /**
   * The copy that was assessed, as intake stored it. The result's highlights
   * and red flags are character offsets into it, so a reader of the result
   * needs it to place them (the report, t-29). `null` for a page a batch
   * has not fetched yet, or could not (t-101): its address is `source.url`.
   */
  text: string | null;
  /** Who the text is for, defaults applied. */
  context: unknown;
  /**
   * The project's adjustment to the weights it was scored with (t-72), as
   * checked against its version, or `null` for none. Its shape is the
   * framework's.
   */
  overlay: Record<string, unknown> | null;
  /**
   * What the AI reviewers were given of its project (t-75): the brief, the
   * documents used and the passages, or `null` outside a project or when it
   * gave them nothing. `null` too until the run has gathered it.
   */
  contextUsed: ContextUsed | null;
  /** The framework's assembled result, once final; `null` before. */
  result: unknown;
  /**
   * What the quick scan says, while a review that calls judges is queued or
   * running (t-77): something to show before the judges land. `null` once
   * it is final (`result` then says it all), for a `quick` review (whose
   * result is the quick scan, at once), and for text the engine cannot score.
   */
  quickScan: EarlyQuickScan | null;
  judgeRuns: JudgeRunView[];
};

/** A run that kept nothing (`store: false`): the result, and no id to fetch it by. */
export type EphemeralAssessment = {
  stored: false;
  status: 'completed' | 'partial';
  profile: string;
  judges: string[];
  framework: FrameworkRef;
  wordCount: number;
  overall: number | null;
  band: string | null;
  costUsd: number;
  context: unknown;
  /** The project's adjustment to the weights it was scored with (t-72), or `null`. */
  overlay: Record<string, unknown> | null;
  /** What the AI reviewers were given of its project (t-75), or `null`. */
  contextUsed: ContextUsed | null;
  result: unknown;
  judgeRuns: JudgeRunView[];
};

/** The free quick scan's answer: nothing was stored, no model was called. */
export type QuickScanView = {
  framework: FrameworkRef;
  wordCount: number;
  overall: number | null;
  band: string | null;
  context: unknown;
  result: unknown;
};

/** Whether a run can no longer leave this state. */
export const isFinal = (state: AssessmentState): boolean =>
  state !== 'queued' && state !== 'running';

const STATE: Record<AssessmentStatus, AssessmentState> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  PARTIAL: 'partial',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const DB_STATUS: Record<AssessmentState, AssessmentStatus> = {
  queued: 'QUEUED',
  running: 'RUNNING',
  completed: 'COMPLETED',
  partial: 'PARTIAL',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
};

export const stateOf = (status: AssessmentStatus): AssessmentState => STATE[status];

export const toDbStatus = (state: AssessmentState): AssessmentStatus => DB_STATUS[state];

const SOURCE_KIND = { TEXT: 'text', FILE: 'file', URL: 'url' } as const;

const summarySelect = {
  id: true,
  projectId: true,
  project: { select: { id: true, name: true } },
  status: true,
  profile: true,
  judges: true,
  overall: true,
  band: true,
  costUsd: true,
  error: true,
  errorCode: true,
  errorDetails: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  frameworkVersion: { select: { version: true, framework: { select: { slug: true } } } },
  content: {
    select: { title: true, sourceKind: true, sourceUrl: true, fileName: true, wordCount: true },
  },
} satisfies Prisma.AssessmentSelect;

const detailSelect = {
  ...summarySelect,
  frameworkVersionId: true,
  content: { select: { ...summarySelect.content.select, text: true } },
  context: true,
  overlay: true,
  projectContext: true,
  result: true,
  judgeRuns: {
    select: {
      judge: true,
      status: true,
      modelName: true,
      costUsd: true,
      latencyMs: true,
      errorCode: true,
    },
  },
} satisfies Prisma.AssessmentSelect;

type SummaryRow = Prisma.AssessmentGetPayload<{ select: typeof summarySelect }>;
type DetailRow = Prisma.AssessmentGetPayload<{ select: typeof detailSelect }>;

export function judgeRunView(run: {
  judge: string;
  status: 'SUCCEEDED' | 'FAILED';
  modelName: string | null;
  costUsd: number;
  latencyMs: number | null;
  errorCode: string | null;
}): JudgeRunView {
  return {
    judge: run.judge,
    status: run.status === 'SUCCEEDED' ? 'succeeded' : 'failed',
    model: run.modelName,
    costUsd: run.costUsd,
    latencyMs: run.latencyMs,
    errorCode: run.errorCode,
  };
}

function summaryView(row: SummaryRow): AssessmentSummary {
  return {
    id: row.id,
    stored: true,
    status: stateOf(row.status),
    profile: row.profile,
    judges: row.judges,
    framework: { slug: row.frameworkVersion.framework.slug, version: row.frameworkVersion.version },
    projectId: row.projectId,
    project: row.project ? { id: row.project.id, name: row.project.name } : null,
    title: row.content.title,
    source: {
      kind: SOURCE_KIND[row.content.sourceKind],
      url: row.content.sourceUrl,
      fileName: row.content.fileName,
    },
    wordCount: row.content.wordCount,
    overall: row.overall,
    band: row.band,
    costUsd: row.costUsd,
    error: row.error,
    errorCode: row.errorCode,
    errorDetails: budgetFigures(row.errorDetails),
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

/** An assessment's judge runs in its version's order of judges. */
export function inJudgeOrder<T extends { judge: string }>(
  judges: readonly string[],
  runs: readonly T[]
): T[] {
  const order = new Map(judges.map((slot, i) => [slot, i]));
  return [...runs].sort((a, b) => (order.get(a.judge) ?? 0) - (order.get(b.judge) ?? 0));
}

/**
 * The recorded overlay as the API answers it. Only the engine's checked
 * overlay is ever written (`enqueue.ts`), an object or nothing; anything else
 * reads as none.
 */
function storedOverlay(value: unknown): Record<string, unknown> | null {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  return parsed.success ? parsed.data : null;
}

function detailView(row: DetailRow, quickScan: EarlyQuickScan | null): AssessmentDetail {
  return {
    ...summaryView(row),
    text: row.content.text,
    context: row.context,
    overlay: storedOverlay(row.overlay),
    contextUsed: contextUsedView(row.projectContext),
    result: row.result,
    quickScan,
    judgeRuns: inJudgeOrder(row.judges, row.judgeRuns).map(judgeRunView),
  };
}

/** Whether this workspace has an assessment with this id, read without its text. */
export async function assessmentExists(id: string): Promise<boolean> {
  const row = await prisma.assessment.findUnique({
    where: { id, orgId: requireOrgId() },
    select: { id: true },
  });
  return row !== null;
}

/** One of this workspace's assessments, or `null`. */
export async function readAssessment(id: string): Promise<AssessmentDetail | null> {
  const row = await prisma.assessment.findUnique({
    where: { id, orgId: requireOrgId() },
    select: detailSelect,
  });
  if (!row) return null;
  return detailView(row, await quickScanWhileRunning(row));
}

/**
 * The quick scan of a review whose judges are still to land, or `null`: see
 * {@link AssessmentDetail.quickScan}. Worked out from the row, not stored
 * (`early-scan.ts`).
 */
async function quickScanWhileRunning(row: DetailRow): Promise<EarlyQuickScan | null> {
  if (isFinal(stateOf(row.status)) || row.judges.length === 0) return null;
  return earlyQuickScan({
    id: row.id,
    frameworkVersionId: row.frameworkVersionId,
    context: row.context,
    overlay: row.overlay,
    text: row.content.text,
    sourceUrl: row.content.sourceUrl,
  });
}

/**
 * A page of this workspace's assessments, newest first.
 *
 * The content type is read from the stored `context` (t-79), which intake
 * writes with defaults applied, so every review has one. A JSON-path filter
 * rather than a column: a column would be a second copy of the context, and
 * the `(orgId, createdAt)` index already narrows the scan to one workspace.
 */
export async function listAssessments(query: {
  page: number;
  limit: number;
  status?: AssessmentState;
  projectId?: string;
  contentType?: string;
  band?: string;
}): Promise<{ items: AssessmentSummary[]; total: number }> {
  const where: Prisma.AssessmentWhereInput = {
    orgId: requireOrgId(),
    ...(query.status ? { status: toDbStatus(query.status) } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.contentType ? { context: { path: ['contentType'], equals: query.contentType } } : {}),
    ...(query.band ? { band: query.band } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.assessment.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: summarySelect,
    }),
    prisma.assessment.count({ where }),
  ]);
  return { items: rows.map(summaryView), total };
}

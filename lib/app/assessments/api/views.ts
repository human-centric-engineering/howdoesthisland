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
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import type { AssessmentState } from '@/lib/app/assessments/api/validations';
import { reviewRefusalDetailsSchema, type ReviewRefusalDetails } from '@/lib/app/usage/wire';

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
  title: string | null;
  source: { kind: 'text' | 'file' | 'url'; url: string | null; fileName: string | null };
  wordCount: number;
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
   * needs it to place them (the report, t-29).
   */
  text: string;
  /** Who the text is for, defaults applied. */
  context: unknown;
  /** The framework's assembled result, once final; `null` before. */
  result: unknown;
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
  content: { select: { ...summarySelect.content.select, text: true } },
  context: true,
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

function detailView(row: DetailRow): AssessmentDetail {
  return {
    ...summaryView(row),
    text: row.content.text,
    context: row.context,
    result: row.result,
    judgeRuns: inJudgeOrder(row.judges, row.judgeRuns).map(judgeRunView),
  };
}

/** One of this workspace's assessments, or `null`. */
export async function readAssessment(id: string): Promise<AssessmentDetail | null> {
  const row = await prisma.assessment.findUnique({
    where: { id, orgId: requireOrgId() },
    select: detailSelect,
  });
  return row ? detailView(row) : null;
}

/** A page of this workspace's assessments, newest first. */
export async function listAssessments(query: {
  page: number;
  limit: number;
  status?: AssessmentState;
  projectId?: string;
}): Promise<{ items: AssessmentSummary[]; total: number }> {
  const where: Prisma.AssessmentWhereInput = {
    orgId: requireOrgId(),
    ...(query.status ? { status: toDbStatus(query.status) } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
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

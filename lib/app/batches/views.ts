/**
 * What the batches API answers with (t-101, `.context/app/batches.md`), and
 * the reads behind it.
 *
 * A batch's items are ordinary reviews, read through each member's link, as
 * a comparison's drafts are (`lib/app/comparisons/views.ts`). An item whose
 * review was deleted or purged has no link left (`onDelete: SetNull`) and
 * reads as `purged`: its place, label and nothing else. The batch is never
 * failed for it.
 *
 * Its state is worked out from its items', never stored: `running` while any
 * is queued or running; then `completed` when every item completed, `failed`
 * when none was scored, and `partial` otherwise (an item failed, was
 * cancelled, was scored with some AI reviewers missing, or was purged).
 * `counts` says how many items are in each state.
 *
 * The list answers each batch's counts; its items, which may be a hundred,
 * are the batch's own read.
 *
 * Every read runs in the caller's tenant context and names `orgId`, so
 * another workspace's batch is not found.
 */
import type { ContentSourceKind, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import { isFinal, stateOf, type FrameworkRef } from '@/lib/app/assessments/api/views';
import { ASSESSMENT_STATES } from '@/lib/app/assessments/api/validations';
import type { DraftState } from '@/lib/app/comparisons/views';

/** An item's state: its review's, or `purged` once that review is gone. */
export type ItemState = DraftState;

/** A batch's state, from its items': see the file header. */
export type BatchState = 'running' | 'completed' | 'partial' | 'failed';

/** Every item state, in the order `counts` lists them. */
export const ITEM_STATES = [...ASSESSMENT_STATES, 'purged'] as const;

export type BatchItem = {
  /** Its place in the batch, from 0, as the items were sent. */
  position: number;
  label: string | null;
  /** Its review, to open as any other; `null` once purged. */
  assessmentId: string | null;
  status: ItemState;
  /** Text, a page or an uploaded file, and a page's address (where its redirects ended, once fetched). */
  source: { kind: BatchItemSourceKind; url: string | null } | null;
  overall: number | null;
  band: string | null;
  /**
   * Why it failed, when that has a code: intake's for a page that could not
   * be read (`FETCH_FAILED`, `FETCH_TIMEOUT`, `URL_NOT_ALLOWED`,
   * `TEXT_TOO_LONG`, `CONTENT_EMPTY`, …), or the budget's.
   */
  errorCode: string | null;
};

export type BatchSummary = {
  id: string;
  kind: 'batch';
  status: BatchState;
  framework: FrameworkRef;
  /** As each item's review records it: the profile's name, or `custom`. */
  profile: string;
  /** The judge slots every item was reviewed by. */
  judges: string[];
  projectId: string | null;
  project: { id: string; name: string } | null;
  createdAt: Date;
  /** How many items it has. */
  total: number;
  /** How many items are in each state. */
  counts: Record<ItemState, number>;
};

export type BatchDetail = BatchSummary & {
  /** Who the items are for, defaults applied: what every item was given. */
  context: unknown;
  items: BatchItem[];
};

const SCORED: ReadonlySet<ItemState> = new Set(['completed', 'partial']);

/** The set's state from its items': see the file header. */
export function batchState(items: readonly { status: ItemState }[]): BatchState {
  if (items.some((i) => i.status !== 'purged' && !isFinal(i.status))) return 'running';
  if (items.every((i) => i.status === 'completed')) return 'completed';
  return items.some((i) => SCORED.has(i.status)) ? 'partial' : 'failed';
}

/** How many of `items` are in each state. */
export function countByState(items: readonly { status: ItemState }[]): Record<ItemState, number> {
  const counts: Record<ItemState, number> = {
    queued: 0,
    running: 0,
    completed: 0,
    partial: 0,
    failed: 0,
    cancelled: 0,
    purged: 0,
  };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

const headerSelect = {
  id: true,
  projectId: true,
  project: { select: { id: true, name: true } },
  profile: true,
  judges: true,
  createdAt: true,
  frameworkVersion: { select: { version: true, framework: { select: { slug: true } } } },
} satisfies Prisma.AssessmentSetSelect;

const summarySelect = {
  ...headerSelect,
  members: { select: { assessment: { select: { status: true } } } },
} satisfies Prisma.AssessmentSetSelect;

const detailSelect = {
  ...headerSelect,
  context: true,
  members: {
    orderBy: { position: 'asc' },
    select: {
      position: true,
      label: true,
      assessmentId: true,
      assessment: {
        select: {
          status: true,
          overall: true,
          band: true,
          errorCode: true,
          content: { select: { sourceKind: true, sourceUrl: true } },
        },
      },
    },
  },
} satisfies Prisma.AssessmentSetSelect;

type HeaderRow = Prisma.AssessmentSetGetPayload<{ select: typeof headerSelect }>;
type SummaryRow = Prisma.AssessmentSetGetPayload<{ select: typeof summarySelect }>;
type DetailRow = Prisma.AssessmentSetGetPayload<{ select: typeof detailSelect }>;

/** What an item is: pasted text, a page, or an uploaded file (t-102). */
export const BATCH_ITEM_SOURCE_KINDS = ['text', 'url', 'file'] as const;
export type BatchItemSourceKind = (typeof BATCH_ITEM_SOURCE_KINDS)[number];

/** An item's source as the API names it: pasted text, a page, or an upload (t-102). */
const SOURCE_KIND: Record<ContentSourceKind, BatchItemSourceKind> = {
  TEXT: 'text',
  URL: 'url',
  FILE: 'file',
};

function itemView(member: DetailRow['members'][number]): BatchItem {
  const review = member.assessment;
  return {
    position: member.position,
    label: member.label,
    assessmentId: review ? member.assessmentId : null,
    status: review ? stateOf(review.status) : 'purged',
    source: review
      ? { kind: SOURCE_KIND[review.content.sourceKind], url: review.content.sourceUrl }
      : null,
    overall: review?.overall ?? null,
    band: review?.band ?? null,
    errorCode: review?.errorCode ?? null,
  };
}

function summaryOf(row: HeaderRow, items: readonly { status: ItemState }[]): BatchSummary {
  return {
    id: row.id,
    kind: 'batch',
    status: batchState(items),
    framework: { slug: row.frameworkVersion.framework.slug, version: row.frameworkVersion.version },
    profile: row.profile,
    judges: row.judges,
    projectId: row.projectId,
    project: row.project ? { id: row.project.id, name: row.project.name } : null,
    createdAt: row.createdAt,
    total: items.length,
    counts: countByState(items),
  };
}

const statesOf = (row: SummaryRow): { status: ItemState }[] =>
  row.members.map((m) => ({ status: m.assessment ? stateOf(m.assessment.status) : 'purged' }));

/** One of this workspace's batches, or `null`. */
export async function readBatch(id: string): Promise<BatchDetail | null> {
  const row = await prisma.assessmentSet.findUnique({
    where: { id, orgId: requireOrgId(), kind: 'BATCH' },
    select: detailSelect,
  });
  if (!row) return null;
  const items = row.members.map(itemView);
  return { ...summaryOf(row, items), context: row.context, items };
}

/** A page of this workspace's batches, newest first. */
export async function listBatches(query: {
  page: number;
  limit: number;
  projectId?: string;
}): Promise<{ items: BatchSummary[]; total: number }> {
  const where: Prisma.AssessmentSetWhereInput = {
    orgId: requireOrgId(),
    kind: 'BATCH',
    ...(query.projectId ? { projectId: query.projectId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.assessmentSet.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: summarySelect,
    }),
    prisma.assessmentSet.count({ where }),
  ]);
  return { items: rows.map((row) => summaryOf(row, statesOf(row))), total };
}

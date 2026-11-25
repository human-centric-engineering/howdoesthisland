/**
 * What the comparisons API answers with (t-87), and the reads behind it.
 *
 * A comparison's drafts are ordinary reviews, read here through each member's
 * link. A member whose review was deleted or purged by retention has no link
 * left (`onDelete: SetNull`) and reads as `purged`: its place, label and
 * nothing else. The set is never failed for it.
 *
 * Its state is worked out from its drafts', never stored: `running` while any
 * is queued or running; then `completed` when every draft completed,
 * `failed` when fewer than two were scored (there is nothing to compare), and
 * `partial` otherwise (a draft failed, was cancelled, scored with some AI
 * reviewers missing, or was purged).
 *
 * **Per appeal**, once at least two drafts are scored (`completed` or
 * `partial`): each scored draft's score, its difference from the best score
 * (`0` for the leader, negative for the rest), and the leaders, more than one
 * on a tie. A draft not scored has `null` for both. Before two are scored,
 * `appeals` is empty. The appeals are the framework's
 * (`FrameworkEngine.appealScores`), read from each review's stored result.
 *
 * Every read runs in the caller's tenant context and names `orgId`, so
 * another workspace's comparison is not found.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import type { AppealScore } from '@/lib/app/frameworks/engine';
import { engineForVersion } from '@/lib/app/assessments/engine';
import { isFinal, stateOf, type FrameworkRef } from '@/lib/app/assessments/api/views';
import type { AssessmentState } from '@/lib/app/assessments/api/validations';

/** A draft's state: its review's, or `purged` once that review is gone. */
export type DraftState = AssessmentState | 'purged';

/** A comparison's state, from its drafts': see the file header. */
export type ComparisonState = 'running' | 'completed' | 'partial' | 'failed';

export type DraftSummary = {
  /** Its place in the comparison, from 0, as the drafts were sent. */
  position: number;
  label: string | null;
  /** Its review, to open as any other; `null` once purged. */
  assessmentId: string | null;
  status: DraftState;
  overall: number | null;
  band: string | null;
};

export type DraftDetail = DraftSummary & {
  /** Its score on each appeal once scored; `null` before, and for one not scored. */
  appeals: AppealScore[] | null;
};

export type AppealComparison = {
  appeal: string;
  /** The positions of the drafts with the best score: one, or more on a tie. */
  leaders: number[];
  /** Every draft, in position order. */
  drafts: { position: number; score: number | null; delta: number | null }[];
};

export type ComparisonSummary = {
  id: string;
  kind: 'comparison';
  status: ComparisonState;
  framework: FrameworkRef;
  /** As each draft's review records it: the profile's name, or `custom`. */
  profile: string;
  /** The judge slots every draft was reviewed by. */
  judges: string[];
  projectId: string | null;
  project: { id: string; name: string } | null;
  createdAt: Date;
  drafts: DraftSummary[];
};

export type ComparisonDetail = Omit<ComparisonSummary, 'drafts'> & {
  /** Who the drafts are for, defaults applied: what every draft was given. */
  context: unknown;
  drafts: DraftDetail[];
  /** Per appeal, in the framework's order, once two drafts are scored: see the file header. */
  appeals: AppealComparison[];
};

const memberAssessment = { status: true, overall: true, band: true } as const;

const summarySelect = {
  id: true,
  projectId: true,
  project: { select: { id: true, name: true } },
  profile: true,
  judges: true,
  createdAt: true,
  frameworkVersion: { select: { version: true, framework: { select: { slug: true } } } },
  members: {
    orderBy: { position: 'asc' },
    select: {
      position: true,
      label: true,
      assessmentId: true,
      assessment: { select: memberAssessment },
    },
  },
} satisfies Prisma.AssessmentSetSelect;

const detailSelect = {
  ...summarySelect,
  frameworkVersionId: true,
  context: true,
  members: {
    orderBy: { position: 'asc' },
    select: {
      ...summarySelect.members.select,
      assessment: { select: { ...memberAssessment, result: true } },
    },
  },
} satisfies Prisma.AssessmentSetSelect;

type SummaryRow = Prisma.AssessmentSetGetPayload<{ select: typeof summarySelect }>;
type DetailRow = Prisma.AssessmentSetGetPayload<{ select: typeof detailSelect }>;

const SCORED: ReadonlySet<DraftState> = new Set(['completed', 'partial']);

function draftSummary(member: SummaryRow['members'][number]): DraftSummary {
  const review = member.assessment;
  return {
    position: member.position,
    label: member.label,
    assessmentId: review ? member.assessmentId : null,
    status: review ? stateOf(review.status) : 'purged',
    overall: review?.overall ?? null,
    band: review?.band ?? null,
  };
}

/** The set's state from its drafts': see the file header. */
export function comparisonState(drafts: readonly { status: DraftState }[]): ComparisonState {
  if (drafts.some((d) => d.status !== 'purged' && !isFinal(d.status))) return 'running';
  if (drafts.every((d) => d.status === 'completed')) return 'completed';
  return drafts.filter((d) => SCORED.has(d.status)).length < 2 ? 'failed' : 'partial';
}

/** Per appeal, each scored draft against the best: see the file header. */
export function compareAppeals(drafts: readonly DraftDetail[]): AppealComparison[] {
  const scored = drafts.filter((d) => d.appeals !== null);
  if (scored.length < 2) return [];
  const appeals = scored[0].appeals?.map((a) => a.appeal) ?? [];
  return appeals.map((appeal) => {
    const scoreOf = (d: DraftDetail) => d.appeals?.find((a) => a.appeal === appeal)?.score ?? null;
    const scores = scored.flatMap((d) => scoreOf(d) ?? []);
    const best = Math.max(...scores);
    return {
      appeal,
      leaders: scored.filter((d) => scoreOf(d) === best).map((d) => d.position),
      drafts: drafts.map((d) => {
        const score = scoreOf(d);
        return { position: d.position, score, delta: score === null ? null : score - best };
      }),
    };
  });
}

/** Everything a comparison answers but its drafts, which its state is read from. */
function header(row: SummaryRow, drafts: readonly { status: DraftState }[]) {
  return {
    id: row.id,
    kind: 'comparison' as const,
    status: comparisonState(drafts),
    framework: { slug: row.frameworkVersion.framework.slug, version: row.frameworkVersion.version },
    profile: row.profile,
    judges: row.judges,
    projectId: row.projectId,
    project: row.project ? { id: row.project.id, name: row.project.name } : null,
    createdAt: row.createdAt,
  };
}

function summaryView(row: SummaryRow): ComparisonSummary {
  const drafts = row.members.map(draftSummary);
  return { ...header(row, drafts), drafts };
}

/** One of this workspace's comparisons, or `null`. */
export async function readComparison(id: string): Promise<ComparisonDetail | null> {
  const row: DetailRow | null = await prisma.assessmentSet.findUnique({
    where: { id, orgId: requireOrgId(), kind: 'COMPARISON' },
    select: detailSelect,
  });
  if (!row) return null;
  // The version's code reads the scores; a version no code runs any more
  // still lists its drafts, with no appeals to compare.
  const loaded = await engineForVersion(row.frameworkVersionId);
  const drafts: DraftDetail[] = row.members.map((member) => {
    const draft = draftSummary(member);
    const scored = SCORED.has(draft.status) && member.assessment && loaded;
    const appeals = scored ? loaded.engine.appealScores(member.assessment?.result) : null;
    return { ...draft, appeals: appeals ? [...appeals] : null };
  });
  return {
    ...header(row, drafts),
    context: row.context,
    drafts,
    appeals: compareAppeals(drafts),
  };
}

/** A page of this workspace's comparisons, newest first. */
export async function listComparisons(query: {
  page: number;
  limit: number;
  projectId?: string;
}): Promise<{ items: ComparisonSummary[]; total: number }> {
  const where: Prisma.AssessmentSetWhereInput = {
    orgId: requireOrgId(),
    kind: 'COMPARISON',
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
  return { items: rows.map(summaryView), total };
}

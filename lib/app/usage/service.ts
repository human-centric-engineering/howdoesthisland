/**
 * A workspace's usage this calendar month (t-48): reviews run, AI reviewer
 * calls and spend, by project and in total, against its monthly budget.
 *
 * **The total is the cap's own.** `spendUsd` is what Sunrise's org cap reads
 * (`getOrgCapState`, or `getMonthToDateOrgSpend` when no cap is set): every
 * `AiCostLog` row of the org since midnight UTC on the first. So the page and
 * the budget gate cannot disagree, and a review kept nowhere, the editor and
 * any other AI use all count, as they do against the budget.
 *
 * **The breakdown comes from the same rows.** Each cost row is put on a line
 * by its metadata (`run-judge.ts` writes it): an `assessmentId` goes to that
 * review's project, `ephemeral: true` to the reviews kept nowhere unless a
 * calibration run wrote it (`calibrationRunId`: the judges run on the
 * calibration set, in the install org). A row of a review since deleted, a
 * calibration run's, or any other AI use that is not a review goes to
 * `other`, whose spend is the total less every other line, so the lines add
 * up to the total. (The cap's total is cached for seconds; in that window a
 * row just written can be in the lines and not yet in the total, and `other`
 * is then `0` rather than negative.)
 *
 * **Reviews** are the stored assessments created this month, by project, and
 * the distinct `ephemeralRun` tags among this month's cost rows for those kept
 * nowhere. A kept-nowhere review that called no judge (a quick profile)
 * leaves no row, so it is not counted; nor is a stored one since deleted.
 * **Calls** are the provider attempts billed for a judge or the editor (the
 * row's `attempts`), so a retried judge counts twice, as it is billed.
 *
 * **One month throughout.** The cap reads its own month start, so a request
 * that straddles midnight UTC on the first is read again, once, rather than
 * answered with last month's lines against this month's total.
 *
 * **Credits** (t-57) are the workspace's CopyCredits balance, the sum of its
 * ledger, and what its reviews were charged this month (`CHARGE` entries,
 * t-58). The cap above is now the safety ceiling, not the allowance.
 *
 * Dollar figures are rounded to the millionth, the cost rows' own precision.
 *
 * Every read names the org, so it is the workspace's figures whatever scope
 * the caller is in. Projects are ids only until `f-projects` adds the model.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import {
  getMonthToDateOrgSpend,
  getOrgCapState,
  utcMonthStart,
} from '@/lib/orchestration/llm/spend-caps';
import { getCreditBalance, getCreditsChargedSince } from '@/lib/app/credits/ledger';
import type { MonthUsage, UsageLine, UsageLineKind } from '@/lib/app/usage/wire';

/** The cost-row metadata a review writes (`run-judge.ts`); every field optional. */
const costMetadataSchema = z.object({
  assessmentId: z.string().optional(),
  ephemeral: z.literal(true).optional(),
  ephemeralRun: z.string().optional(),
  calibrationRunId: z.string().optional(),
  judge: z.string().optional(),
  editor: z.string().optional(),
  attempts: z.number().int().nonnegative().optional(),
});

type CostMetadata = z.infer<typeof costMetadataSchema>;

/**
 * A dollar figure to the millionth, as the cost rows are priced: summing
 * floats leaves noise (`5.819999999999997`) nobody should read on the wire.
 */
function usd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Midnight UTC on the first of the month after `monthStart`. */
export function nextMonthStart(monthStart: Date): Date {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
}

/** Provider attempts a row billed for a judge or the editor; `0` for any other row. */
function reviewerCalls(meta: CostMetadata | null): number {
  if (!meta || (meta.judge === undefined && meta.editor === undefined)) return 0;
  return meta.attempts ?? 1;
}

/** Lines keyed by kind and, for a project, its id. */
class Lines {
  private readonly byKey = new Map<string, UsageLine>();

  get(kind: UsageLineKind, projectId: string | null = null): UsageLine {
    const key = kind === 'project' ? `project:${projectId}` : kind;
    let line = this.byKey.get(key);
    if (!line) {
      line = {
        kind,
        projectId: kind === 'project' ? projectId : null,
        reviews: 0,
        calls: 0,
        spendUsd: 0,
      };
      this.byKey.set(key, line);
    }
    return line;
  }

  /** Projects by spend, then no project, kept nowhere and other; empty lines left out. */
  list(): UsageLine[] {
    const order: Record<UsageLineKind, number> = {
      project: 0,
      'no-project': 1,
      'kept-nowhere': 2,
      other: 3,
    };
    return [...this.byKey.values()]
      .filter((l) => l.reviews > 0 || l.calls > 0 || l.spendUsd > 0)
      .sort(
        (a, b) =>
          order[a.kind] - order[b.kind] ||
          b.spendUsd - a.spendUsd ||
          (a.projectId ?? '').localeCompare(b.projectId ?? '')
      );
  }
}

/**
 * The org's usage this month. Throws when the cap or the rows cannot be read:
 * the route answers 500 rather than a figure that is wrong.
 */
export async function getMonthUsage(orgId: string): Promise<MonthUsage> {
  const usage = await readMonth(orgId, utcMonthStart());
  // The month turned during the read: the cap's total is the new month's.
  const now = utcMonthStart();
  return now.toISOString() === usage.month.start ? usage : readMonth(orgId, now);
}

async function readMonth(orgId: string, monthStart: Date): Promise<MonthUsage> {
  const since = { gte: monthStart };

  const [capState, costRows, reviewCounts, balance, charged] = await Promise.all([
    getOrgCapState(orgId),
    prisma.aiCostLog.findMany({
      where: { orgId, createdAt: since },
      select: { totalCostUsd: true, metadata: true },
    }),
    prisma.assessment.groupBy({
      by: ['projectId'],
      where: { orgId, createdAt: since },
      _count: { _all: true },
    }),
    getCreditBalance(orgId),
    getCreditsChargedSince(orgId, monthStart),
  ]);
  // The total the cap is held to; read directly only when there is no cap.
  const spendUsd = capState ? capState.spent : await getMonthToDateOrgSpend(orgId);

  const rows = costRows.map((row) => {
    const parsed = costMetadataSchema.safeParse(row.metadata);
    return { costUsd: row.totalCostUsd, meta: parsed.success ? parsed.data : null };
  });

  // The project of each review a row names, for those that still exist.
  const assessmentIds = [
    ...new Set(rows.flatMap((r) => (r.meta?.assessmentId ? [r.meta.assessmentId] : []))),
  ];
  const assessments =
    assessmentIds.length > 0
      ? await prisma.assessment.findMany({
          where: { orgId, id: { in: assessmentIds } },
          select: { id: true, projectId: true },
        })
      : [];
  const projectOf = new Map(assessments.map((a) => [a.id, a.projectId]));

  const lines = new Lines();
  for (const group of reviewCounts) {
    const line = group.projectId ? lines.get('project', group.projectId) : lines.get('no-project');
    line.reviews += group._count._all;
  }

  const ephemeralRuns = new Set<string>();
  let classifiedUsd = 0;
  for (const { costUsd, meta } of rows) {
    let line: UsageLine;
    const id = meta?.assessmentId;
    if (id !== undefined && projectOf.has(id)) {
      const projectId = projectOf.get(id) ?? null;
      line = projectId ? lines.get('project', projectId) : lines.get('no-project');
    } else if (meta?.ephemeral && meta.calibrationRunId === undefined) {
      line = lines.get('kept-nowhere');
      if (meta.ephemeralRun) ephemeralRuns.add(meta.ephemeralRun);
    } else {
      // `other`'s spend is the remainder, set below; only its calls are summed here.
      lines.get('other').calls += reviewerCalls(meta);
      continue;
    }
    line.calls += reviewerCalls(meta);
    line.spendUsd += costUsd;
    classifiedUsd += costUsd;
  }
  if (ephemeralRuns.size > 0) lines.get('kept-nowhere').reviews += ephemeralRuns.size;
  // The total less every other line: never below zero, so a cached total a
  // little behind the rows shows no negative spend.
  lines.get('other').spendUsd = Math.max(0, spendUsd - classifiedUsd);

  const list = lines.list().map((l) => ({ ...l, spendUsd: usd(l.spendUsd) }));
  return {
    month: {
      start: monthStart.toISOString(),
      end: nextMonthStart(monthStart).toISOString(),
    },
    reviews: list.reduce((sum, l) => sum + l.reviews, 0),
    calls: list.reduce((sum, l) => sum + l.calls, 0),
    spendUsd: usd(spendUsd),
    cap: capState
      ? {
          limitUsd: capState.limit,
          remainingUsd: usd(Math.max(0, capState.limit - capState.spent)),
          exceeded: capState.exceeded,
        }
      : null,
    credits: { balance, spentThisMonth: charged },
    lines: list,
  };
}

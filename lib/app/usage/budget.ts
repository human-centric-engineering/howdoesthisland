/**
 * Refuse a review before it starts when it would pass the workspace's
 * monthly budget (t-49, D6).
 *
 * Sunrise's gate refuses a judge once spend has *reached* the cap
 * (`checkBudget` in `run-judge.ts`), so a workspace near its cap paid for half
 * a review and got a `PARTIAL` one. This check runs first, before any judge
 * is called, on stored and `store: false` requests alike: it estimates the
 * review and refuses it with 402 `BUDGET_EXCEEDED` when the estimate is more
 * than what is left. The per-judge gate stays as the backstop for spend that
 * lands between this check and the judges.
 *
 * **The estimate**, in tiers, from this workspace's own history:
 *
 * 1. `profile` — the median `costUsd` of its last {@link PROFILE_HISTORY}
 *    completed reviews of the same profile, given at least
 *    {@link MIN_PROFILE_HISTORY}. Completed only: a review cut short (partial,
 *    failed, cancelled) spent less than a review costs, and would pull the
 *    estimate under it. A `custom` judge list is not a profile whose reviews
 *    are alike, so it always goes to the next tier.
 * 2. `judges` — the number of judges × the median `costUsd` of the workspace's
 *    last {@link JUDGE_HISTORY} succeeded judge runs.
 * 3. `none` — no history: the estimate is `0`, so any positive remainder is
 *    enough.
 *
 * Sunrise's workflow cost estimator does not transfer: it models a workflow's
 * DAG steps, not judge slots.
 *
 * **The cap** is the workspace's own (`quotas.monthlyBudgetUsd`), read as the
 * judge gate reads it. No cap, or one that cannot be read, refuses nothing
 * (`orgCapStateOrSkip`): the per-judge gate still applies. The install-wide
 * cap is left to that gate too: no workspace admin can raise it.
 *
 * Not done: re-checking a queued stored review when it is claimed.
 */
import { APIError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { orgCapStateOrSkip } from '@/lib/orchestration/llm/spend-caps';

/** Completed reviews of the profile the first tier reads. */
export const PROFILE_HISTORY = 20;
/** Fewer completed reviews of the profile than this, and the estimate goes per judge. */
export const MIN_PROFILE_HISTORY = 3;
/** Succeeded judge runs the second tier reads, most recent first. */
export const JUDGE_HISTORY = 100;

/** Where the refusal points: the page with the month's spend and the budget. */
export const USAGE_PAGE = '/usage';

export type EstimateBasis = 'profile' | 'judges' | 'none';

export interface ReviewEstimate {
  /** USD, to the millionth. */
  estimateUsd: number;
  basis: EstimateBasis;
}

/** What `BUDGET_EXCEEDED` carries in `details`. */
export interface BudgetRefusalDetails extends ReviewEstimate {
  /** What is left of the monthly budget; `0` once it is reached. */
  remainingUsd: number;
  limitUsd: number;
  usagePage: typeof USAGE_PAGE;
}

function usd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * What a review of `profile` (its stored name: `full`, a group, or `custom`)
 * calling `judgeCount` judges is likely to cost this workspace.
 */
export async function estimateReviewCost(
  orgId: string,
  profile: string,
  judgeCount: number
): Promise<ReviewEstimate> {
  if (profile !== 'custom') {
    const reviews = await prisma.assessment.findMany({
      where: { orgId, profile, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: PROFILE_HISTORY,
      select: { costUsd: true },
    });
    if (reviews.length >= MIN_PROFILE_HISTORY) {
      return { estimateUsd: usd(median(reviews.map((r) => r.costUsd))), basis: 'profile' };
    }
  }
  const runs = await prisma.judgeRun.findMany({
    where: { orgId, status: 'SUCCEEDED' },
    orderBy: { createdAt: 'desc' },
    take: JUDGE_HISTORY,
    select: { costUsd: true },
  });
  if (runs.length > 0) {
    return {
      estimateUsd: usd(judgeCount * median(runs.map((r) => r.costUsd))),
      basis: 'judges',
    };
  }
  return { estimateUsd: 0, basis: 'none' };
}

/**
 * Throw 402 `BUDGET_EXCEEDED` when a review of `profile` calling `judgeCount`
 * judges would pass what is left of the workspace's monthly budget: when
 * nothing is left, or the estimate is more than what is. A review calling no
 * judge (the quick profile) spends nothing and is never refused.
 */
export async function assertReviewWithinBudget(
  orgId: string,
  profile: string,
  judgeCount: number
): Promise<void> {
  if (judgeCount === 0) return;
  const cap = await orgCapStateOrSkip(orgId, { check: 'review-estimate' });
  if (!cap) return;
  const remainingUsd = usd(Math.max(0, cap.limit - cap.spent));
  const estimate = await estimateReviewCost(orgId, profile, judgeCount);
  if (remainingUsd > 0 && estimate.estimateUsd <= remainingUsd) return;

  const details: BudgetRefusalDetails = {
    ...estimate,
    remainingUsd,
    limitUsd: cap.limit,
    usagePage: USAGE_PAGE,
  };
  const message =
    remainingUsd > 0
      ? `This review would cost about $${estimate.estimateUsd.toFixed(2)}, more than the $${remainingUsd.toFixed(2)} left of the workspace's $${cap.limit.toFixed(2)} monthly AI budget.`
      : `The workspace has used its $${cap.limit.toFixed(2)} monthly AI budget.`;
  throw new APIError(
    `${message} No AI reviewer was started. See ${USAGE_PAGE}; an admin can raise the budget on /admin.`,
    'BUDGET_EXCEEDED',
    402,
    { ...details }
  );
}

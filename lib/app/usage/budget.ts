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
 * **The estimate** is a cost per judge × the judges this request calls, the
 * cost per judge in tiers from this workspace's own history:
 *
 * 1. `profile` — the median of `costUsd / judges.length` over its last
 *    {@link PROFILE_HISTORY} completed reviews of the same profile, given at
 *    least {@link MIN_PROFILE_HISTORY}. Per judge, so a profile whose judge
 *    list differs between frameworks or versions is scaled to this request;
 *    a review's cost includes its editor's. Completed only: a review cut short
 *    (partial, failed, cancelled) spent less than a review costs. A `custom`
 *    judge list is not a profile whose reviews are alike, so it always goes
 *    to the next tier.
 * 2. `judges` — the median `costUsd` of the workspace's last
 *    {@link JUDGE_HISTORY} succeeded judge runs, plus, for a review the editor
 *    runs on (`EDITOR_MIN_JUDGES`), an editor allowance: the median of what
 *    its last completed reviews spent beyond their judge runs.
 * 3. `none` — no history: the estimate is `0`, so any positive remainder is
 *    enough.
 *
 * **What is left** is the cap less this month's spend, less what the
 * workspace's stored reviews still queued or running are yet to spend (each
 * one's judges at this request's cost per judge, less what it has spent), so
 * a burst of requests does not each see the same remainder.
 *
 * Sunrise's workflow cost estimator does not transfer: it models a workflow's
 * DAG steps, not judge slots.
 *
 * **The cap** is the workspace's own (`quotas.monthlyBudgetUsd`), read as the
 * judge gate reads it. No cap, or one that cannot be read, refuses nothing
 * (`orgCapStateOrSkip`): the per-judge gate still applies. The install-wide
 * cap is left to that gate too: no workspace admin can raise it.
 *
 * Not done: re-checking a queued stored review when it is claimed; history
 * from `store: false` reviews, which leave no assessment or judge-run rows (a
 * workspace with only those estimates `0`), and holding back for those in
 * flight.
 */
import { APIError } from '@/lib/api/errors';
import { EDITOR_MIN_JUDGES } from '@/lib/app/assessments/editor';
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
  /** What is left of the monthly budget once in-flight reviews are held back; `0` once none is. */
  remainingUsd: number;
  /** What the workspace's stored reviews still queued or running are estimated yet to spend. */
  inFlightUsd: number;
  limitUsd: number;
  usagePage: typeof USAGE_PAGE;
}

interface JudgeRate {
  /** What one judge costs; at the `profile` tier, its share of the editor too. */
  perJudgeUsd: number;
  /** Added once to a review the editor runs on, at the `judges` tier. */
  editorUsd: number;
  basis: EstimateBasis;
}

function usd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Dollars for a message: cents, or four places for an amount under a cent. */
function dollars(value: number): string {
  return `$${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function judgeRate(orgId: string, profile: string): Promise<JudgeRate> {
  if (profile !== 'custom') {
    const reviews = await prisma.assessment.findMany({
      where: { orgId, profile, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: PROFILE_HISTORY,
      select: { costUsd: true, judges: true },
    });
    const shares = reviews
      .filter((r) => r.judges.length > 0)
      .map((r) => r.costUsd / r.judges.length);
    if (shares.length >= MIN_PROFILE_HISTORY) {
      return { perJudgeUsd: median(shares), editorUsd: 0, basis: 'profile' };
    }
  }
  const runs = await prisma.judgeRun.findMany({
    where: { orgId, status: 'SUCCEEDED' },
    orderBy: { createdAt: 'desc' },
    take: JUDGE_HISTORY,
    select: { costUsd: true },
  });
  if (runs.length === 0) return { perJudgeUsd: 0, editorUsd: 0, basis: 'none' };
  const reviews = await prisma.assessment.findMany({
    where: { orgId, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    take: PROFILE_HISTORY,
    select: { costUsd: true, judges: true, judgeRuns: { select: { costUsd: true } } },
  });
  const editorCosts = reviews
    .filter((r) => r.judges.length >= EDITOR_MIN_JUDGES)
    .map((r) => Math.max(0, r.costUsd - r.judgeRuns.reduce((sum, run) => sum + run.costUsd, 0)));
  return {
    perJudgeUsd: median(runs.map((r) => r.costUsd)),
    editorUsd: editorCosts.length > 0 ? median(editorCosts) : 0,
    basis: 'judges',
  };
}

function reviewCost(rate: JudgeRate, judgeCount: number): number {
  const editor = judgeCount >= EDITOR_MIN_JUDGES ? rate.editorUsd : 0;
  return judgeCount * rate.perJudgeUsd + editor;
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
  const rate = await judgeRate(orgId, profile);
  return { estimateUsd: usd(reviewCost(rate, judgeCount)), basis: rate.basis };
}

/** What the workspace's stored reviews still queued or running are yet to spend, at `rate`. */
async function inFlightCost(orgId: string, rate: JudgeRate): Promise<number> {
  const open = await prisma.assessment.findMany({
    where: { orgId, status: { in: ['QUEUED', 'RUNNING'] } },
    select: { costUsd: true, judges: true },
  });
  return open.reduce(
    (sum, r) => sum + Math.max(0, reviewCost(rate, r.judges.length) - r.costUsd),
    0
  );
}

/**
 * Throw 402 `BUDGET_EXCEEDED` when a review of `profile` calling `judgeCount`
 * judges would pass what is left of the workspace's monthly budget: when
 * nothing is left, or the estimate is more than what is once the reviews
 * already queued or running are held back. A review calling no judge (the
 * quick profile) spends nothing and is never refused.
 */
export async function assertReviewWithinBudget(
  orgId: string,
  profile: string,
  judgeCount: number
): Promise<void> {
  if (judgeCount === 0) return;
  const cap = await orgCapStateOrSkip(orgId, { check: 'review-estimate' });
  if (!cap) return;
  const usedUp = cap.spent >= cap.limit;
  const rate = await judgeRate(orgId, profile);
  const estimate = reviewCost(rate, judgeCount);
  const inFlight = usedUp ? 0 : await inFlightCost(orgId, rate);
  const remaining = Math.max(0, cap.limit - cap.spent - inFlight);
  if (!usedUp && remaining > 0 && estimate <= remaining) return;

  const details: BudgetRefusalDetails = {
    estimateUsd: usd(estimate),
    basis: rate.basis,
    remainingUsd: usd(remaining),
    inFlightUsd: usd(inFlight),
    limitUsd: cap.limit,
    usagePage: USAGE_PAGE,
  };
  const held =
    inFlight > 0 ? ` once ${dollars(inFlight)} is held for reviews already queued or running` : '';
  const message = usedUp
    ? `The workspace has used its ${dollars(cap.limit)} monthly AI budget.`
    : `This review would cost about ${dollars(estimate)}, more than the ${dollars(remaining)} left${held} of the workspace's ${dollars(cap.limit)} monthly AI budget.`;
  throw new APIError(
    `${message} No AI reviewer was started. See ${USAGE_PAGE}; an admin can raise the budget on /admin.`,
    'BUDGET_EXCEEDED',
    402,
    { ...details }
  );
}

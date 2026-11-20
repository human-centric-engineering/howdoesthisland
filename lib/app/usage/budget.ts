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
 * **The estimate** is a cost per judge × the judges this request calls, plus
 * an editor allowance for a review the editor runs on (`EDITOR_MIN_JUDGES`).
 * The cost per judge, in tiers from this workspace's own history:
 *
 * 1. `profile` — over its last {@link PROFILE_HISTORY} completed reviews of
 *    the same profile, given at least {@link MIN_PROFILE_HISTORY}: the median
 *    of each one's judge spend (its cost less its editor's) per judge. Per
 *    judge, so a profile whose judge list differs between frameworks or
 *    versions is scaled to this request. Completed only: a review cut short
 *    (partial, failed, cancelled) spent less than a review costs. A `custom`
 *    judge list is not a profile whose reviews are alike, so it always goes
 *    to the next tier.
 * 2. `judges` — the median `costUsd` of the workspace's last
 *    {@link JUDGE_HISTORY} succeeded judge runs.
 * 3. `kept-nowhere` — no stored judge run: the median spend of the judges of
 *    the workspace's `store: false` reviews (t-51), which leave only cost
 *    rows. A judge's spend is its rows' sum, by the `ephemeralRun` tag and
 *    `judge` they carry; one whose row carries an `error` is left out, as a
 *    judge run that did not succeed is. Read from the workspace's last
 *    {@link KEPT_NOWHERE_SCAN} cost rows, at most {@link JUDGE_HISTORY}
 *    judges: the read the org's `[orgId, createdAt]` index serves, bounded,
 *    since no index reaches into the rows' metadata. A workspace whose recent
 *    rows are all other AI use goes to the next tier.
 * 4. `none` — no history: the estimate is `0`, so any positive remainder is
 *    enough.
 *
 * The editor allowance is the median of what the reviews the tier read (the
 * profile's, or else the workspace's last completed ones) spent beyond their
 * judge runs, over those the editor ran on: its call is on no judge run. A
 * `kept-nowhere` rate has none: the editor never runs on those reviews, and a
 * workspace with no stored judge run has no editor spend to read.
 *
 * **What is left** is the cap less this month's spend, less what the
 * workspace's stored reviews in flight are yet to spend, so a request does
 * not count on budget a review already accepted will use. A judge counts as
 * settled once it answered or failed for good; one that failed in a way a
 * re-drive runs again (`RETRIED_ON_REDRIVE`) is not.
 *
 * - One queued or running: what it is yet to call, at this request's rate:
 *   a judge for each slot not yet settled, and the editor allowance for a
 *   review the editor runs on (t-55). Not its estimate less what it has
 *   spent: a re-drive calls a judge that is not settled again at a full
 *   judge's cost, and the editor again, while a re-driven judge's row carries
 *   its first attempt's spend on, so what it spent says little about what is
 *   to come. A row that failed retryably in this run is held as one a
 *   re-drive retries, though a re-drive may never come: the rows cannot tell
 *   the two apart. The editor is held until the review is final for the same
 *   reason. Judges it settled last month are reused, not called again (t-52).
 *   A running review whose lease has run out is held all the same: recovery
 *   runs it again.
 * - One cancelled whose lease is still live (`places.ts` counts it the same
 *   way): no further judge starts, but what was already called finishes and
 *   is billed. That is either judges still landing or, once the fan-out has
 *   ended, the editor (a cancel before then stops the run before the editor),
 *   never both. A failed row a re-drive retries cannot be told apart from one
 *   that failed in this run, so the hold is the larger of the two: its
 *   unsettled judges, at most {@link JUDGES_IN_FLIGHT}, at this request's
 *   rate, or its editor allowance. An upper bound, which lasts only while
 *   the lease does: judges never started are among the unsettled, and an
 *   editor already billed is held until the run clears its lease. Once it
 *   has, nothing. The run renews the lease of a cancelled review until its
 *   judges and editor have landed (t-56).
 *
 * The judge runs of these reviews are read by `assessmentId` (the
 * `[assessmentId, judge]` unique index).
 *
 * - A request not yet stored, or a `store: false` review running: its
 *   {@link BudgetHold} (below), its judges at this request's rate and the
 *   editor allowance for a stored review the editor will run on. A `store:
 *   false` review is held at all its judges until it ends, since it records
 *   none as they land: an upper bound for a run's few minutes.
 *
 * **Requests arriving together** (t-50). A request stores its review only
 * once intake has fetched or read its source (seconds), and a `store: false`
 * one never does, so the check alone would let requests sent together each
 * pass on the same remainder. {@link reserveReviewBudget} therefore checks
 * and holds in one transaction under a per-workspace advisory lock
 * (`pg_advisory_xact_lock`): a request checked behind another sees its hold.
 * The route takes it last, after the place check and the per-user cap, and
 * checks first with {@link assertReviewFits}, which holds nothing: a request
 * refused 429 never holds budget another is refused 402 for.
 * The hold lasts until the review is stored, whose row is then held in its
 * place, or for `store: false` until the run ends; it is released too
 * however the request ends before then (failed, the caller gone). It is
 * renewed every `LEASE_RENEW_MS` while held, so one whose process died stops
 * counting when its lease runs out, and the next check deletes it (a delete
 * that fails is logged, and the check goes on). Released just after the review is stored, so for a moment both
 * are held: a request checked then is refused on the side of caution, never
 * passed on budget nobody holds. The transaction has room for a burst to
 * queue for the lock (`HOLD_TRANSACTION`). Waiting, it holds a pooled
 * connection, so a burst for one workspace can take every connection the
 * instance has (10 by default, 1 with `DATABASE_POOL_MAX=1`) and its other
 * queries wait behind it, each for the few queries a holder runs. A request
 * refused here, after the route counted it against the per-user cap, keeps
 * that count: it passed {@link assertReviewFits} and lost the lock's race,
 * which only requests sent together do. A check that still cannot take the
 * lock or a connection in time is refused 429 `RATE_LIMIT_EXCEEDED`, to try
 * again: passed, it would spend on a remainder checked before the burst. One
 * that fails otherwise refuses nothing, as one that cannot read the history:
 * the per-judge gate applies.
 *
 * A `store: false` request is estimated, and held, without the editor
 * allowance: the editor never runs on it.
 *
 * Sunrise's workflow cost estimator does not transfer: it models a workflow's
 * DAG steps, not judge slots.
 *
 * **The cap** is the workspace's own (`quotas.monthlyBudgetUsd`), read as the
 * judge gate reads it. No cap, or one that cannot be read, refuses nothing
 * (`orgCapStateOrSkip`): the per-judge gate still applies. History that cannot
 * be read refuses nothing either. The install-wide cap is left to that gate
 * too: no workspace admin can raise it.
 *
 * **Indexes.** Every query here runs on each non-quick request, the first
 * time before the per-user limiter, so each reads an index that serves its filter and order
 * (t-54): `Assessment` `[orgId, profile, status, createdAt]` and
 * `[orgId, status, createdAt]`, `JudgeRun` `[orgId, status, createdAt]`.
 *
 * **Again when it is claimed** (t-53). A stored review can wait in the queue
 * (the workspace's running limit) while other spend lands, so `run.ts` asks
 * {@link budgetRefusal} again when it claims one that has no judge run yet.
 * It holds back only the reviews in flight created before this one, not
 * itself and not those after it: each later review was admitted with this
 * one held back already, so older reviews come first. Holding back both ways
 * would let two reviews claimed together each refuse on the other's account,
 * and neither run where one fitted. A later review already running is not
 * held, which the per-judge gate is left to catch. Of the holds, only
 * `store: false` ones taken before this review was created count: a stored
 * request's hold is a later review once stored, and until its request
 * releases it, may be this review's own. A refused one is finished
 * `FAILED` with `errorCode` `BUDGET_EXCEEDED`, the reason in `error` and these
 * figures in `errorDetails`, before any judge is called. A review with judge
 * runs (a re-drive) is not checked again: what it already spent would be
 * thrown away, and the per-judge gate ends it `PARTIAL` with what it has.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { APIError, ErrorCodes } from '@/lib/api/errors';
import { EDITOR_MIN_JUDGES } from '@/lib/app/assessments/editor';
import {
  JUDGES_IN_FLIGHT,
  LEASE_MS,
  LEASE_RENEW_MS,
  RETRIED_ON_REDRIVE,
} from '@/lib/app/assessments/limits';
import { prisma } from '@/lib/db/client';
import { isTimeoutError } from '@/lib/privacy/erasure-deadline';
import { logger } from '@/lib/logging';
import { orgCapStateOrSkip } from '@/lib/orchestration/llm/spend-caps';
import { USAGE_PAGE, type BudgetRefusalDetails } from '@/lib/app/usage/wire';

/** Completed reviews of the profile the first tier reads. */
export const PROFILE_HISTORY = 20;
/** Fewer completed reviews of the profile than this, and the estimate goes per judge. */
export const MIN_PROFILE_HISTORY = 3;
/** Succeeded judge runs the second tier reads, most recent first. */
export const JUDGE_HISTORY = 100;
/** The workspace's cost rows, most recent first, the `kept-nowhere` tier reads. */
export const KEPT_NOWHERE_SCAN = 500;
/** The rows at a full scan's end whose runs are left out: see `keptNowhereRate`. */
export const KEPT_NOWHERE_TAIL = 50;

export type EstimateBasis = BudgetRefusalDetails['basis'];

export interface ReviewEstimate {
  /** USD, to the millionth. */
  estimateUsd: number;
  basis: EstimateBasis;
}

/**
 * A request's cost per judge, as {@link assertReviewFits} read it, for
 * {@link reserveReviewBudget} to reuse rather than read the history again.
 */
export type ReviewRate = Readonly<JudgeRate>;

interface JudgeRate {
  /** What one judge costs. */
  perJudgeUsd: number;
  /** Added once to a review the editor runs on. */
  editorUsd: number;
  basis: EstimateBasis;
}

interface PastReview {
  costUsd: number;
  judges: string[];
  judgeRuns: { costUsd: number }[];
}

const PAST_REVIEW = {
  costUsd: true,
  judges: true,
  judgeRuns: { select: { costUsd: true } },
} as const;

function usd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Dollars for a message: cents, four places under a cent, or "under $0.0001". */
function dollars(value: number): string {
  if (value > 0 && value < 0.00005) return 'under $0.0001';
  return `$${value > 0 && value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * What `review` spent beyond its judge runs: its editor's call. `0` for a
 * review the editor did not run on, or with no judge runs to subtract.
 */
function editorSpend(review: PastReview): number {
  if (review.judges.length < EDITOR_MIN_JUDGES || review.judgeRuns.length === 0) return 0;
  return Math.max(0, review.costUsd - review.judgeRuns.reduce((sum, run) => sum + run.costUsd, 0));
}

/** The median editor spend over the `reviews` the editor ran on; `0` with none. */
function editorAllowance(reviews: readonly PastReview[]): number {
  const spends = reviews
    .filter((r) => r.judges.length >= EDITOR_MIN_JUDGES && r.judgeRuns.length > 0)
    .map(editorSpend);
  return spends.length > 0 ? median(spends) : 0;
}

/** A cost row of a `store: false` review's judge (`run-judge.ts` writes it). */
const keptNowhereJudgeRow = z.object({
  ephemeral: z.literal(true),
  ephemeralRun: z.string(),
  judge: z.string(),
  error: z.string().optional(),
  calibrationRunId: z.string().optional(),
});

/** The `kept-nowhere` tier: see the file header. */
async function keptNowhereRate(orgId: string): Promise<JudgeRate | null> {
  const rows = await prisma.aiCostLog.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    take: KEPT_NOWHERE_SCAN,
    select: { totalCostUsd: true, metadata: true },
  });
  // Newest first, as the rows are: one entry per judge of a run.
  const judges = new Map<string, { run: string; costUsd: number; failed: boolean }>();
  /** Runs with a row near the scan's end, where their other rows may be cut off. */
  const nearEnd = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const parsed = keptNowhereJudgeRow.safeParse(row.metadata);
    // A calibration run's judges are tagged ephemeral too; they are not this workspace's reviews.
    if (!parsed.success || parsed.data.calibrationRunId !== undefined) continue;
    const key = JSON.stringify([parsed.data.ephemeralRun, parsed.data.judge]);
    const judge = judges.get(key) ?? { run: parsed.data.ephemeralRun, costUsd: 0, failed: false };
    judge.costUsd += row.totalCostUsd;
    judge.failed ||= parsed.data.error !== undefined;
    judges.set(key, judge);
    if (index >= rows.length - KEPT_NOWHERE_TAIL) nearEnd.add(parsed.data.ephemeralRun);
  }
  // A full scan may have cut short the runs at its end, whose judges' rows
  // (and those of runs alongside) interleave as they land: leave every judge
  // of a run near the end out, rather than count any at part of its cost.
  if (rows.length === KEPT_NOWHERE_SCAN) {
    for (const [key, judge] of judges) if (nearEnd.has(judge.run)) judges.delete(key);
  }
  const costs = [...judges.values()]
    .filter((j) => !j.failed)
    .slice(0, JUDGE_HISTORY)
    .map((j) => j.costUsd);
  if (costs.length === 0) return null;
  return { perJudgeUsd: median(costs), editorUsd: 0, basis: 'kept-nowhere' };
}

async function judgeRate(orgId: string, profile: string): Promise<JudgeRate> {
  if (profile !== 'custom') {
    const reviews = await prisma.assessment.findMany({
      where: { orgId, profile, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: PROFILE_HISTORY,
      select: PAST_REVIEW,
    });
    const judged = reviews.filter((r) => r.judges.length > 0);
    if (judged.length >= MIN_PROFILE_HISTORY) {
      return {
        perJudgeUsd: median(judged.map((r) => (r.costUsd - editorSpend(r)) / r.judges.length)),
        editorUsd: editorAllowance(judged),
        basis: 'profile',
      };
    }
  }
  const runs = await prisma.judgeRun.findMany({
    where: { orgId, status: 'SUCCEEDED' },
    orderBy: { createdAt: 'desc' },
    take: JUDGE_HISTORY,
    select: { costUsd: true },
  });
  if (runs.length === 0) {
    return (await keptNowhereRate(orgId)) ?? { perJudgeUsd: 0, editorUsd: 0, basis: 'none' };
  }
  const reviews = await prisma.assessment.findMany({
    where: { orgId, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    take: PROFILE_HISTORY,
    select: PAST_REVIEW,
  });
  return {
    perJudgeUsd: median(runs.map((r) => r.costUsd)),
    editorUsd: editorAllowance(reviews),
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

/** Whether a judge run is settled: answered, or failed in a way no re-drive runs again. */
function settled(run: { status: string; errorCode: string | null }): boolean {
  return run.status === 'SUCCEEDED' || !run.errorCode || !RETRIED_ON_REDRIVE.has(run.errorCode);
}

/** What a review calling `judges` judges, with the editor if `stored`, costs at `rate`. */
function heldCost(rate: JudgeRate, judges: number, stored: boolean): number {
  return stored ? reviewCost(rate, judges) : judges * rate.perJudgeUsd;
}

/**
 * What the workspace's reviews in flight, and the requests holding budget,
 * are yet to spend at `rate`, as of `now`: see "What is left" in the file
 * header. With `self`, only those created before it: see "Again when it is
 * claimed". Reads through `db`, the lock's transaction when there is one.
 */
async function inFlightCost(
  db: Prisma.TransactionClient,
  orgId: string,
  rate: JudgeRate,
  now: Date,
  self?: ClaimedReview
): Promise<number> {
  const holds = await db.budgetHold.findMany({
    where: {
      orgId,
      leaseExpiresAt: { gt: now },
      // At claim, a stored request's hold is a later review once stored, and
      // may be this review's own until its request releases it.
      ...(self ? { stored: false, createdAt: { lt: self.createdAt } } : {}),
    },
    select: { judges: true, stored: true },
  });
  const held = holds.reduce((sum, h) => sum + heldCost(rate, h.judges, h.stored), 0);
  const open = await db.assessment.findMany({
    where: {
      orgId,
      // Created before it, ties broken on the id, so two created together still hold one way.
      ...(self
        ? {
            AND: [
              {
                OR: [
                  { createdAt: { lt: self.createdAt } },
                  { createdAt: self.createdAt, id: { lt: self.id } },
                ],
              },
            ],
          }
        : {}),
      OR: [
        { status: { in: ['QUEUED', 'RUNNING'] } },
        { status: 'CANCELLED', leaseExpiresAt: { gt: now } },
      ],
    },
    select: { id: true, status: true, judges: true },
  });
  const runs =
    open.length > 0
      ? await db.judgeRun.findMany({
          where: { orgId, assessmentId: { in: open.map((r) => r.id) } },
          select: { assessmentId: true, status: true, errorCode: true },
        })
      : [];
  return open.reduce((sum, r) => {
    const done = runs.filter((run) => run.assessmentId === r.id && settled(run)).length;
    const unsettled = Math.max(0, r.judges.length - done);
    const editor = r.judges.length >= EDITOR_MIN_JUDGES ? rate.editorUsd : 0;
    if (r.status !== 'CANCELLED') return sum + unsettled * rate.perJudgeUsd + editor;
    const judges = Math.min(JUDGES_IN_FLIGHT, unsettled) * rate.perJudgeUsd;
    return sum + Math.max(judges, editor);
  }, held);
}

/** A stored review checked again as it is claimed (t-53). */
export interface ClaimedReview {
  id: string;
  createdAt: Date;
}

/** A review the budget refuses: why, in words, and the figures. */
export interface BudgetRefusal {
  /** Why, with the figures: what a stored review refused at claim keeps in `error`. */
  reason: string;
  /** The reason and what to do about it: the 402's message. */
  message: string;
  details: BudgetRefusalDetails;
}

/** The workspace's cap, as the judge gate reads it, and this request's rate. */
interface Budget {
  limit: number;
  spent: number;
  rate: JudgeRate;
}

/** As a cap that cannot be read: refuse nothing, and the per-judge gate applies. */
function unreadable(orgId: string, err: unknown): null {
  logger.warn('Review budget estimate unreadable; not refusing', {
    orgId,
    error: err instanceof Error ? err.message : String(err),
  });
  return null;
}

/**
 * The cap and the rate for a review of `profile`, or `rate` when the request
 * already read it; `null` when there is no cap or either cannot be read.
 */
async function readBudget(
  orgId: string,
  profile: string,
  rate?: ReviewRate
): Promise<Budget | null> {
  const cap = await orgCapStateOrSkip(orgId, { check: 'review-estimate' });
  if (!cap) return null;
  try {
    return { limit: cap.limit, spent: cap.spent, rate: rate ?? (await judgeRate(orgId, profile)) };
  } catch (err) {
    return unreadable(orgId, err);
  }
}

const usedUp = (budget: Budget) => budget.spent >= budget.limit;

/** The refusal for a review of `judgeCount` judges with `inFlight` held back, or `null` when it fits. */
function refusalFor(
  budget: Budget,
  judgeCount: number,
  inFlight: number,
  stored: boolean
): BudgetRefusal | null {
  const { limit, spent, rate } = budget;
  const estimate = heldCost(rate, judgeCount, stored);
  const remaining = Math.max(0, limit - spent - inFlight);
  if (!usedUp(budget) && remaining > 0 && estimate <= remaining) return null;

  const details: BudgetRefusalDetails = {
    estimateUsd: usd(estimate),
    basis: rate.basis,
    remainingUsd: usd(remaining),
    inFlightUsd: usd(inFlight),
    limitUsd: limit,
    usagePage: USAGE_PAGE,
  };
  const workspaceBudget = `the workspace's ${dollars(limit)} monthly AI budget`;
  const held =
    inFlight > 0
      ? ` once ${dollars(inFlight)} is held for reviews already starting, queued, running or finishing`
      : '';
  let message: string;
  if (usedUp(budget)) message = `The workspace has used its ${dollars(limit)} monthly AI budget.`;
  else if (remaining <= 0)
    message = `Reviews already starting, queued, running or finishing are held the rest of ${workspaceBudget} (${dollars(inFlight)}).`;
  else
    message = `This review would cost about ${dollars(estimate)}, more than the ${dollars(remaining)} left${held} of ${workspaceBudget}.`;
  return {
    reason: message,
    message: `${message} No AI reviewer was started. See ${USAGE_PAGE}; an admin can raise the budget on /admin.`,
    details,
  };
}

/**
 * Whether a review of `profile` calling `judgeCount` judges would pass what
 * is left of the workspace's monthly budget: when nothing is left, or the
 * estimate is more than what is once the reviews in flight and the holds are
 * held back. `null` when it fits, calls no judge, or the cap or history
 * cannot be read. `self` is a stored review being checked as it is claimed
 * (t-53): only the reviews in flight and holds from before it are held back.
 * Holds nothing itself: a request is checked with {@link reserveReviewBudget}.
 */
export async function budgetRefusal(
  orgId: string,
  profile: string,
  judgeCount: number,
  self?: ClaimedReview
): Promise<BudgetRefusal | null> {
  if (judgeCount === 0) return null;
  const budget = await readBudget(orgId, profile);
  if (!budget) return null;
  let inFlight = 0;
  if (!usedUp(budget)) {
    try {
      inFlight = await inFlightCost(prisma, orgId, budget.rate, new Date(), self);
    } catch (err) {
      return unreadable(orgId, err);
    }
  }
  // A review claimed is a stored one.
  return refusalFor(budget, judgeCount, inFlight, true);
}

/**
 * Throw 402 `BUDGET_EXCEEDED` when {@link budgetRefusal} would refuse a
 * review of `profile` calling `judgeCount` judges. Holds nothing: a request
 * checked before its other refusals, which {@link reserveReviewBudget} checks
 * again. Answers the rate it read, for that check to reuse; `null` when it
 * calls no judge, there is no cap, or either cannot be read.
 */
export async function assertReviewFits(
  orgId: string,
  profile: string,
  judgeCount: number,
  stored: boolean
): Promise<ReviewRate | null> {
  if (judgeCount === 0) return null;
  const budget = await readBudget(orgId, profile);
  if (!budget) return null;
  let inFlight = 0;
  if (!usedUp(budget)) {
    try {
      inFlight = await inFlightCost(prisma, orgId, budget.rate, new Date());
    } catch (err) {
      return unreadable(orgId, err);
    }
  }
  const refusal = refusalFor(budget, judgeCount, inFlight, stored);
  if (refusal) refuse(refusal);
  return budget.rate;
}

/** What a request holds of the budget: see "Requests arriving together" in the file header. */
export interface BudgetHold {
  readonly id: string;
  /** Stop renewing and delete it. Safe to call more than once; never throws. */
  release: () => Promise<void>;
}

/**
 * Room for a burst of requests to queue for a connection and the lock, each
 * holding it for a few queries: Prisma's defaults (2s, 5s) would time the
 * back of a burst out, and a check that times out refuses nothing.
 */
const HOLD_TRANSACTION = { maxWait: 10_000, timeout: 15_000 };

/** The advisory lock a workspace's checks take in turn. */
function lockKey(orgId: string): string {
  return `app:budget-hold:${orgId}`;
}

function refuse(refusal: BudgetRefusal): never {
  throw new APIError(refusal.message, 'BUDGET_EXCEEDED', 402, { ...refusal.details });
}

/** Renew the hold `id` until released. */
function keepHold(orgId: string, id: string): BudgetHold {
  let released = false;
  const timer = setInterval(() => {
    prisma.budgetHold
      .updateMany({ where: { id }, data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } })
      .then(({ count }) => {
        // Gone: its lease ran out (renewals failed for longer than it) and a
        // later check cleared it. The request carries on unheld.
        // Released while this renewal was in flight: deleted, not lost.
        if (count === 0 && !released) {
          clearInterval(timer);
          logger.warn('Budget hold lost before its request ended', { holdId: id, orgId });
        }
      })
      .catch((err: unknown) => {
        // Not fatal by itself: the lease has a minute left, and the next renewal may succeed.
        logger.warn('Budget hold renewal failed', {
          holdId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, LEASE_RENEW_MS);
  timer.unref?.();

  return {
    id,
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(timer);
      try {
        await prisma.budgetHold.deleteMany({ where: { id } });
      } catch (err) {
        // The lease runs out on its own; until then the budget stays held.
        logger.warn('Budget hold release failed', {
          holdId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

/**
 * Check a request for a review of `profile` calling `judgeCount` judges
 * against the workspace's budget and, when it fits, hold its estimate until
 * the caller releases it: once the review is stored (`stored`), or once a
 * `store: false` run ends, and however the request ends before either.
 * Throws 402 `BUDGET_EXCEEDED` when {@link budgetRefusal} would refuse it,
 * counting the holds of requests checked before it. `null` (nothing held)
 * when it calls no judge, there is no cap, or the cap, the history or the
 * lock cannot be had. `rate` is the one {@link assertReviewFits} read for
 * this request, if any: the history is not read again.
 */
export async function reserveReviewBudget(
  orgId: string,
  profile: string,
  judgeCount: number,
  stored: boolean,
  rate?: ReviewRate
): Promise<BudgetHold | null> {
  if (judgeCount === 0) return null;
  const budget = await readBudget(orgId, profile, rate);
  if (!budget) return null;
  // Nothing left: refused whatever is held, so no lock to wait for.
  const spentUp = usedUp(budget) ? refusalFor(budget, judgeCount, 0, stored) : null;
  if (spentUp) refuse(spentUp);

  // Holds whose process died: they count for nothing already, and nothing
  // else removes them. Outside the lock, so checks do not queue behind it.
  // Housekeeping: a delete that fails leaves them for the next check.
  try {
    await prisma.budgetHold.deleteMany({ where: { orgId, leaseExpiresAt: { lte: new Date() } } });
  } catch (err) {
    logger.warn('Expired budget holds not cleared', {
      orgId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let taken: { id: string } | { refusal: BudgetRefusal };
  try {
    taken = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey(orgId)}, 0))`;
      const now = new Date();
      const refusal = refusalFor(
        budget,
        judgeCount,
        await inFlightCost(tx, orgId, budget.rate, now),
        stored
      );
      if (refusal) return { refusal };
      return tx.budgetHold.create({
        data: {
          orgId,
          judges: judgeCount,
          stored,
          // Read under the lock, so a claim check orders it after every
          // review it counted (see "Again when it is claimed").
          createdAt: now,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        },
        select: { id: true },
      });
    }, HOLD_TRANSACTION);
  } catch (err) {
    // Swamped by a burst: passed, it would spend on a remainder checked
    // before the burst, which is what the lock is for.
    if (isTimeoutError(err)) {
      logger.warn('Budget hold timed out waiting for the lock or a connection; refusing', {
        orgId,
      });
      throw new APIError(
        'Too many reviews were requested at once for this workspace to check them against its budget. Try again in a moment.',
        ErrorCodes.RATE_LIMIT_EXCEEDED,
        429
      );
    }
    return unreadable(orgId, err);
  }
  if ('refusal' in taken) refuse(taken.refusal);
  return keepHold(orgId, taken.id);
}

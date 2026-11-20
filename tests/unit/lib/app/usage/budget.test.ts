/**
 * Tests: refusing a review before it starts when it would pass the
 * workspace's monthly budget (t-49).
 *
 * Mocked: Prisma (an in-memory fake of the cost rows, assessments and judge
 * runs, filtering and ordering as the queries ask), the org's quotas and the
 * logger. Real: the check and Sunrise's spend-caps module, so the cap it
 * compares against is the one the per-judge gate reads.
 *
 * @see lib/app/usage/budget.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ReviewRow {
  id: string;
  orgId: string;
  profile: string;
  status: string;
  costUsd: number;
  judges: string[];
  leaseExpiresAt: Date | null;
  createdAt: Date;
}
interface RunRow {
  orgId: string;
  assessmentId: string | null;
  status: string;
  errorCode: string | null;
  costUsd: number;
  createdAt: Date;
}

const state = vi.hoisted(() => ({
  spent: 0,
  budget: null as number | null,
  quotasFail: false,
  reviews: [] as ReviewRow[],
  runs: [] as RunRow[],
}));

type Where = Record<string, unknown>;
/** Equality, `{ in }`, `{ gt }`, `{ lt }` and a top-level `OR`: what the queries ask. */
const matches = (row: Record<string, unknown>, where: Where): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Where[]).some((w) => matches(row, w));
    if (typeof v !== 'object' || v === null || v instanceof Date) return row[k] === v;
    const value = row[k];
    if ('in' in v) return (v as { in: unknown[] }).in.includes(value);
    if ('gt' in v) return value instanceof Date && value > (v as { gt: Date }).gt;
    if ('lt' in v) return value instanceof Date && value < (v as { lt: Date }).lt;
    throw new Error(`fake cannot filter ${k} by ${JSON.stringify(v)}`);
  });
function newestFirst<T extends { createdAt: Date }>(rows: T[], take: number): T[] {
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take);
}

vi.mock('@/lib/db/client', () => ({
  prisma: {
    aiCostLog: {
      aggregate: vi.fn(async () => ({ _sum: { totalCostUsd: state.spent } })),
    },
    assessment: {
      findMany: vi.fn(async ({ where, take }: { where: Where; take?: number }) =>
        newestFirst(
          state.reviews.filter((r) => matches({ ...r }, where)),
          take ?? Infinity
        ).map((r) => ({
          id: r.id,
          status: r.status,
          costUsd: r.costUsd,
          judges: r.judges,
          createdAt: r.createdAt,
          judgeRuns: state.runs
            .filter((run) => run.assessmentId === r.id)
            .map((run) => ({ costUsd: run.costUsd, status: run.status, errorCode: run.errorCode })),
        }))
      ),
    },
    judgeRun: {
      findMany: vi.fn(async ({ where, take }: { where: Where; take: number }) =>
        newestFirst(
          state.runs.filter((r) => matches({ ...r }, where)),
          take
        ).map((r) => ({ costUsd: r.costUsd }))
      ),
    },
  },
}));
vi.mock('@/lib/tenancy/org-settings', () => ({
  loadOrgQuotas: vi.fn(async () => {
    if (state.quotasFail) throw new Error('settings unreadable');
    return state.budget === null ? {} : { monthlyBudgetUsd: state.budget };
  }),
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '@/lib/db/client';
import { forgetSpendCaps, utcMonthStart } from '@/lib/orchestration/llm/spend-caps';
import { APIError } from '@/lib/api/errors';
import { assertReviewWithinBudget, estimateReviewCost } from '@/lib/app/usage/budget';

const ORG = 'org-a';
const OTHER = 'org-b';
let clock = 0;
const at = () => new Date(Date.UTC(2026, 10, 1) + (clock += 1000));

/** `n` judge slots. */
const slots = (n: number) => Array.from({ length: n }, (_, i) => `j${i}`);

/** A review of the full profile; by default it called 1 judge, so `costUsd` is its cost per judge. */
function review(costUsd: number, over: Partial<ReviewRow> = {}): string {
  const id = `a${state.reviews.length}`;
  state.reviews.push({
    id,
    orgId: ORG,
    profile: 'full',
    status: 'COMPLETED',
    costUsd,
    judges: slots(1),
    leaseExpiresAt: null,
    createdAt: at(),
    ...over,
  });
  return id;
}
function judgeRun(costUsd: number, over: Partial<RunRow> = {}): void {
  state.runs.push({
    orgId: ORG,
    assessmentId: null,
    status: 'SUCCEEDED',
    errorCode: null,
    costUsd,
    createdAt: at(),
    ...over,
  });
}

/** The refusal `fn` throws, or a failure when it throws none. */
async function refusal(fn: () => Promise<void>): Promise<APIError> {
  const err = await fn().then(
    () => null,
    (e: unknown) => e
  );
  if (!(err instanceof APIError)) throw new Error(`expected an APIError, got ${String(err)}`);
  return err;
}

beforeEach(() => {
  forgetSpendCaps();
  vi.clearAllMocks();
  Object.assign(state, {
    spent: 0,
    budget: null,
    quotasFail: false,
    reviews: [],
    runs: [],
  });
});

describe('estimateReviewCost', () => {
  it('is the judge count × the median cost per judge of the last 20 completed reviews of the profile, given at least 3', async () => {
    // 21 reviews: the oldest, at $100, is past the last 20 and does not count.
    review(100);
    for (let i = 1; i <= 20; i += 1) review(i * 0.1);
    // Not the profile, not completed, or not this workspace: none counts.
    review(50, { profile: 'quick-group' });
    review(50, { status: 'PARTIAL' });
    review(50, { orgId: OTHER });

    const estimate = await estimateReviewCost(ORG, 'full', 2);

    // The median of 0.1 … 2.0 a judge is (1.0 + 1.1) / 2 = 1.05; × 2 judges.
    expect(estimate).toEqual({ estimateUsd: 2.1, basis: 'profile' });
  });

  it('scales the profile to this request: past reviews with fewer judges cost less each review, not each judge', async () => {
    // Three 'full' reviews on a 3-judge version at $0.15 each: $0.05 a judge.
    for (let i = 0; i < 3; i += 1) review(0.15, { judges: slots(3) });

    // A 'full' review on a 12-judge version.
    const estimate = await estimateReviewCost(ORG, 'full', 12);

    expect(estimate).toEqual({ estimateUsd: 0.6, basis: 'profile' });
  });

  it('with fewer than 3 of the profile, is the judge count × the median succeeded judge run', async () => {
    review(9);
    review(9);
    judgeRun(0.02);
    judgeRun(0.04);
    judgeRun(0.1);
    judgeRun(5, { status: 'FAILED' });
    judgeRun(5, { orgId: OTHER });

    // One judge: the editor does not run, so no editor allowance.
    const estimate = await estimateReviewCost(ORG, 'full', 1);

    expect(estimate).toEqual({ estimateUsd: 0.04, basis: 'judges' });
  });

  it('per judge, adds what the editor cost past reviews to a review it runs on', async () => {
    // Completed 2-judge reviews whose judge runs cost $0.20 a review: the
    // rest of each review's cost is its editor's ($0.10, $0.12, $0.30).
    for (const editor of [0.1, 0.12, 0.3]) {
      const id = review(0.2 + editor, { profile: 'custom', judges: slots(2) });
      judgeRun(0.1, { assessmentId: id });
      judgeRun(0.1, { assessmentId: id });
    }
    // A 1-judge review has no editor: it does not feed the allowance.
    review(5, { profile: 'custom', judges: slots(1) });

    // 4 judges × $0.10 + the median editor, $0.12.
    expect(await estimateReviewCost(ORG, 'custom', 4)).toEqual({
      estimateUsd: 0.52,
      basis: 'judges',
    });
    // 1 judge: no editor.
    expect(await estimateReviewCost(ORG, 'custom', 1)).toEqual({
      estimateUsd: 0.1,
      basis: 'judges',
    });
  });

  it('goes per judge for a custom judge list, whatever reviews it has', async () => {
    for (let i = 0; i < 5; i += 1) review(9, { profile: 'custom', judges: slots(1) });
    judgeRun(0.05);

    const estimate = await estimateReviewCost(ORG, 'custom', 1);

    expect(estimate).toEqual({ estimateUsd: 0.05, basis: 'judges' });
    // Only the editor-allowance read: no profile read for a custom list.
    expect(prisma.assessment.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.assessment.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ profile: 'custom' }) })
    );
  });

  it('is 0 with no history', async () => {
    expect(await estimateReviewCost(ORG, 'full', 7)).toEqual({ estimateUsd: 0, basis: 'none' });
  });
});

describe('assertReviewWithinBudget', () => {
  beforeEach(() => {
    state.budget = 10;
    // An estimate of $1.00 a 7-judge review.
    for (let i = 0; i < 3; i += 1) review(1, { judges: slots(7) });
  });

  it('lets a review start when its estimate is under what is left', async () => {
    state.spent = 8.5;
    await expect(assertReviewWithinBudget(ORG, 'full', 7)).resolves.toBeUndefined();
  });

  it('lets a review start when its estimate is exactly what is left', async () => {
    state.spent = 9;
    await expect(assertReviewWithinBudget(ORG, 'full', 7)).resolves.toBeUndefined();
  });

  it('refuses a review whose estimate is over what is left, with the figures', async () => {
    state.spent = 9.25;

    const err = await refusal(() => assertReviewWithinBudget(ORG, 'full', 7));

    expect(err.status).toBe(402);
    expect(err.code).toBe('BUDGET_EXCEEDED');
    expect(err.details).toEqual({
      estimateUsd: 1,
      basis: 'profile',
      remainingUsd: 0.75,
      inFlightUsd: 0,
      limitUsd: 10,
      usagePage: '/usage',
    });
    expect(err.message).toContain('$1.00');
    expect(err.message).toContain('$0.75');
    expect(err.message).toContain('/usage');
  });

  it('refuses at the cap, with nothing left', async () => {
    state.spent = 10;

    const err = await refusal(() => assertReviewWithinBudget(ORG, 'full', 7));

    expect(err.code).toBe('BUDGET_EXCEEDED');
    expect(err.details).toMatchObject({ remainingUsd: 0, limitUsd: 10, estimateUsd: 1 });
  });

  it('with no history, lets any positive remainder through and refuses none left', async () => {
    state.reviews = [];
    state.spent = 9.999;
    await expect(assertReviewWithinBudget(ORG, 'full', 7)).resolves.toBeUndefined();

    forgetSpendCaps();
    state.spent = 10;
    const err = await refusal(() => assertReviewWithinBudget(ORG, 'full', 7));
    expect(err.details).toMatchObject({ estimateUsd: 0, basis: 'none', remainingUsd: 0 });
  });

  it('never refuses a review calling no judge (the quick profile), even past the cap', async () => {
    state.spent = 50;
    await expect(assertReviewWithinBudget(ORG, 'quick', 0)).resolves.toBeUndefined();
  });

  it('refuses nothing with no cap set, or a cap that cannot be read', async () => {
    state.budget = null;
    state.spent = 1_000;
    await expect(assertReviewWithinBudget(ORG, 'full', 7)).resolves.toBeUndefined();

    forgetSpendCaps();
    state.quotasFail = true;
    await expect(assertReviewWithinBudget(ORG, 'full', 7)).resolves.toBeUndefined();
  });
  it('holds back what reviews already queued or running are yet to spend', async () => {
    state.spent = 8;
    // A queued 7-judge review ($1.00 to come) and a running one that has spent $0.40 of its $1.00.
    review(0, { status: 'QUEUED', judges: slots(7) });
    review(0.4, { status: 'RUNNING', judges: slots(7) });
    // Another workspace's, and a finished one: neither is held.
    review(0, { status: 'QUEUED', judges: slots(7), orgId: OTHER });

    const err = await refusal(() => assertReviewWithinBudget(ORG, 'full', 7));

    // $2.00 left, $1.60 held: $0.40 is under the $1.00 estimate.
    expect(err.details).toMatchObject({ estimateUsd: 1, remainingUsd: 0.4, inFlightUsd: 1.6 });
    expect(err.message).toContain(
      'once $1.60 is held for reviews already queued, running or finishing'
    );
  });

  it('lets a review start when what is left after those in flight covers it', async () => {
    state.spent = 7;
    review(0, { status: 'QUEUED', judges: slots(7) });
    await expect(assertReviewWithinBudget(ORG, 'full', 7)).resolves.toBeUndefined();
  });

  it('is not used up by a remainder too small to round, short of the cap', async () => {
    state.reviews = [];
    state.spent = 9.9999996;
    // No history: an estimate of 0, and the cap not reached.
    await expect(assertReviewWithinBudget(ORG, 'full', 7)).resolves.toBeUndefined();
  });

  it('gives amounts under a cent to four places in the message', async () => {
    state.reviews = [];
    for (let i = 0; i < 3; i += 1) review(0.004, { judges: slots(1) });
    state.budget = 5;
    state.spent = 4.997;

    const err = await refusal(() => assertReviewWithinBudget(ORG, 'full', 1));

    expect(err.message).toContain('about $0.0040, more than the $0.0030 left');
  });

  it('says "under $0.0001" for an amount four places would show as zero', async () => {
    state.reviews = [];
    for (let i = 0; i < 3; i += 1) review(0.0001, { judges: slots(1) });
    state.spent = 9.99997;

    const err = await refusal(() => assertReviewWithinBudget(ORG, 'full', 1));

    expect(err.message).toContain('more than the under $0.0001 left');
    expect(err.message).not.toContain('$0.0000');
  });

  it('says the reviews in flight hold the rest when they leave nothing', async () => {
    state.spent = 8;
    // Two queued 7-judge reviews hold $2.00: all that is left.
    review(0, { status: 'QUEUED', judges: slots(7) });
    review(0, { status: 'QUEUED', judges: slots(7) });

    const err = await refusal(() => assertReviewWithinBudget(ORG, 'full', 7));

    expect(err.details).toMatchObject({ remainingUsd: 0, inFlightUsd: 2 });
    expect(err.message).toContain(
      "Reviews already queued, running or finishing are held the rest of the workspace's $10.00 monthly AI budget ($2.00)."
    );
    expect(err.message).not.toContain('more than the');
  });

  it('holds back a cancelled review for its judges still in flight, not its whole estimate', async () => {
    state.spent = 8;
    // Cancelled with its lease live: 7 judges, 1 saved, so at most 4 still running ($4/7).
    const id = review(0.1, {
      status: 'CANCELLED',
      judges: slots(7),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    judgeRun(0.1, { assessmentId: id });

    const err = await refusal(() => assertReviewWithinBudget(ORG, 'full', 13));

    // A 13-judge review at $1/7 a judge is $1.857143; $2.00 less $0.571429 held leaves $1.428571.
    expect(err.details).toMatchObject({ inFlightUsd: 0.571429, remainingUsd: 1.428571 });
  });

  it('holds back a cancelled review only for the judges it has not saved', async () => {
    state.spent = 8;
    // 7 judges, 5 saved: 2 can still be running ($2/7).
    const id = review(0.5, {
      status: 'CANCELLED',
      judges: slots(7),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    for (let i = 0; i < 5; i += 1) judgeRun(0.1, { assessmentId: id });

    const err = await refusal(() => assertReviewWithinBudget(ORG, 'full', 13));

    expect(err.details).toMatchObject({ inFlightUsd: 0.285714 });
  });

  it('holds nothing back for a cancelled review whose lease has gone', async () => {
    state.spent = 8;
    review(0, {
      status: 'CANCELLED',
      judges: slots(7),
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    review(0, { status: 'CANCELLED', judges: slots(7), leaseExpiresAt: null });

    const err = await refusal(() => assertReviewWithinBudget(ORG, 'full', 15));

    expect(err.details).toMatchObject({ inFlightUsd: 0, remainingUsd: 2 });
  });

  it('holds a review created last month for its estimate less all it has spent', async () => {
    state.spent = 8;
    // A running 7-judge review ($1.00) created last month, which has spent $0.50 in all.
    const lastMonth = new Date(utcMonthStart().getTime() - 60_000);
    review(0.5, { status: 'RUNNING', judges: slots(7), createdAt: lastMonth });

    const err = await refusal(() => assertReviewWithinBudget(ORG, 'full', 14));

    // $0.50 is all that can still land this month.
    expect(err.details).toMatchObject({ inFlightUsd: 0.5, remainingUsd: 1.5 });
  });

  it('holds a cancelled review for a judge a re-drive is running again', async () => {
    state.spent = 8;
    // 7 judges, all saved, but 2 failed with rate_limited and are being run again ($2/7).
    const id = review(0.5, {
      status: 'CANCELLED',
      judges: slots(7),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    for (let i = 0; i < 5; i += 1) judgeRun(0.1, { assessmentId: id });
    judgeRun(0, { assessmentId: id, status: 'FAILED', errorCode: 'rate_limited' });
    judgeRun(0, { assessmentId: id, status: 'FAILED', errorCode: 'provider_error' });

    const err = await refusal(() => assertReviewWithinBudget(ORG, 'full', 13));

    expect(err.details).toMatchObject({ inFlightUsd: 0.285714 });
  });

  it('holds a cancelled review for its editor when that is more than its unsettled judges', async () => {
    state.reviews = [];
    for (let i = 0; i < 3; i += 1) {
      const past = review(1, { judges: slots(7) });
      for (let j = 0; j < 7; j += 1) judgeRun(0.1, { assessmentId: past });
    }
    state.spent = 8;
    // One judge failed rate_limited: final in this run or being retried, which the rows cannot say.
    const id = review(0.6, {
      status: 'CANCELLED',
      judges: slots(7),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    for (let i = 0; i < 6; i += 1) judgeRun(0.1, { assessmentId: id });
    judgeRun(0, { assessmentId: id, status: 'FAILED', errorCode: 'rate_limited' });

    const err = await refusal(() => assertReviewWithinBudget(ORG, 'full', 20));

    // The larger of one judge ($0.10) and the editor ($0.30).
    expect(err.details).toMatchObject({ inFlightUsd: 0.3 });
  });

  it('holds a cancelled review whose judges are all settled for its editor', async () => {
    state.reviews = [];
    // History with an editor: 7-judge reviews that spent $0.70 on judges and $0.30 on the editor.
    for (let i = 0; i < 3; i += 1) {
      const past = review(1, { judges: slots(7) });
      for (let j = 0; j < 7; j += 1) judgeRun(0.1, { assessmentId: past });
    }
    state.spent = 8;
    const id = review(0.7, {
      status: 'CANCELLED',
      judges: slots(7),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    for (let i = 0; i < 6; i += 1) judgeRun(0.1, { assessmentId: id });
    // A judge that failed for good is settled.
    judgeRun(0, { assessmentId: id, status: 'FAILED', errorCode: 'invalid_reply' });

    const err = await refusal(() => assertReviewWithinBudget(ORG, 'full', 20));

    expect(err.details).toMatchObject({ inFlightUsd: 0.3 });
  });

  it('refuses nothing when the history cannot be read, as a cap that cannot be', async () => {
    state.spent = 9.99;
    vi.mocked(prisma.assessment.findMany).mockRejectedValueOnce(new Error('statement timeout'));

    await expect(assertReviewWithinBudget(ORG, 'full', 7)).resolves.toBeUndefined();
  });
});

describe('the editor in the profile tier', () => {
  it('takes the editor out of the cost per judge, and adds it back only where the editor runs', async () => {
    // Three completed 4-judge reviews: judges $0.10 each, an editor of $0.20.
    for (let i = 0; i < 3; i += 1) {
      const id = review(0.6, { judges: slots(4) });
      for (let j = 0; j < 4; j += 1) judgeRun(0.1, { assessmentId: id });
    }

    // 1 judge: no editor, $0.10 (not $0.15 with an editor share in it).
    expect(await estimateReviewCost(ORG, 'full', 1)).toEqual({
      estimateUsd: 0.1,
      basis: 'profile',
    });
    // 4 judges: $0.40 + the $0.20 editor.
    expect(await estimateReviewCost(ORG, 'full', 4)).toEqual({
      estimateUsd: 0.6,
      basis: 'profile',
    });
  });

  it('counts a review with no judge runs to subtract as all judge spend', async () => {
    for (let i = 0; i < 3; i += 1) review(0.6, { judges: slots(4) });

    expect(await estimateReviewCost(ORG, 'full', 4)).toEqual({
      estimateUsd: 0.6,
      basis: 'profile',
    });
  });
});

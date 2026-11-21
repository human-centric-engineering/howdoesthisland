/**
 * Tests: refusing a review before it starts when it would pass the
 * workspace's monthly budget (t-49), or its CopyCredits do not cover it
 * (t-58).
 *
 * The t-49 to t-56 tests run with credits to spare, so the cap is what they
 * measure; the t-58 tests at the end set the balance.
 *
 * Mocked: Prisma (an in-memory fake of the cost rows, the credit balance,
 * assessments, judge runs and budget holds, filtering and ordering as the queries ask; its
 * advisory lock admits one transaction per key at a time, as Postgres's
 * does), the org's quotas and the logger. Real: the check and Sunrise's
 * spend-caps module, so the cap it compares against is the one the per-judge
 * gate reads.
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
  completedAt?: Date | null;
  createdAt: Date;
}
interface HoldRow {
  id: string;
  orgId: string;
  judges: number;
  stored: boolean;
  leaseExpiresAt: Date;
  createdAt: Date;
}
interface CostRow {
  orgId: string;
  totalCostUsd: number;
  metadata: unknown;
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
  /** The workspace's CopyCredits balance. */
  credits: 1_000_000,
  creditsFail: false,
  reviews: [] as ReviewRow[],
  runs: [] as RunRow[],
  holds: [] as HoldRow[],
  costRows: [] as CostRow[],
  /** The keys the advisory lock was taken on, in order. */
  locked: [] as string[],
  seq: 0,
}));

type Where = Record<string, unknown>;
/** Equality, `{ in }`, `{ not }`, `{ gt }`, `{ lt }` and a top-level `OR`: what the queries ask. */
const matches = (row: Record<string, unknown>, where: Where): boolean =>
  Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Where[]).some((w) => matches(row, w));
    if (k === 'AND') return (v as Where[]).every((w) => matches(row, w));
    const value = row[k];
    if (v instanceof Date) return value instanceof Date && value.getTime() === v.getTime();
    if (typeof v !== 'object' || v === null) return value === v;
    if ('in' in v) return (v as { in: unknown[] }).in.includes(value);
    if ('not' in v) {
      if (value === v.not) return false;
      const { not: _not, ...rest } = v as Where;
      return Object.keys(rest).length === 0 || matches({ [k]: value }, { [k]: rest });
    }
    if ('gt' in v) return value instanceof Date && value > (v as { gt: Date }).gt;
    if ('lte' in v) return value instanceof Date && value <= (v as { lte: Date }).lte;
    if ('lt' in v) {
      const lt = (v as { lt: Date | string }).lt;
      if (typeof lt === 'string') return typeof value === 'string' && value < lt;
      return value instanceof Date && value < lt;
    }
    throw new Error(`fake cannot filter ${k} by ${JSON.stringify(v)}`);
  });
function newestFirst<T extends { createdAt: Date }>(rows: T[], take: number): T[] {
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take);
}

vi.mock('@/lib/db/client', () => {
  /** The tail of each key's queue of lock holders. */
  const lockQueues = new Map<string, Promise<void>>();
  const db = {
    aiCostLog: {
      aggregate: vi.fn(async () => ({ _sum: { totalCostUsd: state.spent } })),
      findMany: vi.fn(async ({ where, take }: { where: Where; take?: number }) =>
        newestFirst(
          state.costRows.filter((r) => matches({ ...r }, where)),
          take ?? Infinity
        ).map((r) => ({ totalCostUsd: r.totalCostUsd, metadata: r.metadata }))
      ),
    },
    creditEntry: {
      aggregate: vi.fn(async () => {
        if (state.creditsFail) throw new Error('ledger unreadable');
        return { _sum: { amount: state.credits } };
      }),
    },
    budgetHold: {
      findMany: vi.fn(async ({ where }: { where: Where }) =>
        state.holds.filter((h) => matches({ ...h }, where)).map((h) => ({ ...h }))
      ),
      create: vi.fn(async ({ data }: { data: Omit<HoldRow, 'id'> }) => {
        state.seq += 1;
        const row = { id: `hold-${state.seq}`, ...data };
        state.holds.push(row);
        return { id: row.id };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<HoldRow> }) => {
        const rows = state.holds.filter((h) => matches({ ...h }, where));
        for (const row of rows) Object.assign(row, data);
        return { count: rows.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Where }) => {
        const gone = state.holds.filter((h) => matches({ ...h }, where));
        state.holds = state.holds.filter((h) => !gone.includes(h));
        return { count: gone.length };
      }),
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
          leaseExpiresAt: r.leaseExpiresAt,
          createdAt: r.createdAt,
          judgeRuns: state.runs
            .filter((run) => run.assessmentId === r.id)
            .map((run) => ({ costUsd: run.costUsd })),
        }))
      ),
    },
    judgeRun: {
      findMany: vi.fn(async ({ where, take }: { where: Where; take?: number }) =>
        newestFirst(
          state.runs.filter((r) => matches({ ...r }, where)),
          take ?? Infinity
        ).map((r) => ({
          costUsd: r.costUsd,
          assessmentId: r.assessmentId,
          status: r.status,
          errorCode: r.errorCode,
        }))
      ),
    },
    /**
     * A transaction whose `$executeRaw` takes the advisory lock its key names,
     * waiting behind whoever holds it, until the transaction ends.
     */
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      let unlock = () => {};
      const tx = {
        ...db,
        $executeRaw: vi.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
          const key = String(values[0]);
          state.locked.push(`${sql.join('?')} ${key}`);
          const ahead = lockQueues.get(key) ?? Promise.resolve();
          const mine = new Promise<void>((resolve) => (unlock = resolve));
          lockQueues.set(
            key,
            ahead.then(() => mine)
          );
          await ahead;
          return 1;
        }),
      };
      try {
        return await fn(tx);
      } finally {
        unlock();
      }
    }),
  };
  return { prisma: db };
});
vi.mock('@/lib/tenancy/org-settings', () => ({
  loadOrgQuotas: vi.fn(async () => {
    if (state.quotasFail) throw new Error('settings unreadable');
    return state.budget === null ? {} : { monthlyBudgetUsd: state.budget };
  }),
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { forgetSpendCaps, utcMonthStart } from '@/lib/orchestration/llm/spend-caps';
import { APIError } from '@/lib/api/errors';
import {
  assertReviewFits,
  budgetRefusal,
  estimateReviewCost,
  JUDGE_HISTORY,
  KEPT_NOWHERE_SCAN,
  KEPT_NOWHERE_TAIL,
  reserveReviewBudget,
} from '@/lib/app/usage/budget';
import { LEASE_MS, LEASE_RENEW_MS } from '@/lib/app/assessments/limits';

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

/** Check a stored request as `reserveReviewBudget` does, releasing what it held: t-49's check. */
async function check(orgId: string, profile: string, judgeCount: number): Promise<void> {
  const hold = await reserveReviewBudget(orgId, profile, judgeCount, true);
  await hold?.release();
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
    credits: 1_000_000,
    creditsFail: false,
    reviews: [],
    runs: [],
    holds: [],
    costRows: [],
    locked: [],
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

describe('reserveReviewBudget: the check (t-49)', () => {
  beforeEach(() => {
    state.budget = 10;
    // An estimate of $1.00 a 7-judge review.
    for (let i = 0; i < 3; i += 1) review(1, { judges: slots(7) });
  });

  it('lets a review start when its estimate is under what is left', async () => {
    state.spent = 8.5;
    await expect(check(ORG, 'full', 7)).resolves.toBeUndefined();
  });

  it('lets a review start when its estimate is exactly what is left', async () => {
    state.spent = 9;
    await expect(check(ORG, 'full', 7)).resolves.toBeUndefined();
  });

  it('refuses a review whose estimate is over what is left, with the figures', async () => {
    state.spent = 9.25;

    const err = await refusal(() => check(ORG, 'full', 7));

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

    const err = await refusal(() => check(ORG, 'full', 7));

    expect(err.code).toBe('BUDGET_EXCEEDED');
    expect(err.details).toMatchObject({ remainingUsd: 0, limitUsd: 10, estimateUsd: 1 });
  });

  it('with no history, lets any positive remainder through and refuses none left', async () => {
    state.reviews = [];
    state.spent = 9.999;
    await expect(check(ORG, 'full', 7)).resolves.toBeUndefined();

    forgetSpendCaps();
    state.spent = 10;
    const err = await refusal(() => check(ORG, 'full', 7));
    expect(err.details).toMatchObject({ estimateUsd: 0, basis: 'none', remainingUsd: 0 });
  });

  it('never refuses a review calling no judge (the quick profile), even past the cap', async () => {
    state.spent = 50;
    await expect(check(ORG, 'quick', 0)).resolves.toBeUndefined();
  });

  it('refuses nothing with no cap set, or a cap that cannot be read', async () => {
    state.budget = null;
    state.spent = 1_000;
    await expect(check(ORG, 'full', 7)).resolves.toBeUndefined();

    forgetSpendCaps();
    state.quotasFail = true;
    await expect(check(ORG, 'full', 7)).resolves.toBeUndefined();
  });
  it('holds back what reviews already queued or running are yet to spend', async () => {
    state.spent = 8;
    // A queued 7-judge review ($1.00 to come) and a running one with 4 judges answered ($3/7 to come).
    review(0, { status: 'QUEUED', judges: slots(7) });
    const running = review(0.4, { status: 'RUNNING', judges: slots(7) });
    for (let i = 0; i < 4; i += 1) judgeRun(0.1, { assessmentId: running });
    // Another workspace's, and a finished one: neither is held.
    review(0, { status: 'QUEUED', judges: slots(7), orgId: OTHER });

    const err = await refusal(() => check(ORG, 'full', 7));

    // $2.00 left, $10/7 held: $4/7 is under the $1.00 estimate.
    expect(err.details).toMatchObject({
      estimateUsd: 1,
      remainingUsd: 0.571429,
      inFlightUsd: 1.428571,
    });
    expect(err.message).toContain(
      'once $1.43 is held for reviews already starting, queued, running or finishing'
    );
  });

  it('lets a review start when what is left after those in flight covers it', async () => {
    state.spent = 7;
    review(0, { status: 'QUEUED', judges: slots(7) });
    await expect(check(ORG, 'full', 7)).resolves.toBeUndefined();
  });

  it('is not used up by a remainder too small to round, short of the cap', async () => {
    state.reviews = [];
    state.spent = 9.9999996;
    // No history: an estimate of 0, and the cap not reached.
    await expect(check(ORG, 'full', 7)).resolves.toBeUndefined();
  });

  it('gives amounts under a cent to four places in the message', async () => {
    state.reviews = [];
    for (let i = 0; i < 3; i += 1) review(0.004, { judges: slots(1) });
    state.budget = 5;
    state.spent = 4.997;

    const err = await refusal(() => check(ORG, 'full', 1));

    expect(err.message).toContain('about $0.0040, more than the $0.0030 left');
  });

  it('says "under $0.0001" for an amount four places would show as zero', async () => {
    state.reviews = [];
    for (let i = 0; i < 3; i += 1) review(0.0001, { judges: slots(1) });
    state.spent = 9.99997;

    const err = await refusal(() => check(ORG, 'full', 1));

    expect(err.message).toContain('more than the under $0.0001 left');
    expect(err.message).not.toContain('$0.0000');
  });

  it('says the reviews in flight hold the rest when they leave nothing', async () => {
    state.spent = 8;
    // Two queued 7-judge reviews hold $2.00: all that is left.
    review(0, { status: 'QUEUED', judges: slots(7) });
    review(0, { status: 'QUEUED', judges: slots(7) });

    const err = await refusal(() => check(ORG, 'full', 7));

    expect(err.details).toMatchObject({ remainingUsd: 0, inFlightUsd: 2 });
    expect(err.message).toContain(
      "Reviews already starting, queued, running or finishing are held the rest of the workspace's $10.00 monthly AI budget ($2.00)."
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

    const err = await refusal(() => check(ORG, 'full', 13));

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

    const err = await refusal(() => check(ORG, 'full', 13));

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

    const err = await refusal(() => check(ORG, 'full', 15));

    expect(err.details).toMatchObject({ inFlightUsd: 0, remainingUsd: 2 });
  });

  it('holds a review created last month only for the judges it has not settled', async () => {
    state.spent = 8;
    // A running 7-judge review ($1.00) created last month, which has spent $0.50 in all.
    const lastMonth = new Date(utcMonthStart().getTime() - 60_000);
    const id = review(0.5, { status: 'RUNNING', judges: slots(7), createdAt: lastMonth });
    for (let i = 0; i < 5; i += 1) judgeRun(0.1, { assessmentId: id, createdAt: lastMonth });

    const err = await refusal(() => check(ORG, 'full', 14));

    // Its 5 judges settled last month are reused: 2 are still to come this month.
    expect(err.details).toMatchObject({ inFlightUsd: 0.285714, remainingUsd: 1.714286 });
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

    const err = await refusal(() => check(ORG, 'full', 13));

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

    const err = await refusal(() => check(ORG, 'full', 20));

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

    const err = await refusal(() => check(ORG, 'full', 20));

    expect(err.details).toMatchObject({ inFlightUsd: 0.3 });
  });

  it("holds a running review for re-running its retryably failed judges at this request's rate (t-55)", async () => {
    state.spent = 8;
    // A running 7-judge review ($1.00) that has spent $0.40: two judges answered
    // ($0.10 each) and one failed rate_limited after $0.20, which a re-drive runs again.
    const id = review(0.4, { status: 'RUNNING', judges: slots(7) });
    judgeRun(0.1, { assessmentId: id });
    judgeRun(0.1, { assessmentId: id });
    judgeRun(0.2, { assessmentId: id, status: 'FAILED', errorCode: 'rate_limited' });

    const err = await refusal(() => check(ORG, 'full', 14));

    // The failed judge's $0.20 does not pay for its re-run: it is held at the
    // full $1/7 with the four not yet called, $5/7 in all.
    expect(err.details).toMatchObject({ inFlightUsd: 0.714286, remainingUsd: 1.285714 });
  });

  it('counts the spend of a judge that failed for good as settled', async () => {
    state.spent = 8;
    const id = review(0.4, { status: 'QUEUED', judges: slots(7) });
    judgeRun(0.1, { assessmentId: id });
    judgeRun(0.1, { assessmentId: id });
    judgeRun(0.1, { assessmentId: id, status: 'FAILED', errorCode: 'invalid_reply' });

    const err = await refusal(() => check(ORG, 'full', 14));

    // Three settled, four to come.
    expect(err.details).toMatchObject({ inFlightUsd: 0.571429, remainingUsd: 1.428571 });
  });

  it("holds a re-driven judge's first attempt against none of the judges still to come", async () => {
    state.spent = 8;
    // A running 7-judge review ($1/7 a judge): one judge answered on its re-drive,
    // its row carrying its first attempt's $0.20 on top of the $0.10 that answered.
    const id = review(0.3, { status: 'RUNNING', judges: slots(7) });
    judgeRun(0.3, { assessmentId: id });

    const err = await refusal(() => check(ORG, 'full', 14));

    // Its six other judges are still to come: $6/7, not $1.00 less its $0.30.
    expect(err.details).toMatchObject({ inFlightUsd: 0.857143 });
  });

  it("holds a running review's editor until it is final, since a re-drive calls it again", async () => {
    state.reviews = [];
    // History with an editor: 7-judge reviews that spent $0.70 on judges and $0.30 on the editor.
    for (let i = 0; i < 3; i += 1) {
      const past = review(1, { judges: slots(7) });
      for (let j = 0; j < 7; j += 1) judgeRun(0.1, { assessmentId: past });
    }
    state.spent = 8;
    // All 7 judges answered and the editor has been billed $0.20; a re-drive would call it again.
    const id = review(0.9, { status: 'RUNNING', judges: slots(7) });
    for (let j = 0; j < 7; j += 1) judgeRun(0.1, { assessmentId: id });

    const err = await refusal(() => check(ORG, 'full', 20));

    expect(err.details).toMatchObject({ inFlightUsd: 0.3 });
  });

  it('reads no judge runs by review when none is in flight', async () => {
    state.spent = 8;

    await check(ORG, 'full', 7);

    expect(prisma.judgeRun.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assessmentId: expect.anything() }),
      })
    );
  });

  it('refuses nothing when the history cannot be read, as a cap that cannot be', async () => {
    state.spent = 9.99;
    vi.mocked(prisma.assessment.findMany).mockRejectedValueOnce(new Error('statement timeout'));

    await expect(check(ORG, 'full', 7)).resolves.toBeUndefined();
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

describe('budgetRefusal: a queued review checked again as it is claimed (t-53)', () => {
  beforeEach(() => {
    state.budget = 10;
    // An estimate of $1.00 a 7-judge review.
    for (let i = 0; i < 3; i += 1) review(1, { judges: slots(7) });
  });

  /** A stored 7-judge review as the claim names it. */
  function claimed(over: Partial<ReviewRow> = {}) {
    const id = review(0, { status: 'RUNNING', judges: slots(7), ...over });
    const row = state.reviews.find((r) => r.id === id);
    if (!row) throw new Error('not stored');
    return { id, createdAt: row.createdAt };
  }

  it('leaves the review’s own hold out of what is held back, so it fits what its request saw', async () => {
    state.spent = 9;
    const self = claimed();

    // Held as one of the others, it would leave nothing.
    await expect(budgetRefusal(ORG, 'full', 7)).resolves.toMatchObject({
      details: { remainingUsd: 0, inFlightUsd: 1 },
    });
    await expect(budgetRefusal(ORG, 'full', 7, self)).resolves.toBeNull();
  });

  it('holds back the reviews in flight created before it, and answers the reason, message and figures', async () => {
    state.spent = 8.5;
    // Queued ahead of it: $1.00 to come.
    review(0, { status: 'QUEUED', judges: slots(7) });
    const self = claimed();

    const refused = await budgetRefusal(ORG, 'full', 7, self);

    expect(refused?.details).toEqual({
      estimateUsd: 1,
      basis: 'profile',
      remainingUsd: 0.5,
      inFlightUsd: 1,
      limitUsd: 10,
      usagePage: '/usage',
    });
    expect(refused?.reason).toContain('more than the $0.50 left once $1.00 is held');
    expect(refused?.reason).not.toContain('No AI reviewer');
    expect(refused?.message).toBe(
      `${refused?.reason} No AI reviewer was started. See /usage; an admin can raise the budget on /admin.`
    );
  });

  it('of two claimed together with room for one, refuses only the later, which the earlier holds back', async () => {
    state.spent = 8.5;
    const older = claimed();
    const newer = claimed();

    // The newer was admitted with the older already held, so it does not hold the older back.
    await expect(budgetRefusal(ORG, 'full', 7, older)).resolves.toBeNull();
    await expect(budgetRefusal(ORG, 'full', 7, newer)).resolves.toMatchObject({
      details: { remainingUsd: 0.5, inFlightUsd: 1 },
    });
  });

  it('of two created in the same instant, holds back the one with the lower id for the other', async () => {
    state.spent = 8.5;
    const older = claimed();
    const newer = claimed({ createdAt: older.createdAt });

    await expect(budgetRefusal(ORG, 'full', 7, older)).resolves.toBeNull();
    await expect(budgetRefusal(ORG, 'full', 7, newer)).resolves.toMatchObject({
      details: { inFlightUsd: 1 },
    });
  });

  it('refuses once other spend has used the budget up while it waited', async () => {
    const self = claimed();
    state.spent = 10;

    const refused = await budgetRefusal(ORG, 'full', 7, self);

    expect(refused?.details).toMatchObject({ remainingUsd: 0, inFlightUsd: 0, limitUsd: 10 });
    expect(refused?.reason).toContain('has used its $10.00 monthly AI budget');
  });
});

describe('reserveReviewBudget: requests arriving together (t-50)', () => {
  beforeEach(() => {
    state.budget = 10;
    // An estimate of $1.00 a 7-judge review, and an editor that costs nothing.
    for (let i = 0; i < 3; i += 1) review(1, { judges: slots(7) });
  });

  /** A hold seeded directly: one taken by a request checked earlier. */
  function hold(over: Partial<HoldRow> = {}): HoldRow {
    state.seq += 1;
    const row: HoldRow = {
      id: `hold-${state.seq}`,
      orgId: ORG,
      judges: 7,
      stored: true,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      createdAt: at(),
      ...over,
    };
    state.holds.push(row);
    return row;
  }

  for (const [label, stored] of [
    ['stored', true],
    ['store: false', false],
  ] as const) {
    it(`${label}: of three checked at the same moment with room for one, passes one and refuses the others with its hold in inFlightUsd`, async () => {
      state.spent = 8.5;

      const outcomes = await Promise.allSettled(
        [1, 2, 3].map(() => reserveReviewBudget(ORG, 'full', 7, stored))
      );

      const passed = outcomes.filter((o) => o.status === 'fulfilled');
      const refused = outcomes.flatMap((o) => (o.status === 'rejected' ? [o.reason] : []));
      expect(passed).toHaveLength(1);
      expect(refused).toHaveLength(2);
      for (const err of refused) {
        expect(err).toBeInstanceOf(APIError);
        expect(err).toMatchObject({
          status: 402,
          code: 'BUDGET_EXCEEDED',
          details: { estimateUsd: 1, inFlightUsd: 1, remainingUsd: 0.5 },
        });
      }
      expect(state.holds).toEqual([expect.objectContaining({ orgId: ORG, judges: 7, stored })]);
      // Each check took the workspace's lock before it read what is held.
      expect(state.locked).toEqual(
        Array(3).fill(`SELECT pg_advisory_xact_lock(hashtextextended(?, 0)) app:budget-hold:${ORG}`)
      );
    });
  }

  it("takes each workspace's own lock, so one workspace's checks do not wait on another's", async () => {
    state.spent = 0;
    const a = await reserveReviewBudget(ORG, 'full', 7, true);
    const b = await reserveReviewBudget(OTHER, 'full', 7, true);

    expect(state.locked.map((l) => l.split(' ').at(-1))).toEqual([
      `app:budget-hold:${ORG}`,
      `app:budget-hold:${OTHER}`,
    ]);
    await a?.release();
    await b?.release();
  });

  it('holds a stored request at its judges and the editor allowance, a store: false one at its judges alone', async () => {
    state.reviews = [];
    // Judges $0.10 each and an editor of $0.30 on 7-judge reviews.
    for (let i = 0; i < 3; i += 1) {
      const past = review(1, { judges: slots(7) });
      for (let j = 0; j < 7; j += 1) judgeRun(0.1, { assessmentId: past });
    }
    state.spent = 8;
    hold({ stored: true });
    hold({ stored: false });
    // Another workspace's hold, and one whose lease has run out: neither counts.
    hold({ orgId: OTHER });
    hold({ leaseExpiresAt: new Date(Date.now() - 1_000) });

    const err = await refusal(() => check(ORG, 'full', 20));

    // $1.00 for the stored request's, $0.70 for the store: false one's.
    expect(err.details).toMatchObject({ inFlightUsd: 1.7, remainingUsd: 0.3 });
  });

  it('holds until released, then not; releasing twice is safe', async () => {
    state.spent = 8.5;
    const first = await reserveReviewBudget(ORG, 'full', 7, true);
    expect(first).not.toBeNull();
    await refusal(() => check(ORG, 'full', 7));

    await first?.release();
    await first?.release();

    expect(state.holds).toEqual([]);
    await expect(check(ORG, 'full', 7)).resolves.toBeUndefined();
  });

  it('renews the lease while held, and stops once released', async () => {
    vi.useFakeTimers();
    try {
      state.spent = 0;
      const held = await reserveReviewBudget(ORG, 'full', 7, true);
      const row = state.holds[0];
      const first = row.leaseExpiresAt.getTime();

      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
      expect(row.leaseExpiresAt.getTime()).toBe(Date.now() + LEASE_MS);
      expect(row.leaseExpiresAt.getTime()).toBeGreaterThan(first);

      await held?.release();
      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS * 3);
      expect(prisma.budgetHold.updateMany).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not warn of a lost hold when it was released while a renewal was in flight', async () => {
    vi.useFakeTimers();
    try {
      const held = await reserveReviewBudget(ORG, 'full', 7, true);
      let renewed: (value: { count: number }) => void = () => undefined;
      vi.mocked(prisma.budgetHold.updateMany).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            renewed = resolve;
          }) as ReturnType<typeof prisma.budgetHold.updateMany>
      );
      await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
      await held?.release();
      // The renewal lands after the delete: it matched nothing.
      renewed({ count: 0 });
      await vi.advanceTimersByTimeAsync(0);

      expect(logger.warn).not.toHaveBeenCalledWith(
        'Budget hold lost before its request ended',
        expect.anything()
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a burst room to queue for a connection and the lock, past Prisma's 2s and 5s defaults", async () => {
    const held = await reserveReviewBudget(ORG, 'full', 7, true);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 15_000,
    });
    await held?.release();
  });

  it('stamps the hold with the time read under the lock, not a database default', async () => {
    const held = await reserveReviewBudget(ORG, 'full', 7, false);
    const { data } = vi.mocked(prisma.budgetHold.create).mock.calls[0][0];
    expect(data.createdAt).toBeInstanceOf(Date);
    expect(data.leaseExpiresAt).toEqual(new Date((data.createdAt as Date).getTime() + LEASE_MS));
    await held?.release();
  });

  it('reuses the rate assertReviewFits read, reading no history again', async () => {
    state.spent = 0;
    const rate = await assertReviewFits(ORG, 'full', 7, true);
    expect(rate).toMatchObject({ perJudgeUsd: expect.any(Number), basis: 'profile' });
    const historyReads = vi.mocked(prisma.assessment.findMany).mock.calls.length;
    // History that would now estimate $100 a judge: the reused rate ignores it.
    for (let i = 0; i < 3; i += 1) review(700, { judges: slots(7) });

    const held = await reserveReviewBudget(ORG, 'full', 7, true, rate ?? undefined);
    expect(held).not.toBeNull();
    // Only what is in flight was read again, not the profile's history.
    expect(
      vi
        .mocked(prisma.assessment.findMany)
        .mock.calls.slice(historyReads)
        .some(([args]) => (args as { take?: number }).take !== undefined)
    ).toBe(false);
    await held?.release();
  });

  it('assertReviewFits: refuses as the check does, and holds nothing either way', async () => {
    state.spent = 9.5;
    const err = await refusal(() => assertReviewFits(ORG, 'full', 7, true).then(() => undefined));
    expect(err.code).toBe('BUDGET_EXCEEDED');
    expect(err.status).toBe(402);
    state.spent = 0;
    forgetSpendCaps();
    await expect(assertReviewFits(ORG, 'full', 7, true)).resolves.toMatchObject({
      basis: 'profile',
    });

    expect(state.holds).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deletes holds whose lease has run out (their process died) before it checks', async () => {
    state.spent = 8.5;
    hold({ leaseExpiresAt: new Date(Date.now() - 1_000) });
    hold({ orgId: OTHER, leaseExpiresAt: new Date(Date.now() - 1_000) });

    const held = await reserveReviewBudget(ORG, 'full', 7, true);

    // Not held back, and gone; another workspace's is its own to clear.
    expect(state.holds.map((h) => h.orgId)).toEqual([OTHER, ORG]);
    await held?.release();
  });

  it('holds nothing when it is refused, calls no judge, or has neither a cap nor a balance it can read', async () => {
    state.spent = 10;
    await refusal(() => reserveReviewBudget(ORG, 'full', 7, true).then(() => undefined));
    state.spent = 50;
    await expect(reserveReviewBudget(ORG, 'quick', 0, true)).resolves.toBeNull();
    forgetSpendCaps();
    state.budget = null;
    // No cap is no longer enough: the credits are checked, and held against (t-58).
    state.creditsFail = true;
    await expect(reserveReviewBudget(ORG, 'full', 7, true)).resolves.toBeNull();

    expect(state.holds).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses nothing and holds nothing when the hold fails other than by timing out, as a history that cannot be read', async () => {
    state.spent = 9.5;
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error('connection reset'));

    await expect(reserveReviewBudget(ORG, 'full', 7, true)).resolves.toBeNull();
    expect(state.holds).toEqual([]);
  });

  it('refuses 429, to try again, a check that times out waiting for the lock or a connection, rather than passing it unheld', async () => {
    state.spent = 9;
    for (const code of ['P2028', 'P2024']) {
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Transaction timed out', {
          code,
          clientVersion: '7',
        })
      );
      const err = await refusal(() =>
        reserveReviewBudget(ORG, 'full', 7, true).then(() => undefined)
      );
      expect(err.status).toBe(429);
      expect(err.code).toBe('RATE_LIMIT_EXCEEDED');
    }
    expect(state.holds).toEqual([]);
  });

  it('checks and holds all the same when clearing expired holds fails', async () => {
    state.spent = 8.5;
    vi.mocked(prisma.budgetHold.deleteMany).mockRejectedValueOnce(new Error('lock conflict'));

    const held = await reserveReviewBudget(ORG, 'full', 7, true);
    expect(held).not.toBeNull();
    await refusal(() => check(ORG, 'full', 7));
    await held?.release();
  });

  it('estimates a store: false request without the editor allowance, which never runs on it', async () => {
    state.reviews = [];
    // Judges $0.10 each and an editor of $0.30 on 7-judge reviews.
    for (let i = 0; i < 3; i += 1) {
      const past = review(1, { judges: slots(7) });
      for (let j = 0; j < 7; j += 1) judgeRun(0.1, { assessmentId: past });
    }
    state.spent = 9.2;

    // $0.70 fits the $0.80 left; stored, with the editor, $1.00 does not.
    const held = await reserveReviewBudget(ORG, 'full', 7, false);
    expect(held).not.toBeNull();
    await held?.release();
    await expect(assertReviewFits(ORG, 'full', 7, false)).resolves.not.toBeNull();
    const err = await refusal(() => assertReviewFits(ORG, 'full', 7, true).then(() => undefined));
    expect(err.details).toMatchObject({ estimateUsd: 1 });
  });

  it('logs a release that fails rather than throwing; the lease then runs out on its own', async () => {
    state.spent = 0;
    const held = await reserveReviewBudget(ORG, 'full', 7, true);
    vi.mocked(prisma.budgetHold.deleteMany).mockRejectedValueOnce(new Error('connection reset'));

    await expect(held?.release()).resolves.toBeUndefined();
  });

  describe('as a queued review is claimed (t-53)', () => {
    /** A stored 7-judge review as the claim names it. */
    function claimed() {
      const id = review(0, { status: 'RUNNING', judges: slots(7) });
      const row = state.reviews.find((r) => r.id === id);
      if (!row) throw new Error('not stored');
      return { id, createdAt: row.createdAt };
    }

    it('holds back a store: false run that began before it, not one after it nor a stored request’s', async () => {
      state.spent = 8;
      hold({ stored: false, judges: 7 });
      // A stored request's hold, taken before the review: a later review once
      // stored, or this review's own until its request releases it.
      hold({ stored: true, judges: 7 });
      const self = claimed();
      hold({ stored: false, judges: 7 });

      const refused = await budgetRefusal(ORG, 'full', 14, self);

      expect(refused?.details).toMatchObject({ inFlightUsd: 1, remainingUsd: 1 });
    });
  });
});

describe('the kept-nowhere tier: history from store: false reviews (t-51)', () => {
  /** The cost row of one judge of a `store: false` run. */
  function costRow(run: string, judge: string, costUsd: number, over: Partial<CostRow> = {}) {
    state.costRows.push({
      orgId: ORG,
      totalCostUsd: costUsd,
      metadata: { ephemeral: true, ephemeralRun: run, judge, attempts: 1 },
      createdAt: at(),
      ...over,
    });
  }

  it('with no stored judge run, estimates from the judges of the workspace’s store: false reviews', async () => {
    costRow('r1', 'j0', 0.02);
    costRow('r1', 'j1', 0.04);
    costRow('r2', 'j0', 0.06);

    // The median of $0.02, $0.04 and $0.06; no editor allowance, as those reviews have none.
    expect(await estimateReviewCost(ORG, 'full', 7)).toEqual({
      estimateUsd: 0.28,
      basis: 'kept-nowhere',
    });
  });

  it('sums a judge’s rows (one per service tier), and leaves out a failed judge, a calibration run’s, other AI use and other workspaces', async () => {
    costRow('r1', 'j0', 0.03);
    costRow('r1', 'j0', 0.02);
    costRow('r2', 'j0', 0.05);
    // A judge that failed after a billed attempt: one row with an error.
    state.costRows.push({
      orgId: ORG,
      totalCostUsd: 9,
      metadata: { ephemeral: true, ephemeralRun: 'r3', judge: 'j0', error: 'invalid_reply' },
      createdAt: at(),
    });
    state.costRows.push({
      orgId: ORG,
      totalCostUsd: 9,
      metadata: { ephemeral: true, ephemeralRun: 'c1', judge: 'j0', calibrationRunId: 'cal' },
      createdAt: at(),
    });
    state.costRows.push({
      orgId: ORG,
      totalCostUsd: 9,
      metadata: { agent: 'chat' },
      createdAt: at(),
    });
    state.costRows.push({ orgId: ORG, totalCostUsd: 9, metadata: null, createdAt: at() });
    costRow('r4', 'j0', 9, { orgId: OTHER });

    // Two judges at $0.05 each.
    expect(await estimateReviewCost(ORG, 'full', 2)).toEqual({
      estimateUsd: 0.1,
      basis: 'kept-nowhere',
    });
  });

  it('reads at most the last 500 cost rows, newest first, and at most the last 100 judges in them', async () => {
    // 101 judges: the oldest at $5 is past the last 100.
    costRow('old', 'j0', 5);
    for (let i = 0; i < JUDGE_HISTORY; i += 1) costRow(`r${i}`, 'j0', 0.01);

    expect(await estimateReviewCost(ORG, 'full', 1)).toEqual({
      estimateUsd: 0.01,
      basis: 'kept-nowhere',
    });
    expect(prisma.aiCostLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: ORG },
        orderBy: { createdAt: 'desc' },
        take: KEPT_NOWHERE_SCAN,
      })
    );
  });

  it('leaves out the oldest judge of a full scan, whose rows the scan may have cut short', async () => {
    // Oldest: a judge whose other row is past the scan.
    costRow('cut', 'j0', 0.001);
    for (let i = 0; i < KEPT_NOWHERE_SCAN - 3; i += 1)
      state.costRows.push({
        orgId: ORG,
        totalCostUsd: 1,
        metadata: { agent: 'chat' },
        createdAt: at(),
      });
    costRow('a', 'j0', 0.05);
    costRow('b', 'j0', 0.07);

    // The median of $0.05 and $0.07, not of those and the cut judge's $0.001.
    expect(await estimateReviewCost(ORG, 'full', 1)).toEqual({
      estimateUsd: 0.06,
      basis: 'kept-nowhere',
    });
  });

  it('on a full scan, leaves out every judge of the oldest run, whose rows interleave as they land', async () => {
    // The oldest run: judge A's two tier rows either side of judge B's one.
    costRow('cut', 'jA', 0.001);
    costRow('cut', 'jB', 0.002);
    costRow('cut', 'jA', 0.001);
    for (let i = 0; i < KEPT_NOWHERE_SCAN - 5; i += 1)
      state.costRows.push({
        orgId: ORG,
        totalCostUsd: 1,
        metadata: { agent: 'chat' },
        createdAt: at(),
      });
    costRow('a', 'j0', 0.05);
    costRow('b', 'j0', 0.07);

    expect(await estimateReviewCost(ORG, 'full', 1)).toEqual({
      estimateUsd: 0.06,
      basis: 'kept-nowhere',
    });
  });

  it('on a full scan, leaves out every run with a row near its end, as runs alongside interleave too', async () => {
    // Two runs alongside each other at the scan's end.
    costRow('x', 'j0', 0.001);
    costRow('y', 'j0', 0.002);
    costRow('x', 'j1', 0.001);
    for (let i = 0; i < KEPT_NOWHERE_TAIL; i += 1)
      state.costRows.push({
        orgId: ORG,
        totalCostUsd: 1,
        metadata: { agent: 'chat' },
        createdAt: at(),
      });
    // Past the tail: a run counted whole.
    costRow('a', 'j0', 0.05);
    for (let i = 0; i < KEPT_NOWHERE_SCAN - KEPT_NOWHERE_TAIL - 5; i += 1)
      state.costRows.push({
        orgId: ORG,
        totalCostUsd: 1,
        metadata: { agent: 'chat' },
        createdAt: at(),
      });
    costRow('b', 'j0', 0.07);

    expect(await estimateReviewCost(ORG, 'full', 1)).toEqual({
      estimateUsd: 0.06,
      basis: 'kept-nowhere',
    });
  });

  it('comes after stored judge runs, which a workspace with both estimates from', async () => {
    costRow('r1', 'j0', 5);
    judgeRun(0.02);

    expect(await estimateReviewCost(ORG, 'full', 1)).toEqual({
      estimateUsd: 0.02,
      basis: 'judges',
    });
    expect(prisma.aiCostLog.findMany).not.toHaveBeenCalled();
  });

  it('is none when the cost rows hold no store: false judge', async () => {
    state.costRows.push({
      orgId: ORG,
      totalCostUsd: 1,
      metadata: { agent: 'chat' },
      createdAt: at(),
    });
    expect(await estimateReviewCost(ORG, 'full', 7)).toEqual({ estimateUsd: 0, basis: 'none' });
  });

  it('refuses a request on that history, with its basis', async () => {
    state.budget = 10;
    state.spent = 9.9;
    for (let i = 0; i < 3; i += 1) costRow(`r${i}`, 'j0', 0.05);

    const err = await refusal(() => check(ORG, 'full', 7));

    expect(err.details).toMatchObject({ estimateUsd: 0.35, basis: 'kept-nowhere' });
  });
});

describe('the credits (t-58)', () => {
  beforeEach(() => {
    // An estimate of $1.00 (100 credits) a 7-judge review, as in t-49's fixtures.
    for (let i = 0; i < 3; i += 1) review(1, { judges: slots(7) });
  });

  for (const [label, stored] of [
    ['stored', true],
    ['store: false', false],
  ] as const) {
    it(`${label}: refuses 402 INSUFFICIENT_CREDITS with none, before taking the lock`, async () => {
      state.credits = 0;

      const err = await refusal(async () => {
        await reserveReviewBudget(ORG, 'full', 7, stored);
      });

      expect(err).toMatchObject({
        status: 402,
        code: 'INSUFFICIENT_CREDITS',
        details: {
          estimateCredits: 100,
          basis: 'profile',
          balanceCredits: 0,
          heldCredits: 0,
          remainingCredits: 0,
          usagePage: '/usage',
        },
      });
      expect(err.message).toContain('no CopyCredits left');
      expect(err.message).toContain('review code');
      expect(state.locked).toEqual([]);
      expect(state.holds).toEqual([]);
    });
  }

  it('lets a review start when its estimate is exactly the balance, and refuses one credit short', async () => {
    state.credits = 100;
    await expect(check(ORG, 'full', 7)).resolves.toBeUndefined();

    state.credits = 99;
    const err = await refusal(() => check(ORG, 'full', 7));
    expect(err.code).toBe('INSUFFICIENT_CREDITS');
    expect(err.details).toMatchObject({
      estimateCredits: 100,
      balanceCredits: 99,
      remainingCredits: 99,
    });
    expect(err.message).toContain(
      "This review would cost about 100 CopyCredits, more than the workspace's 99 CopyCredits."
    );
  });

  it('checks the credits with no cap set, which refused nothing before', async () => {
    state.budget = null;
    state.credits = 50;
    const err = await refusal(() => check(ORG, 'full', 7));
    expect(err.code).toBe('INSUFFICIENT_CREDITS');
  });

  it('holds back what reviews in flight have spent and are yet to spend, since they are charged only as they end', async () => {
    state.credits = 250;
    // Running, 4 of 7 judges answered for $0.60 so far: $3/7 to come.
    const running = review(0.6, { status: 'RUNNING', judges: slots(7) });
    for (let j = 0; j < 4; j += 1) judgeRun(0.15, { assessmentId: running });
    // A store: false request holding its 7 judges ($1.00).
    state.holds.push({
      id: 'hold-x',
      orgId: ORG,
      judges: 7,
      stored: false,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      createdAt: at(),
    });

    const err = await refusal(() => check(ORG, 'full', 7));

    // Held: $0.60 spent + $3/7 + $1.00 ≈ $2.03, so 250 − 203 = 47 credits left.
    expect(err.details).toEqual({
      estimateCredits: 100,
      basis: 'profile',
      balanceCredits: 250,
      heldCredits: 203,
      remainingCredits: 47,
      usagePage: '/usage',
    });
    expect(err.message).toContain(
      "more than the 47 left of the workspace's 250 CopyCredits once 203 are held for reviews already starting"
    );
  });

  it('counts a cancelled review still finishing for what it spent, and not once its lease has gone', async () => {
    state.credits = 150;
    review(0.7, {
      status: 'CANCELLED',
      judges: slots(7),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    // $0.70 spent and up to 4 judges ($4/7) to land: $1.27 held, 23 left.
    const err = await refusal(() => check(ORG, 'full', 7));
    expect(err.details).toMatchObject({ heldCredits: 128, remainingCredits: 22 });

    // Its lease gone, it has been charged (`freePlace`): its spend is in the balance.
    state.reviews.at(-1)!.leaseExpiresAt = null;
    await expect(check(ORG, 'full', 7)).resolves.toBeUndefined();
  });

  it('holds back what a cancelled review spent once its run died, until the recovery job charges it', async () => {
    state.credits = 150;
    review(0.7, {
      status: 'CANCELLED',
      judges: slots(7),
      leaseExpiresAt: new Date(Date.now() - 1_000),
      completedAt: new Date(Date.now() - 60_000),
    });
    // Nothing left to land, but its $0.70 is not in the balance yet: 70 held.
    const err = await refusal(() => check(ORG, 'full', 7));
    expect(err.details).toMatchObject({ heldCredits: 70, remainingCredits: 80 });

    // One cancelled before reviews were charged holds nothing.
    state.reviews.at(-1)!.completedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await expect(check(ORG, 'full', 7)).resolves.toBeUndefined();
  });

  it('refuses every review while the balance is below zero, naming it', async () => {
    state.credits = -12;
    state.reviews = [];
    // No history: an estimate of 0 passes on any positive balance, but not this one.
    const err = await refusal(() => check(ORG, 'full', 7));
    expect(err.code).toBe('INSUFFICIENT_CREDITS');
    expect(err.details).toMatchObject({
      estimateCredits: 0,
      balanceCredits: -12,
      remainingCredits: 0,
    });
    expect(err.message).toContain('its balance is -12');
  });

  it('with no history, lets a review start on any positive balance: the overdraft bound', async () => {
    state.reviews = [];
    state.credits = 1;
    await expect(check(ORG, 'full', 7)).resolves.toBeUndefined();
  });

  it('checks the credits before the cap, so a refusal names what the workspace can act on', async () => {
    state.budget = 10;
    state.spent = 9.5;
    state.credits = 10;
    expect((await refusal(() => check(ORG, 'full', 7))).code).toBe('INSUFFICIENT_CREDITS');

    // Credits to spare: the monthly cap, the safety ceiling, still refuses.
    forgetSpendCaps();
    state.credits = 1_000;
    const err = await refusal(() => check(ORG, 'full', 7));
    expect(err.code).toBe('BUDGET_EXCEEDED');
    expect(err.details).toMatchObject({ remainingUsd: 0.5, limitUsd: 10 });
  });

  it('checks only the cap when the balance cannot be read, and logs it', async () => {
    state.creditsFail = true;
    state.budget = 10;
    state.spent = 9.5;
    expect((await refusal(() => check(ORG, 'full', 7))).code).toBe('BUDGET_EXCEEDED');
    expect(logger.warn).toHaveBeenCalledWith(
      'Credit balance unreadable; not refusing on credits',
      expect.objectContaining({ orgId: ORG })
    );

    // Neither bound readable: nothing refused, and the per-judge gate applies.
    forgetSpendCaps();
    state.budget = null;
    await expect(check(ORG, 'full', 7)).resolves.toBeUndefined();
  });

  for (const [label, stored] of [
    ['stored', true],
    ['store: false', false],
  ] as const) {
    it(`${label}: of three checked at the same moment with credits for one, passes one and refuses the others with its hold`, async () => {
      state.credits = 150;

      const outcomes = await Promise.allSettled(
        [1, 2, 3].map(() => reserveReviewBudget(ORG, 'full', 7, stored))
      );

      const refused = outcomes.flatMap((o) => (o.status === 'rejected' ? [o.reason] : []));
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(refused).toHaveLength(2);
      for (const err of refused) {
        expect(err).toMatchObject({
          status: 402,
          code: 'INSUFFICIENT_CREDITS',
          details: { estimateCredits: 100, heldCredits: 100, remainingCredits: 50 },
        });
      }
      expect(state.holds).toHaveLength(1);
    });
  }

  it('as a queued review is claimed, answers the credit refusal for run.ts to store', async () => {
    state.credits = 150;
    const earlier = review(0, { status: 'QUEUED', judges: slots(7), createdAt: at() });
    const self = { id: 'a-self', createdAt: at() };
    void earlier;

    const refused = await budgetRefusal(ORG, 'full', 7, self);

    expect(refused).toMatchObject({
      code: 'INSUFFICIENT_CREDITS',
      details: { heldCredits: 100, remainingCredits: 50 },
    });
    expect(refused?.reason).toContain('CopyCredits');
  });
});

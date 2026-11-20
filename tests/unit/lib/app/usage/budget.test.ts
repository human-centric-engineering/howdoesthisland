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
  orgId: string;
  profile: string;
  status: string;
  costUsd: number;
  createdAt: Date;
}
interface RunRow {
  orgId: string;
  status: string;
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
const matches = (row: Record<string, unknown>, where: Where) =>
  Object.entries(where).every(([k, v]) => row[k] === v);
function newestFirst<T extends { createdAt: Date }>(rows: T[], take: number): T[] {
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take);
}

vi.mock('@/lib/db/client', () => ({
  prisma: {
    aiCostLog: {
      aggregate: vi.fn(async () => ({ _sum: { totalCostUsd: state.spent } })),
    },
    assessment: {
      findMany: vi.fn(async ({ where, take }: { where: Where; take: number }) =>
        newestFirst(
          state.reviews.filter((r) => matches({ ...r }, where)),
          take
        ).map((r) => ({ costUsd: r.costUsd }))
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
import { forgetSpendCaps } from '@/lib/orchestration/llm/spend-caps';
import { APIError } from '@/lib/api/errors';
import { assertReviewWithinBudget, estimateReviewCost } from '@/lib/app/usage/budget';

const ORG = 'org-a';
const OTHER = 'org-b';
let clock = 0;
const at = () => new Date(Date.UTC(2026, 10, 1) + (clock += 1000));

function review(costUsd: number, over: Partial<ReviewRow> = {}): void {
  state.reviews.push({
    orgId: ORG,
    profile: 'full',
    status: 'COMPLETED',
    costUsd,
    createdAt: at(),
    ...over,
  });
}
function judgeRun(costUsd: number, over: Partial<RunRow> = {}): void {
  state.runs.push({ orgId: ORG, status: 'SUCCEEDED', costUsd, createdAt: at(), ...over });
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
  Object.assign(state, { spent: 0, budget: null, quotasFail: false, reviews: [], runs: [] });
});

describe('estimateReviewCost', () => {
  it('is the median of the last 20 completed reviews of the profile, given at least 3', async () => {
    // 21 reviews: the oldest, at $100, is past the last 20 and does not count.
    review(100);
    for (let i = 1; i <= 20; i += 1) review(i * 0.1);
    // Not the profile, not completed, or not this workspace: none counts.
    review(50, { profile: 'quick-group' });
    review(50, { status: 'PARTIAL' });
    review(50, { orgId: OTHER });

    const estimate = await estimateReviewCost(ORG, 'full', 7);

    // The median of 0.1 … 2.0 is (1.0 + 1.1) / 2.
    expect(estimate).toEqual({ estimateUsd: 1.05, basis: 'profile' });
  });

  it('with fewer than 3 of the profile, is the judge count × the median succeeded judge run', async () => {
    review(9);
    review(9);
    judgeRun(0.02);
    judgeRun(0.04);
    judgeRun(0.1);
    judgeRun(5, { status: 'FAILED' });
    judgeRun(5, { orgId: OTHER });

    const estimate = await estimateReviewCost(ORG, 'full', 7);

    expect(estimate).toEqual({ estimateUsd: 0.28, basis: 'judges' });
  });

  it('goes per judge for a custom judge list, whatever reviews it has', async () => {
    for (let i = 0; i < 5; i += 1) review(9, { profile: 'custom' });
    judgeRun(0.05);

    const estimate = await estimateReviewCost(ORG, 'custom', 2);

    expect(estimate).toEqual({ estimateUsd: 0.1, basis: 'judges' });
    expect(prisma.assessment.findMany).not.toHaveBeenCalled();
  });

  it('is 0 with no history', async () => {
    expect(await estimateReviewCost(ORG, 'full', 7)).toEqual({ estimateUsd: 0, basis: 'none' });
  });
});

describe('assertReviewWithinBudget', () => {
  beforeEach(() => {
    state.budget = 10;
    // An estimate of $1.00 a review.
    for (let i = 0; i < 3; i += 1) review(1);
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
});

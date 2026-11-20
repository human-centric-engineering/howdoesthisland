/**
 * Tests: a workspace's usage this month (t-48) — the total against Sunrise's
 * own org cap, and the breakdown by project.
 *
 * Mocked: Prisma (a small in-memory fake of the cost rows and assessments,
 * filtering as the queries ask), the org's quotas and the logger. Real: the
 * service and Sunrise's spend-caps module, so the cap state the test compares
 * against is the one the budget gate reads.
 *
 * @see lib/app/usage/service.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface CostRow {
  orgId: string;
  totalCostUsd: number;
  metadata: unknown;
  createdAt: Date;
}
interface AssessmentRow {
  id: string;
  orgId: string;
  projectId: string | null;
  createdAt: Date;
}

const state = vi.hoisted(() => ({
  costs: [] as CostRow[],
  assessments: [] as AssessmentRow[],
  budget: null as number | null,
  /** Run as the cost rows are read: lets a test move the clock mid-read. */
  onCostRead: null as null | (() => void),
}));

type Since = { orgId: string; createdAt: { gte: Date } };
const within = (row: { orgId: string; createdAt: Date }, where: Since) =>
  row.orgId === where.orgId && row.createdAt >= where.createdAt.gte;

vi.mock('@/lib/db/client', () => ({
  prisma: {
    aiCostLog: {
      aggregate: vi.fn(async ({ where }: { where: Since }) => {
        const rows = state.costs.filter((r) => within(r, where));
        return {
          _sum: { totalCostUsd: rows.length ? rows.reduce((s, r) => s + r.totalCostUsd, 0) : null },
        };
      }),
      findMany: vi.fn(async ({ where }: { where: Since }) => {
        const rows = state.costs
          .filter((r) => within(r, where))
          .map((r) => ({ totalCostUsd: r.totalCostUsd, metadata: r.metadata }));
        state.onCostRead?.();
        state.onCostRead = null;
        return rows;
      }),
    },
    assessment: {
      groupBy: vi.fn(async ({ where }: { where: Since }) => {
        const counts = new Map<string | null, number>();
        for (const a of state.assessments.filter((r) => within(r, where))) {
          counts.set(a.projectId, (counts.get(a.projectId) ?? 0) + 1);
        }
        return [...counts].map(([projectId, n]) => ({ projectId, _count: { _all: n } }));
      }),
      findMany: vi.fn(async ({ where }: { where: { orgId: string; id: { in: string[] } } }) =>
        state.assessments
          .filter((a) => a.orgId === where.orgId && where.id.in.includes(a.id))
          .map((a) => ({ id: a.id, projectId: a.projectId }))
      ),
    },
  },
}));
vi.mock('@/lib/tenancy/org-settings', () => ({
  loadOrgQuotas: vi.fn(async () =>
    state.budget === null ? {} : { monthlyBudgetUsd: state.budget }
  ),
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getMonthUsage, nextMonthStart } from '@/lib/app/usage/service';
import { forgetSpendCaps, getOrgCapState } from '@/lib/orchestration/llm/spend-caps';
import { monthUsageSchema } from '@/lib/app/usage/wire';

const ORG = 'org-a';
const NOW = new Date('2026-11-20T12:00:00Z');
const THIS_MONTH = new Date('2026-11-05T09:00:00Z');
const LAST_MONTH = new Date('2026-10-31T23:59:59Z');

function cost(totalCostUsd: number, metadata: unknown, extra: Partial<CostRow> = {}): void {
  state.costs.push({ orgId: ORG, totalCostUsd, metadata, createdAt: THIS_MONTH, ...extra });
}
function review(id: string, projectId: string | null, extra: Partial<AssessmentRow> = {}): void {
  state.assessments.push({ id, orgId: ORG, projectId, createdAt: THIS_MONTH, ...extra });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  state.costs = [];
  state.assessments = [];
  state.budget = 10;
  state.onCostRead = null;
  forgetSpendCaps();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getMonthUsage', () => {
  it('answers an empty month with zeros, no lines, and the whole budget left', async () => {
    const usage = await getMonthUsage(ORG);

    expect(usage).toEqual({
      month: { start: '2026-11-01T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z' },
      reviews: 0,
      calls: 0,
      spendUsd: 0,
      cap: { limitUsd: 10, remainingUsd: 10, exceeded: false },
      lines: [],
    });
    expect(monthUsageSchema.parse(usage)).toEqual(usage);
  });

  it('totals exactly what the org cap reads, and breaks it down by project', async () => {
    review('a1', 'launch');
    review('a2', 'launch');
    review('a3', 'docs');
    review('a4', null);
    cost(0.5, { judge: 'ethos', assessmentId: 'a1', attempts: 1 });
    cost(1.0, { judge: 'pathos', assessmentId: 'a1', attempts: 2 });
    cost(0.25, { editor: 'summary', assessmentId: 'a2', attempts: 1 });
    cost(2.0, { judge: 'ethos', assessmentId: 'a3', attempts: 1 });
    cost(0.75, { judge: 'ethos', assessmentId: 'a4', attempts: 1 });
    // Another workspace's spend, and last month's, count nowhere.
    cost(9, { judge: 'ethos', assessmentId: 'a1' }, { orgId: 'org-b' });
    cost(9, { judge: 'ethos', assessmentId: 'a1' }, { createdAt: LAST_MONTH });
    review('old', 'launch', { createdAt: LAST_MONTH });

    const usage = await getMonthUsage(ORG);
    const cap = await getOrgCapState(ORG);

    expect(usage.spendUsd).toBe(cap?.spent);
    expect(usage.spendUsd).toBe(4.5);
    expect(usage.cap).toEqual({ limitUsd: 10, remainingUsd: 5.5, exceeded: false });
    expect(usage.lines).toEqual([
      { kind: 'project', projectId: 'docs', reviews: 1, calls: 1, spendUsd: 2 },
      { kind: 'project', projectId: 'launch', reviews: 2, calls: 4, spendUsd: 1.75 },
      { kind: 'no-project', projectId: null, reviews: 1, calls: 1, spendUsd: 0.75 },
    ]);
    expect(usage.reviews).toBe(4);
    expect(usage.calls).toBe(6);
  });

  it('puts reviews kept nowhere on their own line, counting each run once', async () => {
    cost(0.4, { judge: 'ethos', ephemeral: true, ephemeralRun: 'r1', attempts: 1 });
    cost(0.4, { judge: 'pathos', ephemeral: true, ephemeralRun: 'r1', attempts: 1 });
    cost(0.2, { judge: 'ethos', ephemeral: true, ephemeralRun: 'r2', attempts: 1 });
    // Written before runs were tagged: its spend counts, but it is no review.
    cost(0.5, { judge: 'ethos', ephemeral: true });

    const usage = await getMonthUsage(ORG);

    expect(usage.lines).toEqual([
      { kind: 'kept-nowhere', projectId: null, reviews: 2, calls: 4, spendUsd: 1.5 },
    ]);
    expect(usage.spendUsd).toBe((await getOrgCapState(ORG))?.spent);
    expect(usage.reviews).toBe(2);
  });

  it("puts a deleted review's spend and non-review spend on the other line, so the lines add up", async () => {
    review('a1', null);
    cost(1, { judge: 'ethos', assessmentId: 'a1', attempts: 1 });
    cost(2, { judge: 'ethos', assessmentId: 'gone', attempts: 2 });
    cost(0.5, { purpose: 'embedding' });
    cost(0.25, 'not an object');

    const usage = await getMonthUsage(ORG);

    expect(usage.lines).toEqual([
      { kind: 'no-project', projectId: null, reviews: 1, calls: 1, spendUsd: 1 },
      { kind: 'other', projectId: null, reviews: 0, calls: 2, spendUsd: 2.75 },
    ]);
    expect(usage.lines.reduce((s, l) => s + l.spendUsd, 0)).toBe(usage.spendUsd);
  });

  it("puts a calibration run's judge rows on the other line, not with reviews kept nowhere", async () => {
    // Calibration runs its judges with `ephemeral: true`, in the install org.
    cost(0.6, { judge: 'ethos', ephemeral: true, calibrationRunId: 'cal1', attempts: 1 });
    cost(0.4, { judge: 'ethos', ephemeral: true, ephemeralRun: 'r1', attempts: 1 });

    const usage = await getMonthUsage(ORG);

    expect(usage.lines).toEqual([
      { kind: 'kept-nowhere', projectId: null, reviews: 1, calls: 1, spendUsd: 0.4 },
      { kind: 'other', projectId: null, reviews: 0, calls: 1, spendUsd: 0.6 },
    ]);
  });

  it('reads again when the month turns during the read, so lines and total are one month', async () => {
    // Last month's rows, read just before midnight UTC on the first.
    vi.setSystemTime(new Date('2026-11-30T23:59:59.900Z'));
    review('a1', null);
    cost(2, { judge: 'ethos', assessmentId: 'a1', attempts: 1 });
    // The month turns while the first read is in flight.
    state.onCostRead = () => vi.setSystemTime(new Date('2026-12-01T00:00:00.100Z'));

    const usage = await getMonthUsage(ORG);

    expect(usage.month.start).toBe('2026-12-01T00:00:00.000Z');
    expect(usage).toMatchObject({ reviews: 0, calls: 0, spendUsd: 0, lines: [] });
  });

  it('answers no cap when the workspace has no budget, with the same total', async () => {
    state.budget = null;
    review('a1', null);
    cost(3, { judge: 'ethos', assessmentId: 'a1', attempts: 1 });

    const usage = await getMonthUsage(ORG);

    expect(usage.cap).toBeNull();
    expect(usage.spendUsd).toBe(3);
  });

  it('shows a reached budget as exceeded with nothing left', async () => {
    state.budget = 2;
    cost(2.5, { judge: 'ethos', ephemeral: true, ephemeralRun: 'r1', attempts: 1 });

    const usage = await getMonthUsage(ORG);

    expect(usage.cap).toEqual({ limitUsd: 2, remainingUsd: 0, exceeded: true });
  });
});

describe('nextMonthStart', () => {
  it('rolls December over into January', () => {
    expect(nextMonthStart(new Date('2026-12-01T00:00:00Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z'
    );
  });
});

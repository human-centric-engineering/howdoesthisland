/**
 * Tests: CopyCredits for platform admins (t-57) — the list's balances and
 * caps, and a change that records its actor and warns when the balance is
 * worth more than the cap leaves this month.
 *
 * Mocked: Prisma, the org cap read and the system scope (a pass-through).
 * Real: the ledger, the rate and the quota reader.
 *
 * @see lib/app/credits/admin.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  orgs: [] as Array<{ id: string; name: string; slug: string; settings: unknown; status: string }>,
  balances: new Map<string, number>(),
  spend: new Map<string, number>(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    org: {
      findMany: vi.fn(async ({ take }: { take: number }) =>
        db.orgs.filter((o) => o.status === 'ACTIVE').slice(0, take)
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const org = db.orgs.find((o) => o.id === where.id);
        return org ? { status: org.status } : null;
      }),
    },
    creditEntry: {
      create: vi.fn(async ({ data }: { data: { orgId: string; amount: number } }) => {
        db.balances.set(data.orgId, (db.balances.get(data.orgId) ?? 0) + data.amount);
        return { id: 'entry-1', createdAt: new Date('2026-11-20T12:00:00Z'), ...data };
      }),
      aggregate: vi.fn(async ({ where }: { where: { orgId: string } }) => ({
        _sum: { amount: db.balances.get(where.orgId) ?? null },
      })),
      groupBy: vi.fn(async ({ where }: { where: { orgId: { in: string[] } } }) =>
        where.orgId.in
          .filter((id) => db.balances.has(id))
          .map((orgId) => ({ orgId, _sum: { amount: db.balances.get(orgId) } }))
      ),
    },
    aiCostLog: {
      groupBy: vi.fn(async ({ where }: { where: { orgId: { in: string[] } } }) =>
        where.orgId.in
          .filter((id) => db.spend.has(id))
          .map((orgId) => ({ orgId, _sum: { totalCostUsd: db.spend.get(orgId) } }))
      ),
    },
  },
}));

const cap = vi.hoisted(() => ({ state: null as null | { limit: number; spent: number } }));
vi.mock('@/lib/orchestration/llm/spend-caps', () => ({
  getOrgCapState: vi.fn(async () =>
    cap.state ? { ...cap.state, exceeded: cap.state.spent >= cap.state.limit } : null
  ),
  utcMonthStart: () => new Date('2026-11-01T00:00:00Z'),
}));
vi.mock('@/lib/tenancy/context', () => ({
  runAsSystem: vi.fn((_reason: string, fn: () => Promise<unknown>) => fn()),
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { prisma } from '@/lib/db/client';
import { runAsSystem } from '@/lib/tenancy/context';
import { changeWorkspaceCredits, listWorkspaceCredits } from '@/lib/app/credits/admin';
import { ADMIN_CREDITS_LIST_LIMIT, adminCreditsListSchema } from '@/lib/app/credits/wire';

const quotas = (monthlyBudgetUsd: number) => ({ quotas: { monthlyBudgetUsd } });

beforeEach(() => {
  vi.clearAllMocks();
  db.orgs = [
    { id: 'a', name: 'Acme', slug: 'acme', settings: quotas(10), status: 'ACTIVE' },
    { id: 'b', name: 'Bravo', slug: 'bravo', settings: null, status: 'ACTIVE' },
  ];
  db.balances = new Map([['a', 450]]);
  db.spend = new Map([['a', 3.5]]);
  cap.state = { limit: 10, spent: 3.5 };
});

describe('listWorkspaceCredits', () => {
  it('lists each workspace with its balance and what its cap leaves this month', async () => {
    const list = await listWorkspaceCredits();

    expect(list).toEqual({
      workspaces: [
        {
          orgId: 'a',
          name: 'Acme',
          slug: 'acme',
          balance: 450,
          cap: { limitUsd: 10, remainingUsd: 6.5 },
        },
        // No entries is a balance of 0; no cap set is `null`, which Sunrise reads as unlimited.
        { orgId: 'b', name: 'Bravo', slug: 'bravo', balance: 0, cap: null },
      ],
      truncated: false,
    });
    expect(adminCreditsListSchema.parse(list)).toEqual(list);
    expect(runAsSystem).toHaveBeenCalledTimes(1);
  });

  it('reads the month’s spend from the month start, in one query for every workspace', async () => {
    await listWorkspaceCredits();
    expect(prisma.aiCostLog.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.aiCostLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: { in: ['a', 'b'] }, createdAt: { gte: new Date('2026-11-01T00:00:00Z') } },
      })
    );
  });

  it('never shows less than nothing left of a cap already passed', async () => {
    db.spend.set('a', 12);
    const [acme] = (await listWorkspaceCredits()).workspaces;
    expect(acme?.cap).toEqual({ limitUsd: 10, remainingUsd: 0 });
  });

  it('narrows by name or slug, case-insensitively', async () => {
    await listWorkspaceCredits('acm');
    expect(prisma.org.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'ACTIVE',
          OR: [
            { name: { contains: 'acm', mode: 'insensitive' } },
            { slug: { contains: 'acm', mode: 'insensitive' } },
          ],
        },
      })
    );
  });

  it('says when more workspaces match than the list holds', async () => {
    db.orgs = Array.from({ length: ADMIN_CREDITS_LIST_LIMIT + 1 }, (_, i) => ({
      id: `org-${i}`,
      name: `Workspace ${i}`,
      slug: `ws-${i}`,
      settings: null,
      status: 'ACTIVE',
    }));
    const list = await listWorkspaceCredits();
    expect(list.workspaces).toHaveLength(ADMIN_CREDITS_LIST_LIMIT);
    expect(list.truncated).toBe(true);
  });
});

describe('changeWorkspaceCredits', () => {
  it('records a grant with its actor and reason, and answers the new balance', async () => {
    const result = await changeWorkspaceCredits(
      'a',
      { kind: 'grant', amount: 100, reason: 'Pilot' },
      'admin-1'
    );

    expect(prisma.creditEntry.create).toHaveBeenCalledWith({
      data: {
        orgId: 'a',
        amount: 100,
        kind: 'GRANT',
        reason: 'Pilot',
        actorUserId: 'admin-1',
        reference: null,
      },
    });
    expect(result).toEqual({
      entry: {
        id: 'entry-1',
        amount: 100,
        kind: 'GRANT',
        reason: 'Pilot',
        createdAt: '2026-11-20T12:00:00.000Z',
      },
      balance: 550,
      // $5.50 of credits fits in the $6.50 the cap leaves.
      capWarning: null,
    });
  });

  it('records an adjustment as ADJUST, and lets it take the balance below zero', async () => {
    const result = await changeWorkspaceCredits(
      'a',
      { kind: 'adjust', amount: -500, reason: 'Granted to the wrong workspace' },
      'admin-1'
    );
    expect(result.entry.kind).toBe('ADJUST');
    expect(result.balance).toBe(-50);
  });

  it('warns when the balance is worth more than the cap leaves this month', async () => {
    const result = await changeWorkspaceCredits(
      'a',
      { kind: 'grant', amount: 300, reason: 'Big pilot' },
      'admin-1'
    );
    // 750 credits is $7.50; the cap leaves $6.50 of its $10.
    expect(result.capWarning).toEqual({ balanceUsd: 7.5, remainingUsd: 6.5, limitUsd: 10 });
  });

  it('does not warn for a workspace with no cap', async () => {
    cap.state = null;
    const result = await changeWorkspaceCredits(
      'a',
      { kind: 'grant', amount: 100_000, reason: 'Big' },
      'admin-1'
    );
    expect(result.capWarning).toBeNull();
  });

  it.each([
    ['does not exist', 'missing'],
    ['is suspended', 'c'],
  ])('refuses a workspace that %s, writing nothing', async (_name, id) => {
    db.orgs.push({
      id: 'c',
      name: 'Charlie',
      slug: 'charlie',
      settings: null,
      status: 'SUSPENDED',
    });
    await expect(
      changeWorkspaceCredits(id, { kind: 'grant', amount: 10, reason: 'x' }, 'admin-1')
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.creditEntry.create).not.toHaveBeenCalled();
  });
});

/**
 * Tests: the CopyCredits ledger (t-57) — an entry records what it is given,
 * one that moves nothing is refused, and every balance read is the sum of the
 * named workspace's rows.
 *
 * Mocked: Prisma, as a small in-memory ledger filtering as the queries ask.
 *
 * @see lib/app/credits/ledger.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Row {
  orgId: string;
  amount: number;
  kind: string;
  createdAt: Date;
}

const rows = vi.hoisted(() => ({ list: [] as Row[] }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    creditEntry: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'entry-1',
        createdAt: new Date('2026-11-20T12:00:00Z'),
        ...data,
      })),
      aggregate: vi.fn(
        async ({
          where,
        }: {
          where: { orgId: string; kind?: string; createdAt?: { gte: Date } };
        }) => {
          const hit = rows.list.filter(
            (r) =>
              r.orgId === where.orgId &&
              (where.kind === undefined || r.kind === where.kind) &&
              (where.createdAt === undefined || r.createdAt >= where.createdAt.gte)
          );
          return { _sum: { amount: hit.length ? hit.reduce((s, r) => s + r.amount, 0) : null } };
        }
      ),
      groupBy: vi.fn(async ({ where }: { where: { orgId: { in: string[] } } }) => {
        const sums = new Map<string, number>();
        for (const r of rows.list.filter((x) => where.orgId.in.includes(x.orgId))) {
          sums.set(r.orgId, (sums.get(r.orgId) ?? 0) + r.amount);
        }
        return [...sums].map(([orgId, amount]) => ({ orgId, _sum: { amount } }));
      }),
    },
  },
}));

import { prisma } from '@/lib/db/client';
import {
  getCreditBalance,
  getCreditBalances,
  getCreditsChargedSince,
  recordCreditEntry,
} from '@/lib/app/credits/ledger';

const JAN = new Date('2026-11-01T00:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  rows.list = [
    { orgId: 'a', amount: 1000, kind: 'GRANT', createdAt: new Date('2026-10-02T00:00:00Z') },
    { orgId: 'a', amount: -200, kind: 'CHARGE', createdAt: new Date('2026-10-20T00:00:00Z') },
    { orgId: 'a', amount: -30, kind: 'CHARGE', createdAt: new Date('2026-11-03T00:00:00Z') },
    { orgId: 'a', amount: -5, kind: 'ADJUST', createdAt: new Date('2026-11-04T00:00:00Z') },
    { orgId: 'b', amount: 50, kind: 'REDEEM', createdAt: new Date('2026-11-05T00:00:00Z') },
  ];
});

describe('recordCreditEntry', () => {
  it('writes the entry it is given, with absent fields as null', async () => {
    await recordCreditEntry({ orgId: 'a', amount: 500, kind: 'GRANT', reason: 'Pilot' });

    expect(prisma.creditEntry.create).toHaveBeenCalledWith({
      data: {
        orgId: 'a',
        amount: 500,
        kind: 'GRANT',
        reason: 'Pilot',
        actorUserId: null,
        reference: null,
      },
    });
  });

  it('writes through the client it is handed, so a caller can use its own transaction', async () => {
    const tx = { creditEntry: { create: vi.fn(async () => ({ id: 'tx-entry' })) } };
    await recordCreditEntry(
      { orgId: 'a', amount: -12, kind: 'CHARGE', reference: 'assessment:x1' },
      tx as never
    );
    expect(tx.creditEntry.create).toHaveBeenCalledTimes(1);
    expect(prisma.creditEntry.create).not.toHaveBeenCalled();
  });

  it.each([0, 1.5, Number.NaN])('refuses an entry of %s credits', async (amount) => {
    await expect(recordCreditEntry({ orgId: 'a', amount, kind: 'ADJUST' })).rejects.toThrow(
      'whole number of credits'
    );
    expect(prisma.creditEntry.create).not.toHaveBeenCalled();
  });
});

describe('balances', () => {
  it('sums the named workspace’s entries, every kind', async () => {
    expect(await getCreditBalance('a')).toBe(765);
    expect(await getCreditBalance('b')).toBe(50);
  });

  it('is 0 for a workspace with no entries, as every new one is', async () => {
    expect(await getCreditBalance('new')).toBe(0);
  });

  it('reads several at once, 0 for those with none', async () => {
    const balances = await getCreditBalances(['a', 'b', 'new']);
    expect(Object.fromEntries(balances)).toEqual({ a: 765, b: 50, new: 0 });
  });

  it('does not query for no workspaces', async () => {
    expect((await getCreditBalances([])).size).toBe(0);
    expect(prisma.creditEntry.groupBy).not.toHaveBeenCalled();
  });
});

describe('getCreditsChargedSince', () => {
  it('counts only charges since the date, as a positive number', async () => {
    expect(await getCreditsChargedSince('a', JAN)).toBe(30);
  });

  it('is exactly 0, not -0, with no charges', async () => {
    expect(Object.is(await getCreditsChargedSince('b', JAN), 0)).toBe(true);
  });
});

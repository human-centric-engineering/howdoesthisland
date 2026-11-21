/**
 * A workspace's CopyCredits ledger (t-57, f-credits). Design:
 * .context/app/credits.md.
 *
 * **Append-only.** Every change to a balance is a `CreditEntry` row, and the
 * balance is the sum of their `amount`. There is no stored balance to drift
 * from its rows, and no row is updated or deleted, except by the workspace's
 * own erasure (the FK cascades). A wrong entry is corrected by another
 * (`ADJUST`), so the ledger says what happened as well as where it stands.
 *
 * **A new workspace starts with no rows**, so a balance of 0: nothing here
 * runs at sign-up. A review is checked against the balance before it starts
 * (`lib/app/usage/budget.ts`) and charged as it ends (`./charge.ts`), t-58.
 *
 * Every read names the org, so it answers for that workspace whatever scope
 * the caller is in. Writes go through {@link recordCreditEntry}, which takes a
 * client so a caller can record an entry inside its own transaction (t-60
 * credits a redemption where it is counted). The charge (`./charge.ts`, t-58)
 * writes its own, inside the transaction that ends a review, so it can skip a
 * duplicate rather than fail on it, under the same rule ({@link assertCreditAmount}).
 */
import type { CreditEntry, CreditEntryKind, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

/** A client that can write a credit entry: `prisma`, or a transaction's. */
export type CreditWriter = Pick<Prisma.TransactionClient, 'creditEntry'>;

/** What a new entry records. */
export interface NewCreditEntry {
  orgId: string;
  amount: number;
  kind: CreditEntryKind;
  reason?: string | null;
  actorUserId?: string | null;
  /** `<kind>:<id>` of the thing credited or charged, so it happens once. */
  reference?: string | null;
}

/**
 * Throw unless `amount` is a whole number of credits other than `0`: every
 * entry's rule, for a writer that cannot go through {@link recordCreditEntry}
 * (the charge, which skips a duplicate rather than failing on it).
 */
export function assertCreditAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount === 0) {
    throw new Error(`A credit entry moves a whole number of credits, not ${amount}`);
  }
}

/**
 * Record one change to a workspace's balance. Throws on an amount that is not
 * a whole number, or is `0`: a row that changes nothing is noise in a ledger
 * people read. A second entry with the same `kind` and `reference` fails on
 * the unique index (P2002), which is how a caller makes its change happen once.
 */
export async function recordCreditEntry(
  entry: NewCreditEntry,
  db: CreditWriter = prisma
): Promise<CreditEntry> {
  assertCreditAmount(entry.amount);
  return db.creditEntry.create({
    data: {
      orgId: entry.orgId,
      amount: entry.amount,
      kind: entry.kind,
      reason: entry.reason ?? null,
      actorUserId: entry.actorUserId ?? null,
      reference: entry.reference ?? null,
    },
  });
}

/** A workspace's balance: the sum of its entries, `0` with none. */
export async function getCreditBalance(
  orgId: string,
  db: Pick<Prisma.TransactionClient, 'creditEntry'> = prisma
): Promise<number> {
  const { _sum } = await db.creditEntry.aggregate({ where: { orgId }, _sum: { amount: true } });
  return _sum.amount ?? 0;
}

/** Credits a workspace's reviews were charged since `since`, as a positive number. */
export async function getCreditsChargedSince(orgId: string, since: Date): Promise<number> {
  const { _sum } = await prisma.creditEntry.aggregate({
    where: { orgId, kind: 'CHARGE', createdAt: { gte: since } },
    _sum: { amount: true },
  });
  // `0 - x`, not `-x`: with no charges `-0` would reach the wire as `-0`.
  return 0 - (_sum.amount ?? 0);
}

/** Balances of several workspaces at once, by org id; a workspace with no entries is `0`. */
export async function getCreditBalances(orgIds: string[]): Promise<Map<string, number>> {
  const balances = new Map(orgIds.map((id) => [id, 0]));
  if (orgIds.length === 0) return balances;
  const groups = await prisma.creditEntry.groupBy({
    by: ['orgId'],
    where: { orgId: { in: orgIds } },
    _sum: { amount: true },
  });
  for (const group of groups) {
    if (group.orgId) balances.set(group.orgId, group._sum.amount ?? 0);
  }
  return balances;
}

/**
 * When the workspace's first entry was written, or `null` with none: the
 * floor of what a recovery sweep charges (t-58). A review starts only on a
 * positive balance, so every review since charging began was created after
 * its workspace's first entry; one created before it ran before then, and was
 * never meant to be charged.
 */
export async function firstCreditEntryAt(
  orgId: string,
  db: Pick<Prisma.TransactionClient, 'creditEntry'> = prisma
): Promise<Date | null> {
  const first = await db.creditEntry.findFirst({
    where: { orgId },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  return first?.createdAt ?? null;
}

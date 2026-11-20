/**
 * Charge a review in CopyCredits for what it spent (t-58, f-credits). Design:
 * .context/app/credits.md.
 *
 * **When.** A review is charged when it ends, for its recorded cost rows
 * (`AiCostLog`, which every judge and editor call writes, billed attempts
 * included), at `creditsForUsd()`: rounded up to a whole credit. A review
 * that spent nothing is not charged.
 *
 * - **Stored**, by the write that ends it, in the same transaction, so a
 *   review is always either in flight (the budget check holds back what it
 *   has spent so far, `budget.ts`) or charged, never neither: `finish()` and
 *   the final failure in `run.ts`, the last-attempt give-up in `recover.ts`,
 *   a cancel with no run to finish it, and a cancelled run's last write
 *   (`freePlace`). A cancelled review whose run died is charged by the
 *   recovery job, which clears its lease as it does.
 * - **`store: false`**, once its run ends, before its budget hold is released
 *   (`service.ts`). Its rows carry `ephemeralRun`.
 *
 * **Once.** The entry's reference is `assessment:<id>` or
 * `ephemeral-run:<runId>`, and `(kind, reference)` is unique, so the insert
 * skips a duplicate rather than failing: two finishers racing, or a recovery
 * after a run already charged, charge once. Stored reviews are never claimed
 * again once final, so a re-drive or recovery runs before the one charge,
 * which covers every attempt's rows.
 *
 * **What it can miss.** A row that lands after the charge: a judge of a run
 * that lost its lease while another finished the review, or one that landed
 * after a delete or a lapsed cancel lease. At most `JUDGES_IN_FLIGHT` calls
 * each time, and the monthly cap still bounds them.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { creditsForUsd } from '@/lib/app/credits/rate';

/** A client that can read cost rows and write a charge: `prisma`, or a transaction's. */
export type ChargeClient = Pick<Prisma.TransactionClient, 'aiCostLog' | 'creditEntry'>;

/** What a charge did. */
export interface ReviewCharge {
  /** Credits taken; `0` when it spent nothing or was charged already. */
  credits: number;
  /** What its rows say it spent. */
  spentUsd: number;
}

export function assessmentChargeReference(assessmentId: string): string {
  return `assessment:${assessmentId}`;
}

export function ephemeralRunChargeReference(runId: string): string {
  return `ephemeral-run:${runId}`;
}

async function charge(
  db: ChargeClient,
  orgId: string,
  reference: string,
  rows: Prisma.AiCostLogWhereInput
): Promise<ReviewCharge> {
  const { _sum } = await db.aiCostLog.aggregate({
    where: { orgId, ...rows },
    _sum: { totalCostUsd: true },
  });
  const spentUsd = _sum.totalCostUsd ?? 0;
  const credits = creditsForUsd(spentUsd);
  if (credits === 0) return { credits: 0, spentUsd };
  // ON CONFLICT DO NOTHING: a duplicate is the review already charged, and
  // leaves a caller's transaction usable, which a failed insert would not.
  const { count } = await db.creditEntry.createMany({
    data: [{ orgId, amount: -credits, kind: 'CHARGE', reference }],
    skipDuplicates: true,
  });
  return { credits: count === 1 ? credits : 0, spentUsd };
}

/**
 * Charge the stored review `assessmentId` for its cost rows since `since` (its
 * `createdAt`: the index range of the org's rows). Call it from the write that
 * ends the review, in that write's transaction.
 */
export function chargeStoredReview(
  db: ChargeClient,
  orgId: string,
  assessmentId: string,
  since: Date
): Promise<ReviewCharge> {
  return charge(db, orgId, assessmentChargeReference(assessmentId), {
    createdAt: { gte: since },
    metadata: { path: ['assessmentId'], equals: assessmentId },
  });
}

/** Charge the `store: false` run `runId`, which began at `since`, for its cost rows. */
export function chargeEphemeralRun(
  orgId: string,
  runId: string,
  since: Date,
  db: ChargeClient = prisma
): Promise<ReviewCharge> {
  return charge(db, orgId, ephemeralRunChargeReference(runId), {
    createdAt: { gte: since },
    metadata: { path: ['ephemeralRun'], equals: runId },
  });
}

/** A transaction that ends a stored review and charges it. */
export type EndingClient = ChargeClient & Pick<Prisma.TransactionClient, 'assessment'>;

/**
 * Charge the stored review `assessmentId`, read for its org and `createdAt`,
 * inside the transaction whose write just ended it. `null` when the row is
 * gone or in no workspace.
 */
export async function chargeEndedReview(
  db: EndingClient,
  assessmentId: string
): Promise<ReviewCharge | null> {
  const row = await db.assessment.findUnique({
    where: { id: assessmentId },
    select: { orgId: true, createdAt: true },
  });
  if (!row?.orgId) return null;
  return chargeStoredReview(db, row.orgId, assessmentId, row.createdAt);
}

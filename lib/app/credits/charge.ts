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
 *   (`service.ts`). Its rows carry `ephemeralRun`. One whose charge failed,
 *   or whose process died first, is charged by the recovery job once its
 *   rows have been quiet for `CANCEL_GRACE_MS` ({@link chargeLapsedEphemeralRuns}).
 *
 * **Once.** The entry's reference is `assessment:<id>` or
 * `ephemeral-run:<runId>` (`rewrite:<id>` for a rewrite, t-81), and
 * `(kind, reference)` is unique, so the insert
 * skips a duplicate rather than failing: two finishers racing, or a recovery
 * after a run already charged, charge once. Stored reviews are never claimed
 * again once final, so a re-drive or recovery runs before the one charge,
 * which covers every attempt's rows.
 *
 * **What it can miss.** A row that lands after the charge: a judge of a run
 * that lost its lease while another finished the review, or one that landed
 * after a delete or a lapsed cancel lease, or a `store: false` run's call
 * that lands after an hour's quiet. At most `JUDGES_IN_FLIGHT` calls each
 * time, and the monthly cap still bounds them.
 */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { creditsForUsd } from '@/lib/app/credits/rate';
import { assertCreditAmount, firstCreditEntryAt } from '@/lib/app/credits/ledger';
import { CANCEL_GRACE_MS, CHARGE_SWEEP_MS } from '@/lib/app/assessments/limits';

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

export function rewriteChargeReference(rewriteId: string): string {
  return `rewrite:${rewriteId}`;
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
  assertCreditAmount(-credits);
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
 * ends the review, in that write's transaction. A review made before its
 * workspace's first credit entry is not charged: it started before charging
 * began, on no balance (`firstCreditEntryAt`), so one in flight at the deploy
 * does not take its workspace below zero.
 */
export async function chargeStoredReview(
  db: ChargeClient,
  orgId: string,
  assessmentId: string,
  since: Date
): Promise<ReviewCharge> {
  const first = await firstCreditEntryAt(orgId, db);
  if (!first || since < first) return { credits: 0, spentUsd: 0 };
  return charge(db, orgId, assessmentChargeReference(assessmentId), {
    createdAt: { gte: since },
    metadata: { path: ['assessmentId'], equals: assessmentId },
  });
}

/**
 * Charge the rewrite `rewriteId` (t-81) for its cost rows since `since` (its
 * `createdAt`), which carry `rewriteId` and no `assessmentId`, so its
 * review's charge never counted them. Call it from the write that ends the
 * rewrite, in that write's transaction, as for a stored review; one made
 * before its workspace's first credit entry is not charged, for the same
 * reason.
 */
export async function chargeRewrite(
  db: ChargeClient,
  orgId: string,
  rewriteId: string,
  since: Date
): Promise<ReviewCharge> {
  const first = await firstCreditEntryAt(orgId, db);
  if (!first || since < first) return { credits: 0, spentUsd: 0 };
  return charge(db, orgId, rewriteChargeReference(rewriteId), {
    createdAt: { gte: since },
    metadata: { path: ['rewriteId'], equals: rewriteId },
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

/**
 * Which cancelled reviews with their lease still set are still to be charged
 * (t-58): made since the workspace's first credit entry, and cancelled within
 * {@link CHARGE_SWEEP_MS} (its `completedAt`, not its `createdAt`: a review
 * may wait or run longer than the window before it is cancelled). `null`
 * with no entry: none is. A filter on `Assessment`, for the recovery job, the
 * credit check and a delete.
 */
export async function uncharged(
  orgId: string,
  now: Date,
  db: Pick<Prisma.TransactionClient, 'creditEntry'> = prisma
): Promise<{ createdAt: { gte: Date }; completedAt: { gt: Date } } | null> {
  const first = await firstCreditEntryAt(orgId, db);
  if (!first) return null;
  return {
    createdAt: { gte: first },
    completedAt: { gt: new Date(now.getTime() - CHARGE_SWEEP_MS) },
  };
}

/**
 * The earliest a recovery sweep looks for what was never charged (t-58): the
 * later of the workspace's first credit entry (`firstCreditEntryAt`: rows
 * before it ran before charging began) and {@link CHARGE_SWEEP_MS} ago.
 * `null` with no entry: nothing it has spent was ever to be charged.
 */
export async function chargeSweepFloor(
  orgId: string,
  now: Date,
  db: Pick<Prisma.TransactionClient, 'creditEntry'> = prisma
): Promise<Date | null> {
  const first = await firstCreditEntryAt(orgId, db);
  if (!first) return null;
  const window = now.getTime() - CHARGE_SWEEP_MS;
  return first.getTime() > window ? first : new Date(window);
}

/** A `store: false` run's cost row, as `run-judge.ts` and the editor tag it. */
const ephemeralRunRow = z.object({
  ephemeralRun: z.string(),
  // A calibration run's judges are tagged ephemeral too; they are no review of the workspace's.
  calibrationRunId: z.string().optional(),
});

/**
 * Charge up to `limit` of the workspace's `store: false` runs that spent
 * something and were never charged: their own charge failed, or their
 * process died before it (`service.ts`). Only runs whose last row is older
 * than `CANCEL_GRACE_MS`, so a run still going is not charged before its
 * last calls land, and none before {@link chargeSweepFloor}. Answers how many it charged.
 */
export async function chargeLapsedEphemeralRuns(
  orgId: string,
  now: Date,
  limit: number
): Promise<number> {
  const floor = await chargeSweepFloor(orgId, now);
  if (!floor) return 0;
  const quietSince = now.getTime() - CANCEL_GRACE_MS;
  const rows = await prisma.aiCostLog.findMany({
    where: {
      orgId,
      createdAt: { gte: floor },
      metadata: { path: ['ephemeral'], equals: true },
    },
    select: { createdAt: true, totalCostUsd: true, metadata: true },
  });
  const runs = new Map<string, { first: Date; last: Date; spentUsd: number }>();
  for (const row of rows) {
    const parsed = ephemeralRunRow.safeParse(row.metadata);
    if (!parsed.success || parsed.data.calibrationRunId !== undefined) continue;
    const run = runs.get(parsed.data.ephemeralRun);
    if (!run) {
      runs.set(parsed.data.ephemeralRun, {
        first: row.createdAt,
        last: row.createdAt,
        spentUsd: row.totalCostUsd,
      });
      continue;
    }
    if (row.createdAt < run.first) run.first = row.createdAt;
    if (row.createdAt > run.last) run.last = row.createdAt;
    run.spentUsd += row.totalCostUsd;
  }
  const quiet = [...runs].filter(
    ([, run]) => run.last.getTime() <= quietSince && creditsForUsd(run.spentUsd) > 0
  );
  if (quiet.length === 0) return 0;
  const charged = await prisma.creditEntry.findMany({
    where: {
      kind: 'CHARGE',
      reference: { in: quiet.map(([runId]) => ephemeralRunChargeReference(runId)) },
    },
    select: { reference: true },
  });
  const done = new Set(charged.map((entry) => entry.reference));
  let count = 0;
  for (const [runId, run] of quiet) {
    if (count >= limit) break;
    if (done.has(ephemeralRunChargeReference(runId))) continue;
    const { credits } = await chargeEphemeralRun(orgId, runId, run.first);
    if (credits > 0) count += 1;
  }
  return count;
}

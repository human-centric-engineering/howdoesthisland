/**
 * Fail and charge rewrites whose process died (t-81, t-85).
 *
 * The maintenance tick runs this once per workspace (`lib/app/jobs.ts`). A
 * rewrite saves and renews its lease every few seconds while its call runs
 * (`service.ts`), so one still `RUNNING` with its lease run out lost its
 * process: nothing will end it but this. It is ended `FAILED`, keeping what
 * it had saved, and charged for its cost rows in the same transaction, which
 * also stops it holding budget.
 *
 * **Priced when it left no row** (t-85). A streamed call writes its cost row
 * only as it ends, so one whose process died part-way through the stream
 * (the platform cut it off, or the server stopped) left none, though the
 * provider billed it. Recovery writes the row the call would have written
 * had it been stopped there (`recordStoppedStream`): from what the rewrite
 * kept of its call as it started (`callStart`) and the draft it had saved,
 * tagged `estimated`, then charges it. Only when it has no cost row of its
 * own, so a call that ended and wrote one is never estimated as well. One
 * with no saved draft is charged nothing: the provider may not have
 * answered. See "What it can miss" in `.context/app/rewrites.md`.
 *
 * **Only once its call cannot still be running.** A rewrite is left alone
 * until it is {@link REWRITE_LIFETIME_MS} old, past which its call has been
 * cut off, so the estimate is not followed by the call's own row.
 *
 * Idempotent: the write that ends it matches only a `RUNNING` row past its
 * lease, so a second pass, or a call that finished meanwhile, changes
 * nothing; it locks the row, so a pass running alongside waits and then
 * finds it ended. An estimate written by a pass whose transaction then
 * failed is a cost row the next pass finds, and charges, without another.
 *
 * A lease can also run out while the call lives, if its saves fail for that
 * long. Its next save sets it `RUNNING` again, and it charges itself as it
 * ends.
 */
import { RECOVERY_BATCH } from '@/lib/app/assessments/limits';
import { chargeRewrite } from '@/lib/app/credits/charge';
import { recordStoppedStream } from '@/lib/app/judges/run-judge';
import { parseRewriteCallStart } from '@/lib/app/rewrites/call-start';
import { REWRITE_COST_TAG, REWRITE_LIFETIME_MS } from '@/lib/app/rewrites/limits';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { requireOrgId } from '@/lib/tenancy/context';

/** What a failed rewrite says when its process died. */
export const LOST_REWRITE = 'It stopped before finishing.';

/**
 * The error code recovery ends a rewrite with. A process that was not lost
 * after all (its saves failed past the lease) sets it running again, ends it
 * with what really happened, and charges what landed since (`service.ts`).
 */
export const LOST_REWRITE_CODE = 'lost';

export async function recoverRewrites(now: Date = new Date()): Promise<{ failed: number }> {
  const orgId = requireOrgId();
  const lapsed = {
    orgId,
    status: 'RUNNING' as const,
    OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    createdAt: { lt: new Date(now.getTime() - REWRITE_LIFETIME_MS) },
  };
  const rows = await prisma.rewrite.findMany({
    where: lapsed,
    orderBy: { createdAt: 'asc' },
    take: RECOVERY_BATCH,
    select: { id: true, createdAt: true },
  });
  let failed = 0;
  for (const { id, createdAt } of rows) {
    try {
      failed += await prisma.$transaction(async (tx) => {
        const { count } = await tx.rewrite.updateMany({
          where: { ...lapsed, id },
          data: {
            status: 'FAILED',
            error: LOST_REWRITE,
            errorCode: LOST_REWRITE_CODE,
            completedAt: now,
            leaseExpiresAt: null,
          },
        });
        if (count === 0) return 0;
        const ownRows = {
          orgId,
          createdAt: { gte: createdAt },
          metadata: { path: ['rewriteId'], equals: id },
        };
        if ((await tx.aiCostLog.count({ where: ownRows })) === 0) {
          await priceLostCall(tx, orgId, id);
        }
        await chargeRewrite(tx, orgId, id, createdAt);
        // What its rows record, whether or not the workspace was charged for it.
        const { _sum } = await tx.aiCostLog.aggregate({
          where: ownRows,
          _sum: { totalCostUsd: true },
        });
        const costUsd = _sum.totalCostUsd ?? 0;
        if (costUsd > 0) await tx.rewrite.update({ where: { id }, data: { costUsd } });
        return 1;
      });
    } catch (err) {
      // Left for the next pass; the rest of this one goes on.
      logger.error('Recovery could not end a lost rewrite', err, { rewriteId: id });
    }
  }
  return { failed };
}

/**
 * Write the cost row a lost rewrite's call left none of, from what it kept
 * of its call and the draft it saved (`recordStoppedStream`). The row is
 * written outside `tx` (`logCost` has no transaction of its own to join) and
 * read back by its charge inside it. Nothing is written for a rewrite that
 * kept no call (it died before the call's checks passed, or the write
 * failed) or saved no draft.
 */
async function priceLostCall(
  tx: Prisma.TransactionClient,
  orgId: string,
  rewriteId: string
): Promise<void> {
  const row = await tx.rewrite.findFirst({
    where: { id: rewriteId, orgId },
    select: { draft: true, callStart: true, createdByUserId: true },
  });
  const start = parseRewriteCallStart(row?.callStart);
  if (!row || !start || row.draft === '') return;
  const { frameworkVersion, ...pricing } = start;
  const written = await recordStoppedStream(
    pricing,
    row.draft,
    {
      costMetadata: { editor: REWRITE_COST_TAG, rewriteId },
      frameworkVersion,
      userId: row.createdByUserId,
    },
    LOST_REWRITE_CODE
  );
  // The write failed (`logCost` logged why). A row the database refuses (its
  // agent gone, say) would be refused at every pass, so it is ended
  // uncharged rather than left holding budget, and said so.
  if (!written) {
    logger.error('A lost rewrite could not be priced; it is ended uncharged', undefined, {
      rewriteId,
    });
  }
}

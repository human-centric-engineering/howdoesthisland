/**
 * Fail and charge rewrites whose process died (t-81).
 *
 * The maintenance tick runs this once per workspace (`lib/app/jobs.ts`). A
 * rewrite saves and renews its lease every few seconds while its call runs
 * (`service.ts`), so one still `RUNNING` with its lease run out lost its
 * process: nothing will end it but this. It is ended `FAILED`, keeping what
 * it had saved, and charged for its cost rows in the same transaction, which
 * also stops it holding budget. A streamed call writes its cost row only as
 * it ends, so one whose process died part-way through the stream (the
 * platform cut it off, or the server stopped) left none, and is charged
 * nothing, though the provider billed it: see "What it can miss" in
 * `.context/app/rewrites.md`.
 *
 * Idempotent: the write that ends it matches only a `RUNNING` row past its
 * lease, so a second pass, or a call that finished meanwhile, changes nothing.
 *
 * A lease can also run out while the call lives, if its saves fail for that
 * long. Its cost row lands only when it ends, so this charges nothing for it;
 * its next save sets it `RUNNING` again, and it charges itself as it ends.
 */
import { RECOVERY_BATCH } from '@/lib/app/assessments/limits';
import { chargeRewrite } from '@/lib/app/credits/charge';
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
        await chargeRewrite(tx, orgId, id, createdAt);
        // What its rows record, whether or not the workspace was charged for it.
        const { _sum } = await tx.aiCostLog.aggregate({
          where: {
            orgId,
            createdAt: { gte: createdAt },
            metadata: { path: ['rewriteId'], equals: id },
          },
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

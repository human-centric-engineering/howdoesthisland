/**
 * Fail and charge rewrites whose process died (t-81).
 *
 * The maintenance tick runs this once per workspace (`lib/app/jobs.ts`). A
 * rewrite saves and renews its lease every few seconds while its call runs
 * (`service.ts`), so one still `RUNNING` with its lease run out lost its
 * process: nothing will end it but this. It is ended `FAILED`, keeping what
 * it had saved, and charged for its cost rows in the same transaction, which
 * also stops it holding budget. A call that died before the provider
 * answered wrote no cost row, so it is charged nothing.
 *
 * Idempotent: the write that ends it matches only a `RUNNING` row past its
 * lease, so a second pass, or a call that finished meanwhile, changes nothing.
 */
import { RECOVERY_BATCH } from '@/lib/app/assessments/limits';
import { chargeRewrite } from '@/lib/app/credits/charge';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { requireOrgId } from '@/lib/tenancy/context';

/** What a failed rewrite says when its process died. */
export const LOST_REWRITE = 'It stopped before finishing.';

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
            errorCode: 'lost',
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

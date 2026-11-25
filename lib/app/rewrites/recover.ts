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
 * **One that kept its call, only once that call has stopped.** It is left
 * alone until it is {@link REWRITE_LIFETIME_MS} old: its call stops itself
 * before then on any host (`REWRITE_CALL_MS`), writing its own cost row, so
 * no row of its own follows the estimate. One that kept no call has nothing
 * to price and none to wait for, and is ended once its lease runs out.
 *
 * **Claimed, then priced, then ended.** The pass first claims the row (a
 * lease of its own, {@link CLAIM_MS}), so a pass running alongside finds it
 * taken. It then writes the estimate on its own (`logCost` writes outside
 * any transaction, and holding one open while it does would need a second
 * connection), and ends and charges it in one transaction, matching only its
 * own claim. A pass that fails part-way leaves its claim to run out: the
 * next pass finds any estimate it wrote, and charges it without another.
 * Whatever charges a rewrite first leaves it one account of its call
 * ({@link settleRewriteCostRows}), so an estimate that a stalled call's own
 * row, or a second pass's estimate, joined is never counted twice.
 *
 * A lease can also run out while the call lives, if its saves fail for that
 * long. Its next save sets it `RUNNING` again, and it charges itself as it
 * ends.
 */
import type { Prisma } from '@prisma/client';
import { RECOVERY_BATCH } from '@/lib/app/assessments/limits';
import { chargeRewrite } from '@/lib/app/credits/charge';
import { recordStoppedStream } from '@/lib/app/judges/run-judge';
import { parseRewriteCallStart } from '@/lib/app/rewrites/call-start';
import { REWRITE_COST_TAG, REWRITE_LIFETIME_MS } from '@/lib/app/rewrites/limits';
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

/** How long a pass holds a rewrite it is ending: far longer than pricing and ending one takes. */
export const CLAIM_MS = 60_000;

export async function recoverRewrites(now: Date = new Date()): Promise<{ failed: number }> {
  const orgId = requireOrgId();
  const lapsed: Prisma.RewriteWhereInput = {
    orgId,
    status: 'RUNNING',
    OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
  };
  const oldBefore = new Date(now.getTime() - REWRITE_LIFETIME_MS);
  const rows = await prisma.rewrite.findMany({
    where: lapsed,
    orderBy: { createdAt: 'asc' },
    take: RECOVERY_BATCH,
    select: { id: true, createdAt: true, callStart: true },
  });
  let failed = 0;
  for (const { id, createdAt, callStart } of rows) {
    // SQL NULL filtered here, not in the query, as `frameworks/repo.ts` does:
    // the query would need `Prisma.DbNull`, which `lib/app` cannot import.
    const old = createdAt < oldBefore;
    if (callStart !== null && !old) continue;
    try {
      failed += await endLost(orgId, id, createdAt, old, lapsed, now);
    } catch (err) {
      // Left for the next pass once its claim runs out; the rest of this one goes on.
      logger.error('Recovery could not end a lost rewrite', err, { rewriteId: id });
    }
  }
  return { failed };
}

async function endLost(
  orgId: string,
  id: string,
  createdAt: Date,
  old: boolean,
  lapsed: Prisma.RewriteWhereInput,
  now: Date
): Promise<number> {
  const claim = new Date(now.getTime() + CLAIM_MS);
  const { count: claimed } = await prisma.rewrite.updateMany({
    where: { ...lapsed, id },
    data: { leaseExpiresAt: claim },
  });
  if (claimed === 0) return 0;

  const row = await prisma.rewrite.findFirst({
    where: { id, orgId },
    select: { draft: true, callStart: true, createdByUserId: true },
  });
  if (!row) return 0;
  // Its call started since the pass looked, so it may still be running:
  // left for when it is old enough (its claim runs out, or a save renews it).
  if (!old && row.callStart !== null) return 0;

  const ownRows = rewriteCostRows(orgId, id, createdAt);
  if (old && (await prisma.aiCostLog.count({ where: ownRows })) === 0) {
    // A write that may succeed next time: leave the claim to run out.
    if ((await priceLostCall(id, row)) === 'retry') return 0;
  }

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.rewrite.updateMany({
      // Still this pass's: a save from a call that lived after all, or a
      // later pass once this claim ran out, would have changed it.
      where: { id, orgId, status: 'RUNNING', leaseExpiresAt: claim },
      data: {
        status: 'FAILED',
        error: LOST_REWRITE,
        errorCode: LOST_REWRITE_CODE,
        completedAt: now,
        leaseExpiresAt: null,
      },
    });
    if (count === 0) return 0;
    await settleRewriteCostRows(tx, orgId, id, createdAt);
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
}

/** A rewrite's cost rows: those tagged with it since it was made. */
function rewriteCostRows(orgId: string, rewriteId: string, since: Date) {
  return {
    orgId,
    createdAt: { gte: since },
    metadata: { path: ['rewriteId'], equals: rewriteId },
  } satisfies Prisma.AiCostLogWhereInput;
}

/** Whether a cost row's metadata is recovery's estimate ({@link priceLostCall}). */
function isRecoveryEstimate(metadata: Prisma.JsonValue): boolean {
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    metadata.estimated === true &&
    metadata.error === LOST_REWRITE_CODE
  );
}

/**
 * Leave a rewrite at most one account of its call, before it is charged
 * (t-85): call it in the transaction that charges it, here and as its call
 * ends (`service.ts`). Recovery's estimate stands in for the row a call
 * that died never wrote. Should the call's own row land as well (a process
 * that stalled past {@link REWRITE_LIFETIME_MS} and then recovered), the
 * estimate is removed, so neither the charge nor the monthly cap counts the
 * call twice; should two passes each have written one, the later goes.
 * A rewrite already charged at the estimate stays charged at it (one
 * reference): low, never high.
 */
export async function settleRewriteCostRows(
  tx: Prisma.TransactionClient,
  orgId: string,
  rewriteId: string,
  since: Date
): Promise<void> {
  const rows = await tx.aiCostLog.findMany({
    where: rewriteCostRows(orgId, rewriteId, since),
    orderBy: { createdAt: 'asc' },
    select: { id: true, metadata: true },
  });
  const estimates = rows.filter((r) => isRecoveryEstimate(r.metadata));
  const ownCount = rows.length - estimates.length;
  const extra = ownCount > 0 ? estimates : estimates.slice(1);
  if (extra.length === 0) return;
  await tx.aiCostLog.deleteMany({ where: { orgId, id: { in: extra.map((r) => r.id) } } });
  logger.warn('A rewrite had more than one account of its call; the extra estimates are removed', {
    rewriteId,
    removed: extra.length,
  });
}

/**
 * Write the cost row a lost rewrite's call left none of, from what it kept
 * of its call and the draft it saved (`recordStoppedStream`). Nothing is
 * written for a rewrite that saved no draft, or kept no call it can read
 * (it died before the call's checks passed, or the write failed): the
 * second is logged, since the provider may have billed it.
 *
 * Answers `retry` when the write failed for a reason that may pass (the
 * database, the network), so the pass leaves the rewrite to the next
 * rather than ending it uncharged. A write refused because the agent it
 * names is gone would be refused at every pass: that one is ended uncharged.
 */
async function priceLostCall(
  rewriteId: string,
  row: { draft: string; callStart: unknown; createdByUserId: string | null }
): Promise<'done' | 'retry'> {
  if (row.draft === '') return 'done';
  const start = parseRewriteCallStart(row.callStart);
  if (!start) {
    logger.warn('A lost rewrite answered but kept no call to price; it is ended uncharged', {
      rewriteId,
    });
    return 'done';
  }
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
  if (written) return 'done';
  // The write failed (`logCost` logged why).
  if ((await prisma.aiAgent.count({ where: { id: pricing.agentId } })) > 0) {
    logger.warn('A lost rewrite could not be priced; left for the next pass', { rewriteId });
    return 'retry';
  }
  logger.error('A lost rewrite could not be priced; it is ended uncharged', undefined, {
    rewriteId,
    reason: 'agent_gone',
  });
  return 'done';
}

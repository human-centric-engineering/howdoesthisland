/**
 * Re-drive stalled assessments in the current workspace (t-22, app-plan §8.2).
 *
 * The maintenance tick runs this once per workspace (`lib/app/jobs.ts`). A
 * stalled assessment is `QUEUED` or `RUNNING` with no live lease: its run's
 * process died, it was queued while the workspace was at its limit, or its
 * `after()` never ran. Each is either:
 *
 * - **given up on**, once it has had {@link MAX_ATTEMPTS} runs: `FAILED`, with
 *   the reason; or
 * - **re-driven**: claimed under a new lease (`beginAssessment`), which runs
 *   only the judges that have no row yet.
 *
 * It also **charges** (t-58) what the workspace has not been charged for: a
 * review given up on, in the write that gives up on it, and a cancelled review
 * whose run died before its last write, its lease run out (`CANCELLED` with a
 * lease set and past). Clearing that lease and charging are one transaction,
 * so the review is charged once and the next pass skips it. Only those
 * cancelled within {@link CHARGE_SWEEP_MS}: older ones predate the charge.
 * And a `store: false` run left uncharged (its charge failed, or its process
 * died), once its rows have been quiet for an hour (`CANCEL_GRACE_MS`)
 * (`chargeLapsedEphemeralRuns`). At most {@link RECOVERY_BATCH} of each kind
 * per tick; the next tick takes the rest.
 *
 * Claims are taken one at a time, so they never conflict with each other on
 * the workspace's running count. The pass does not wait for the runs it
 * starts: per-org jobs run one workspace after another, and a long run here
 * would hold up every other workspace's pass. Each run is handed to
 * `keepRunningAfterResponse`, which keeps the tick's invocation alive until it
 * settles; a run killed part-way leaves a lease that runs out, and a later
 * tick takes it over, at the cost of an attempt.
 *
 * Idempotent: a second pass over the same rows finds them final, or held by
 * the first pass's live lease, and changes nothing.
 */
import { keepRunningAfterResponse } from '@/lib/api/after-response';
import { CHARGE_SWEEP_MS, MAX_ATTEMPTS, RECOVERY_BATCH } from '@/lib/app/assessments/limits';
import { chargeEndedReview, chargeLapsedEphemeralRuns } from '@/lib/app/credits/charge';
import { beginAssessment } from '@/lib/app/assessments/run';
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';

export interface RecoveryResult {
  /** Runs this pass claimed and started. */
  redriven: number;
  /** Assessments marked `FAILED` after their last attempt. */
  gaveUp: number;
  /** Cancelled assessments whose run died, now charged. */
  chargedCancelled: number;
  /** `store: false` runs left uncharged, now charged. */
  chargedEphemeral: number;
}

export async function recoverAssessments(now: Date = new Date()): Promise<RecoveryResult> {
  const orgId = requireOrgId();
  const stalled = {
    orgId,
    status: { in: ['QUEUED' as const, 'RUNNING' as const] },
    OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
  };

  // Only a run whose process died each time gets here: one that stopped on
  // an error fails itself on its last attempt, with its reason. One at a
  // time, so each is charged in the write that ends it.
  const spent = await prisma.assessment.findMany({
    where: { ...stalled, attempts: { gte: MAX_ATTEMPTS } },
    select: { id: true },
    take: RECOVERY_BATCH,
  });
  let gaveUp = 0;
  for (const { id } of spent) {
    gaveUp += await prisma.$transaction(async (tx) => {
      const { count } = await tx.assessment.updateMany({
        where: { ...stalled, id, attempts: { gte: MAX_ATTEMPTS } },
        data: {
          status: 'FAILED',
          error: `It stopped before finishing ${MAX_ATTEMPTS} times.`,
          completedAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      if (count === 1) await chargeEndedReview(tx, id);
      return count;
    });
  }

  // Cancelled reviews whose run died before its last write (`freePlace`).
  const lapsed = {
    orgId,
    status: 'CANCELLED' as const,
    leaseExpiresAt: { not: null, lte: now },
    completedAt: { gt: new Date(now.getTime() - CHARGE_SWEEP_MS) },
  };
  const cancelled = await prisma.assessment.findMany({
    where: lapsed,
    select: { id: true },
    take: RECOVERY_BATCH,
  });
  let chargedCancelled = 0;
  for (const { id } of cancelled) {
    chargedCancelled += await prisma.$transaction(async (tx) => {
      const { count } = await tx.assessment.updateMany({
        where: { ...lapsed, id },
        data: { leaseExpiresAt: null },
      });
      if (count === 1) await chargeEndedReview(tx, id);
      return count;
    });
  }

  // `store: false` runs whose own charge never landed (`service.ts`).
  const chargedEphemeral = await chargeLapsedEphemeralRuns(orgId, now, RECOVERY_BATCH);

  // Places whose `store: false` run's process died (`places.ts`): never
  // counted, but only a later take in this workspace would clear them.
  await prisma.assessmentPlace.deleteMany({ where: { orgId, leaseExpiresAt: { lte: now } } });

  const candidates = await prisma.assessment.findMany({
    where: { ...stalled, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: RECOVERY_BATCH,
    select: { id: true },
  });
  let redriven = 0;
  for (const { id } of candidates) {
    const run = await beginAssessment(id);
    if (!run) continue;
    redriven += 1;
    keepRunningAfterResponse(run.done, 'app: assessment re-drive', { assessmentId: id });
  }

  return { redriven, gaveUp, chargedCancelled, chargedEphemeral };
}

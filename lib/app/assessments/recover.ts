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
import { MAX_ATTEMPTS, RECOVERY_BATCH } from '@/lib/app/assessments/limits';
import { beginAssessment } from '@/lib/app/assessments/run';
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';

export interface RecoveryResult {
  /** Runs this pass claimed and started. */
  redriven: number;
  /** Assessments marked `FAILED` after their last attempt. */
  gaveUp: number;
}

export async function recoverAssessments(now: Date = new Date()): Promise<RecoveryResult> {
  const orgId = requireOrgId();
  const stalled = {
    orgId,
    status: { in: ['QUEUED' as const, 'RUNNING' as const] },
    OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
  };

  const { count: gaveUp } = await prisma.assessment.updateMany({
    where: { ...stalled, attempts: { gte: MAX_ATTEMPTS } },
    data: {
      status: 'FAILED',
      error: `It stopped before finishing ${MAX_ATTEMPTS} times.`,
      completedAt: now,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });

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

  return { redriven, gaveUp };
}

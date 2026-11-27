/**
 * Tell a workspace's subscriptions that its work has finished (t-99,
 * `.context/app/webhooks.md`).
 *
 * **An outbox, not a fire-and-forget emit.** A review's row carries
 * `notifiedAt`, and so does a comparison's. When a review ends, the code that
 * ended it calls {@link notifyAfterReview}: that queues the event through
 * core's `emitHookEventDurably`, which resolves once every matching
 * subscription's delivery row is written, and only then stamps `notifiedAt`.
 * From that row on, core sends and retries the delivery itself. If the
 * process dies before the stamp, {@link sweepFinishedEvents} (the recovery
 * tick) sends the event later. So an event is never lost between a review
 * ending and the send. Before this, a caller waiting on its event waited for
 * ever.
 *
 * **At least once.** Two starters (the end of a run and the sweep, or the
 * last two drafts of a comparison ending together) can both send before
 * either stamps. Each event carries a stable `eventId` (`assessment:<id>`,
 * `comparison:<id>`) so a receiver can drop a repeat, as core's own retries
 * already require of it.
 *
 * **What a payload says.** Ids, the state, and scores and bands, nothing
 * else: no text, no titles or draft labels, no user ids. A delivery row
 * outlives the review it is about (core keeps it as the record of the send),
 * so it must hold nothing the review's deletion or a person's erasure would
 * have to reach. A caller reads the rest from the API by id.
 *
 * Each function runs in the workspace's tenant context (a request's guard, a
 * run inside `runAsOrg`, or the per-org tick): core refuses a hook emit with
 * no org, and the queries name the org too.
 */
import type { AssessmentStatus } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { keepRunningAfterResponse } from '@/lib/api/after-response';
import { emitHookEventDurably } from '@/lib/orchestration/hooks/registry';
import { requireOrgId } from '@/lib/tenancy/context';
import { stateOf } from '@/lib/app/assessments/api/views';
import { readComparison } from '@/lib/app/comparisons/views';
import { ASSESSMENT_FINISHED, COMPARISON_FINISHED } from '@/lib/app/events/types';

/** The states a review cannot leave. */
const FINAL_STATUSES: AssessmentStatus[] = ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'];

/** The verdict states a comparison's verdict cannot leave. */
const SETTLED_VERDICTS = new Set(['completed', 'failed', 'skipped']);

/**
 * How long the sweep leaves a row that just ended, so it does not race the
 * send its own run is making. A run's send takes well under this.
 */
export const SWEEP_GRACE_MS = 2 * 60 * 1000;

/** Rows of each kind the sweep sends per workspace per pass. */
export const SWEEP_BATCH = 50;

/**
 * Send the review's finished event, if it is final and not yet sent. Answers
 * whether this call sent it. Rejects when the event could not be queued,
 * leaving `notifiedAt` unset for the sweep.
 */
export async function sendAssessmentFinished(assessmentId: string): Promise<boolean> {
  const orgId = requireOrgId();
  const row = await prisma.assessment.findFirst({
    where: { id: assessmentId, orgId, notifiedAt: null, status: { in: FINAL_STATUSES } },
    select: {
      id: true,
      status: true,
      overall: true,
      band: true,
      projectId: true,
      completedAt: true,
    },
  });
  if (!row) return false;
  await emitHookEventDurably(ASSESSMENT_FINISHED, {
    eventId: `assessment:${row.id}`,
    assessmentId: row.id,
    status: stateOf(row.status),
    overall: row.overall,
    band: row.band,
    projectId: row.projectId,
    completedAt: row.completedAt?.toISOString() ?? null,
  });
  await prisma.assessment.updateMany({
    where: { id: row.id, orgId, notifiedAt: null },
    data: { notifiedAt: new Date() },
  });
  return true;
}

/**
 * Send the comparison's finished event, if every draft is final, its verdict
 * has settled, and it is not yet sent. Answers whether this call sent it.
 * Rejects when the event could not be queued, leaving `notifiedAt` unset.
 */
export async function sendComparisonFinished(setId: string): Promise<boolean> {
  const orgId = requireOrgId();
  const pending = await prisma.assessmentSet.count({
    where: { id: setId, orgId, kind: 'COMPARISON', notifiedAt: null },
  });
  if (pending === 0) return false;
  const comparison = await readComparison(setId);
  if (!comparison) return false;
  if (comparison.status === 'running' || !SETTLED_VERDICTS.has(comparison.verdict.status)) {
    return false;
  }
  await emitHookEventDurably(COMPARISON_FINISHED, {
    eventId: `comparison:${comparison.id}`,
    comparisonId: comparison.id,
    status: comparison.status,
    projectId: comparison.projectId,
    verdict: { status: comparison.verdict.status, draft: comparison.verdict.draft },
    drafts: comparison.drafts.map((d) => ({
      position: d.position,
      assessmentId: d.assessmentId,
      status: d.status,
      overall: d.overall,
      band: d.band,
    })),
  });
  await prisma.assessmentSet.updateMany({
    where: { id: comparison.id, orgId, notifiedAt: null },
    data: { notifiedAt: new Date() },
  });
  return true;
}

/**
 * A review has just ended (or been cancelled): send its event, then those of
 * the comparisons it was the last unfinished draft of, after the response.
 * A comparison whose verdict is still to come is sent when the verdict ends
 * ({@link notifyAfterVerdict}). Never throws: a failure is left for the sweep.
 */
export function notifyAfterReview(orgId: string, assessmentId: string): void {
  keepRunningAfterResponse(
    async () => {
      try {
        await sendAssessmentFinished(assessmentId);
      } catch (err) {
        logger.warn('A finished review’s event was not queued; the sweep will send it', {
          assessmentId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const sets = await prisma.assessmentSetMember.findMany({
        where: { orgId, assessmentId, set: { notifiedAt: null } },
        select: { setId: true },
      });
      for (const { setId } of sets) await notifySet(setId);
    },
    'app: finished events',
    { assessmentId }
  );
}

/** A comparison's verdict has just ended: send its event, after the response. Never throws. */
export function notifyAfterVerdict(setId: string): void {
  keepRunningAfterResponse(() => notifySet(setId), 'app: finished events', { setId });
}

async function notifySet(setId: string): Promise<void> {
  try {
    await sendComparisonFinished(setId);
  } catch (err) {
    logger.warn('A finished comparison’s event was not queued; the sweep will send it', {
      setId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Send the events the workspace's finished work is still owed, at most
 * {@link SWEEP_BATCH} of each kind: the recovery tick's backstop for a send
 * lost with its process, and for work that ended where nothing notifies (the
 * recovery job giving up on a review). Rows that ended before events existed
 * were stamped by their migration, so history is never sent.
 */
export async function sweepFinishedEvents(
  now: Date = new Date()
): Promise<{ assessments: number; comparisons: number; failed: number }> {
  const orgId = requireOrgId();
  const before = new Date(now.getTime() - SWEEP_GRACE_MS);
  let failed = 0;

  const reviews = await prisma.assessment.findMany({
    where: {
      orgId,
      notifiedAt: null,
      status: { in: FINAL_STATUSES },
      updatedAt: { lt: before },
    },
    orderBy: { updatedAt: 'asc' },
    take: SWEEP_BATCH,
    select: { id: true },
  });
  let assessments = 0;
  for (const { id } of reviews) {
    try {
      if (await sendAssessmentFinished(id)) assessments += 1;
    } catch (err) {
      failed += 1;
      logger.warn('The sweep could not queue a finished review’s event', {
        assessmentId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const sets = await prisma.assessmentSet.findMany({
    where: {
      orgId,
      kind: 'COMPARISON',
      notifiedAt: null,
      verdictStatus: { in: ['COMPLETED', 'FAILED', 'SKIPPED'] },
      updatedAt: { lt: before },
    },
    orderBy: { updatedAt: 'asc' },
    take: SWEEP_BATCH,
    select: { id: true },
  });
  let comparisons = 0;
  for (const { id } of sets) {
    try {
      if (await sendComparisonFinished(id)) comparisons += 1;
    } catch (err) {
      failed += 1;
      logger.warn('The sweep could not queue a finished comparison’s event', {
        setId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { assessments, comparisons, failed };
}

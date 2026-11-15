/**
 * An assessment's progress as events, read from its rows (t-24, §8.2).
 *
 * The run may be in another request's `after()`, on another instance, or in
 * the recovery job, so nothing is passed in memory: this polls the
 * assessment and its judge runs every {@link POLL_MS}, yields an event for
 * each change, and ends at a final state. A stream opened late still sees
 * every judge that had landed, as its first events.
 *
 * Events (each is the SSE `event:` name and the `data:` payload's `type`):
 *
 * - `assessment_status` — first, the state the stream found; then each change,
 *   after the judges that brought it about.
 * - `assessment_judge` — a judge landed, or landed again on a re-drive.
 * - `assessment_done` — the run is final; the stream ends after it.
 * - `assessment_gone` — the assessment was deleted; the stream ends.
 * - `assessment_timeout` — still going after {@link EVENTS_MAX_MS}; the
 *   stream ends, and a client opens it again to carry on.
 */
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import { EVENTS_MAX_MS, POLL_MS } from '@/lib/app/assessments/limits';
import type { AssessmentState } from '@/lib/app/assessments/api/validations';
import { isFinal, judgeRunView, stateOf, type JudgeRunView } from '@/lib/app/assessments/api/views';

export type AssessmentEvent =
  | { type: 'assessment_status'; id: string; status: AssessmentState }
  | ({ type: 'assessment_judge'; id: string } & JudgeRunView)
  | {
      type: 'assessment_done';
      id: string;
      status: AssessmentState;
      overall: number | null;
      band: string | null;
      costUsd: number;
      error: string | null;
    }
  | { type: 'assessment_gone'; id: string }
  | { type: 'assessment_timeout'; id: string };

export interface EventOptions {
  signal?: AbortSignal;
  pollMs?: number;
  maxMs?: number;
}

/** Resolves after `ms`, or at once when `signal` aborts. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * The events of one of this workspace's assessments. The caller has checked
 * it exists; one deleted since ends the stream with `assessment_gone`.
 */
export function assessmentEvents(
  id: string,
  options: EventOptions = {}
): AsyncGenerator<AssessmentEvent> {
  // Read here, in the request's tenant context. A generator's body runs only
  // when the stream first pulls it, so the org is not read there.
  return pollEvents(id, requireOrgId(), options);
}

async function* pollEvents(
  id: string,
  orgId: string,
  options: EventOptions
): AsyncGenerator<AssessmentEvent> {
  const pollMs = options.pollMs ?? POLL_MS;
  const deadline = Date.now() + (options.maxMs ?? EVENTS_MAX_MS);
  let lastState: AssessmentState | null = null;
  // Each judge's row as last sent, by when it was written.
  const sent = new Map<string, number>();

  while (!options.signal?.aborted) {
    const row = await prisma.assessment.findUnique({
      where: { id, orgId },
      select: {
        status: true,
        overall: true,
        band: true,
        costUsd: true,
        error: true,
        judges: true,
        judgeRuns: {
          select: {
            judge: true,
            status: true,
            modelName: true,
            costUsd: true,
            latencyMs: true,
            errorCode: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!row) {
      yield { type: 'assessment_gone', id };
      return;
    }
    const state = stateOf(row.status);
    // The first event is the state the stream found. After that, the judges
    // that landed come before the state they brought about: a final judge and
    // the final state are often read in the same poll.
    if (lastState === null) {
      lastState = state;
      yield { type: 'assessment_status', id, status: state };
    }
    const order = new Map(row.judges.map((slot, i) => [slot, i]));
    const runs = [...row.judgeRuns].sort(
      (a, b) => (order.get(a.judge) ?? 0) - (order.get(b.judge) ?? 0)
    );
    for (const run of runs) {
      const written = run.updatedAt.getTime();
      if (sent.get(run.judge) === written) continue;
      sent.set(run.judge, written);
      yield { type: 'assessment_judge', id, ...judgeRunView(run) };
    }
    if (state !== lastState) {
      lastState = state;
      yield { type: 'assessment_status', id, status: state };
    }
    if (isFinal(state)) {
      yield {
        type: 'assessment_done',
        id,
        status: state,
        overall: row.overall,
        band: row.band,
        costUsd: row.costUsd,
        error: row.error,
      };
      return;
    }
    if (Date.now() >= deadline) {
      yield { type: 'assessment_timeout', id };
      return;
    }
    await pause(pollMs, options.signal);
  }
}

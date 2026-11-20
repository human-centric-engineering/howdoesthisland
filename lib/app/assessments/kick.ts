/**
 * Start the workspace's waiting stored reviews now, rather than at the
 * recovery job's next tick (t-28).
 *
 * A `store: false` request is refused while stored reviews wait for the
 * workspace's places (`places.ts`), so they are not starved. When it is
 * refused only because they wait, with places free, their own start was lost
 * (an `after()` that never ran, a claim that lost its conflicts, a process
 * that died), and the route calls this so they do not hold the places, and
 * refuse every `store: false` request, until the tick 15 minutes away.
 *
 * It runs the recovery pass itself (`recoverAssessments`), which starts
 * stalled `RUNNING` runs as well as `QUEUED` ones and gives up on those out
 * of attempts. **At most once per {@link KICK_INTERVAL_MS} per workspace, per
 * instance**, so a client retrying a busy workspace does not start a pass per
 * request, and a review requeued after an error is re-driven at most that
 * often rather than on every refusal: its attempts are not spent in seconds.
 */
import { keepRunningAfterResponse } from '@/lib/api/after-response';
import { recoverAssessments } from '@/lib/app/assessments/recover';

/** The shortest gap between two kicks for one workspace on one instance. */
export const KICK_INTERVAL_MS = 60_000;

const lastKick = new Map<string, number>();

/** Run the workspace's recovery pass after the response, unless one ran within the interval. */
export function startWaitingReviews(orgId: string, now: number = Date.now()): boolean {
  const last = lastKick.get(orgId);
  if (last !== undefined && now - last < KICK_INTERVAL_MS) return false;
  lastKick.set(orgId, now);
  keepRunningAfterResponse(() => recoverAssessments(), 'app: start waiting reviews', { orgId });
  return true;
}

/** Forget every kick, for tests. */
export function resetKicksForTests(): void {
  lastKick.clear();
}

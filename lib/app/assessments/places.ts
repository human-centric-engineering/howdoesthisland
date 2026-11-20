/**
 * The workspace's running places, shared by stored runs and runs kept nowhere
 * (t-28, app-plan §8.2).
 *
 * A workspace runs at most {@link RUNNING_PER_WORKSPACE} assessments at once,
 * so at most that many × `JUDGES_IN_FLIGHT` model calls. A stored run holds
 * its place as its own `Assessment` row (`RUNNING`, or `CANCELLED` while its
 * judges in flight land, under a live lease). A `store: false` run has no row,
 * so it holds an `AssessmentPlace` instead. {@link liveRunsIn} counts both,
 * and both the stored claim (`run.ts`) and {@link takePlace} make that count
 * and their write in one serializable transaction, so two claimers of either
 * kind cannot both take the last place.
 *
 * **Queued stored reviews come first.** A `store: false` take also counts the
 * workspace's queued stored reviews as taken, so it never wins a freed place
 * from the queue. A stored claim does not count them: it is the queue.
 *
 * **Full:** {@link takePlace} throws {@link WorkspaceBusyError}, and the API
 * answers 429 `WORKSPACE_BUSY` with `Retry-After`. The request is not held
 * open to wait (owner ruling at planning, 2026-11-20). A caller who wants to
 * queue sends a stored review, which does.
 *
 * **Release:** {@link withPlace} deletes the place however the run ends, then
 * starts the workspace's oldest queued stored review, which a full workspace
 * may have left waiting. A place whose process died stops being renewed and is
 * free once its lease runs out; the next take deletes it, before its own
 * transaction, and so does the recovery pass.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { isSerializableConflict } from '@/lib/db/serializable-conflict';
import { logger } from '@/lib/logging';
import {
  LEASE_MS,
  LEASE_RENEW_MS,
  MAX_ATTEMPTS,
  PLACE_RETRY_AFTER_SECONDS,
  RUNNING_PER_WORKSPACE,
} from '@/lib/app/assessments/limits';

/** What a workspace's places were held by when a run was refused. */
export interface PlaceCounts {
  /** Runs holding a place: stored runs under a live lease, and live places. */
  running: number;
  /** Stored reviews waiting for one: queued, or stalled for the recovery job. */
  waiting: number;
}

/** The workspace has no free place for another run, or one could not be taken. */
export class WorkspaceBusyError extends Error {
  /** `null` when the take gave up on conflicts and never counted. */
  readonly counts: PlaceCounts | null;
  readonly retryAfterSeconds = PLACE_RETRY_AFTER_SECONDS;

  constructor(counts: PlaceCounts | null) {
    super(
      counts === null
        ? 'A place to run this review could not be taken. Try again shortly, or send a stored review, which queues.'
        : `The workspace has ${counts.running} reviews running and ${counts.waiting} waiting; it runs at most ${RUNNING_PER_WORKSPACE} at once. Try again shortly, or send a stored review, which queues.`
    );
    this.name = 'WorkspaceBusyError';
    this.counts = counts;
  }

  /**
   * Refused only because stored reviews are waiting, with places free: the
   * caller should start them (`startWaitingReviews` in `kick.ts`), since a waiting review
   * whose own start was lost would otherwise hold the places until the
   * recovery job's next tick.
   */
  get queueCanStart(): boolean {
    return (
      this.counts !== null && this.counts.waiting > 0 && this.counts.running < RUNNING_PER_WORKSPACE
    );
  }
}

/**
 * Runs holding a place in the workspace at `now`: stored runs under a live
 * lease, other than `exceptAssessmentId` (the one being claimed), and live
 * places. Call it inside the serializable transaction that takes a place.
 */
export async function liveRunsIn(
  tx: Prisma.TransactionClient,
  orgId: string,
  now: Date,
  exceptAssessmentId?: string
): Promise<number> {
  const [stored, ephemeral] = await Promise.all([
    tx.assessment.count({
      where: {
        orgId,
        // A cancelled run holds its place until its judges in flight land.
        status: { in: ['RUNNING', 'CANCELLED'] },
        leaseExpiresAt: { gt: now },
        ...(exceptAssessmentId ? { id: { not: exceptAssessmentId } } : {}),
      },
    }),
    tx.assessmentPlace.count({ where: { orgId, leaseExpiresAt: { gt: now } } }),
  ]);
  return stored + ephemeral;
}

/**
 * Stored reviews waiting for a place, with attempts left: `QUEUED`, or
 * `RUNNING` with no live lease (its process died; the recovery job re-drives
 * it), the recovery job's own "stalled". A run kept nowhere counts them as
 * taken, so a freed place goes to them rather than to the next `store: false`
 * request, which would otherwise win it every time under steady traffic.
 */
function waitingIn(tx: Prisma.TransactionClient, orgId: string, now: Date): Promise<number> {
  return tx.assessment.count({
    where: {
      orgId,
      status: { in: ['QUEUED', 'RUNNING'] },
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
  });
}

/** What holds or waits for the workspace's places, against which a `store: false` run is refused. */
async function countsFor(
  tx: Prisma.TransactionClient,
  orgId: string,
  now: Date
): Promise<PlaceCounts> {
  const [running, waiting] = await Promise.all([
    liveRunsIn(tx, orgId, now),
    waitingIn(tx, orgId, now),
  ]);
  return { running, waiting };
}

const isFull = ({ running, waiting }: PlaceCounts) => running + waiting >= RUNNING_PER_WORKSPACE;

/**
 * Refuse with {@link WorkspaceBusyError} when the workspace has no place for
 * a `store: false` run, outside any transaction. The route asks before it
 * charges the per-user cap, so a request refused for a full workspace does
 * not spend the caller's allowance. A place freed or taken between this and
 * {@link takePlace} is settled there.
 */
export async function assertPlaceFree(orgId: string): Promise<void> {
  const counts = await countsFor(prisma, orgId, new Date());
  if (isFull(counts)) throw new WorkspaceBusyError(counts);
}

/** Serializable conflicts a take retries before it gives up. */
const TAKE_TRIES = 5;

type Taken = { id: string } | { full: PlaceCounts };

async function takeOnce(orgId: string): Promise<Taken> {
  const now = new Date();
  return await prisma.$transaction(
    async (tx) => {
      const counts = await countsFor(tx, orgId, now);
      if (isFull(counts)) return { full: counts };
      const place = await tx.assessmentPlace.create({
        data: { orgId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
        select: { id: true },
      });
      return { id: place.id };
    },
    { isolationLevel: 'Serializable' }
  );
}

/** A place taken by {@link takePlace}. */
export interface Place {
  readonly id: string;
  /** Stop renewing and delete it. Never throws. */
  release: () => Promise<void>;
}

/**
 * Take one of the workspace's places, renewed every {@link LEASE_RENEW_MS}
 * until released. Throws {@link WorkspaceBusyError} when there is none. A
 * claimer that keeps losing serializable conflicts is refused the same way,
 * with no count, since it never got one: every conflict is another claimer
 * taking or giving up a place, so the workspace is at its limit or close.
 */
export async function takePlace(orgId: string): Promise<Place> {
  // Places whose process died: free already, since every count skips them,
  // and nothing else removes them. Outside the take's transaction, so
  // concurrent takers do not conflict on it.
  await prisma.assessmentPlace.deleteMany({
    where: { orgId, leaseExpiresAt: { lte: new Date() } },
  });
  let taken: Taken | null = null;
  for (let tries = 1; tries <= TAKE_TRIES; tries += 1) {
    try {
      taken = await takeOnce(orgId);
      break;
    } catch (err) {
      if (!isSerializableConflict(err)) throw err;
      if (tries === TAKE_TRIES) break;
      // A jittered pause, so claimers that conflicted do not retry in step.
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 50 * tries));
    }
  }
  if (!taken) throw new WorkspaceBusyError(null);
  if ('full' in taken) throw new WorkspaceBusyError(taken.full);
  const { id } = taken;

  const timer = setInterval(() => {
    prisma.assessmentPlace
      .updateMany({ where: { id }, data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } })
      .then(({ count }) => {
        // Gone: its lease ran out (renewals failed for longer than it) and a
        // later take cleared it. The run carries on uncounted until it ends,
        // one over the cap; say so, and stop renewing nothing.
        if (count === 0) {
          clearInterval(timer);
          logger.warn('Assessment place lost before its run ended', { placeId: id, orgId });
        }
      })
      .catch((err: unknown) => {
        // Not fatal by itself: the lease has a minute left, and the next
        // renewal may succeed. If none does, the place is freed early, which
        // lets one more run start: the cap is briefly loose, never stuck.
        logger.warn('Assessment place renewal failed', {
          placeId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, LEASE_RENEW_MS);
  timer.unref?.();

  return {
    id,
    release: async () => {
      clearInterval(timer);
      try {
        await prisma.assessmentPlace.deleteMany({ where: { id } });
      } catch (err) {
        // The lease runs out on its own; until then the place stays taken.
        logger.warn('Assessment place release failed', {
          placeId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

/**
 * Run `fn` holding one of the workspace's places, released however it ends.
 * `onReleased` runs once the place is free: the caller starts the next queued
 * stored run there (`startNextQueued` in `run.ts`), which a full workspace may
 * have left waiting.
 */
export async function withPlace<T>(
  orgId: string,
  fn: () => Promise<T>,
  onReleased: () => void
): Promise<T> {
  const place = await takePlace(orgId);
  try {
    return await fn();
  } finally {
    await place.release();
    onReleased();
  }
}

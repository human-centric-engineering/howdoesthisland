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
 * **Full:** {@link takePlace} throws {@link WorkspaceBusyError}, and the API
 * answers 429 `WORKSPACE_BUSY` with `Retry-After`. The request is not held
 * open to wait (owner ruling at planning, 2026-11-20). A caller who wants to
 * queue sends a stored review, which does.
 *
 * **Release:** {@link withPlace} deletes the place however the run ends, then
 * starts the workspace's oldest queued stored review, which a full workspace
 * may have left waiting. A place whose process died stops being renewed and is
 * free once its lease runs out; the next take deletes it.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { isSerializableConflict } from '@/lib/db/serializable-conflict';
import { logger } from '@/lib/logging';
import {
  LEASE_MS,
  LEASE_RENEW_MS,
  PLACE_RETRY_AFTER_SECONDS,
  RUNNING_PER_WORKSPACE,
} from '@/lib/app/assessments/limits';

/** The workspace has no free place for another run. */
export class WorkspaceBusyError extends Error {
  /** Runs holding a place when it was refused. */
  readonly running: number;
  readonly retryAfterSeconds = PLACE_RETRY_AFTER_SECONDS;

  constructor(running: number) {
    super(
      `The workspace already has ${running} reviews running, its limit. Try again shortly, or send a stored review, which queues.`
    );
    this.name = 'WorkspaceBusyError';
    this.running = running;
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

/** Serializable conflicts a take retries before it gives up. */
const TAKE_TRIES = 5;

type Taken = { id: string } | { full: number };

async function takeOnce(orgId: string): Promise<Taken> {
  const now = new Date();
  return await prisma.$transaction(
    async (tx) => {
      const running = await liveRunsIn(tx, orgId, now);
      if (running >= RUNNING_PER_WORKSPACE) return { full: running };
      // Places whose process died: free already, and nothing else removes them.
      await tx.assessmentPlace.deleteMany({ where: { orgId, leaseExpiresAt: { lte: now } } });
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
 * claimer that keeps losing serializable conflicts is refused the same way:
 * every conflict is another claimer taking or giving up a place, so the
 * workspace is at its limit or close to it.
 */
export async function takePlace(orgId: string): Promise<Place> {
  let taken: Taken = { full: RUNNING_PER_WORKSPACE };
  for (let tries = 1; tries <= TAKE_TRIES; tries += 1) {
    try {
      taken = await takeOnce(orgId);
      break;
    } catch (err) {
      if (!isSerializableConflict(err)) throw err;
      // A jittered pause, so claimers that conflicted do not retry in step.
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 50 * tries));
    }
  }
  if ('full' in taken) throw new WorkspaceBusyError(taken.full);
  const { id } = taken;

  const timer = setInterval(() => {
    prisma.assessmentPlace
      .updateMany({ where: { id }, data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } })
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

/**
 * Tests: the workspace's running places (t-28) — takePlace's lease, its
 * release, its retries, and withPlace.
 *
 * Mocked: Prisma (the job's stateful fake, `fake-db.ts`), the logger. Real:
 * the place logic and its timers (faked per test where the lease is the
 * subject). The route-level behaviour (a full workspace refused, shared with
 * stored runs, not starving them) is in
 * `tests/unit/app/api/v1/assessments/routes.test.ts`.
 *
 * @see lib/app/assessments/places.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { createFakeDb, type FakeDb } from '@/tests/unit/lib/app/assessments/fake-db';

let fake: FakeDb;
vi.mock('@/lib/db/client', () => ({
  get prisma() {
    return fake.db;
  },
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  LEASE_MS,
  LEASE_RENEW_MS,
  PLACE_RETRY_AFTER_SECONDS,
  RUNNING_PER_WORKSPACE,
} from '@/lib/app/assessments/limits';
import {
  assertPlaceFree,
  takePlace,
  withPlace,
  WorkspaceBusyError,
} from '@/lib/app/assessments/places';
import { logger } from '@/lib/logging';

const ORG = 'org-a';

const conflict = () =>
  new Prisma.PrismaClientKnownRequestError('could not serialize', {
    code: 'P2034',
    clientVersion: 'test',
  });

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeDb();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('takePlace', () => {
  it('writes a place leased LEASE_MS ahead, renews it while held, and deletes it on release', async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const place = await takePlace(ORG);
    expect(fake.places).toEqual([
      expect.objectContaining({
        id: place.id,
        orgId: ORG,
        leaseExpiresAt: new Date(start + LEASE_MS),
      }),
    ]);

    await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
    const renewed = fake.places[0]?.leaseExpiresAt as Date;
    expect(renewed.getTime()).toBe(start + LEASE_RENEW_MS + LEASE_MS);

    await place.release();
    expect(fake.places).toEqual([]);
    // Released: no further renewal.
    const writes = fake.db.assessmentPlace.updateMany.mock.calls.length;
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS * 3);
    expect(fake.db.assessmentPlace.updateMany).toHaveBeenCalledTimes(writes);
  });

  it('throws WorkspaceBusyError with the count when the workspace is full, writing nothing', async () => {
    const later = new Date(Date.now() + 30_000);
    for (let n = 0; n < RUNNING_PER_WORKSPACE; n += 1) {
      fake.places.push({ id: `held-${n}`, orgId: ORG, leaseExpiresAt: later });
    }
    const err = await takePlace(ORG).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkspaceBusyError);
    expect(err).toMatchObject({
      counts: { running: RUNNING_PER_WORKSPACE, waiting: 0 },
      queueCanStart: false,
      retryAfterSeconds: PLACE_RETRY_AFTER_SECONDS,
    });
    expect(fake.db.assessmentPlace.create).not.toHaveBeenCalled();
  });

  it('retries a serializable conflict, then takes the place', async () => {
    fake.db.$transaction.mockRejectedValueOnce(conflict());
    const place = await takePlace(ORG);
    expect(fake.db.$transaction).toHaveBeenCalledTimes(2);
    expect(fake.places).toHaveLength(1);
    await place.release();
  });

  it('refuses as busy after conflicting on every try, without claiming a count it never made', async () => {
    fake.db.$transaction.mockRejectedValue(conflict());
    const err = await takePlace(ORG).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkspaceBusyError);
    expect(err).toMatchObject({
      counts: null,
      message: expect.stringMatching(/could not be taken/),
    });
    expect(fake.db.$transaction).toHaveBeenCalledTimes(5);
  });

  it('counts queued stored reviews with attempts left as taken, so the queue goes first', async () => {
    const later = new Date(Date.now() + 30_000);
    fake.places.push({ id: 'held-1', orgId: ORG, leaseExpiresAt: later });
    fake.seed({ status: 'RUNNING', leaseExpiresAt: later, leaseToken: 't', attempts: 1 });
    fake.seed({ status: 'QUEUED' });
    await expect(takePlace(ORG)).rejects.toMatchObject({
      counts: { running: 2, waiting: 1 },
      queueCanStart: true,
    });
    await expect(assertPlaceFree(ORG)).rejects.toBeInstanceOf(WorkspaceBusyError);
  });

  it('assertPlaceFree passes with a place free and writes nothing', async () => {
    await expect(assertPlaceFree(ORG)).resolves.toBeUndefined();
    expect(fake.db.assessmentPlace.create).not.toHaveBeenCalled();
    expect(fake.db.$transaction).not.toHaveBeenCalled();
  });

  it('clears dead places outside the take’s transaction', async () => {
    fake.places.push({ id: 'dead', orgId: ORG, leaseExpiresAt: new Date(Date.now() - 1) });
    fake.places.push({ id: 'theirs', orgId: 'org-b', leaseExpiresAt: new Date(Date.now() - 1) });
    let inTx = false;
    const deletes: boolean[] = [];
    const tx = fake.db.$transaction.getMockImplementation();
    fake.db.$transaction.mockImplementation(async (fn) => {
      inTx = true;
      try {
        return await tx?.(fn);
      } finally {
        inTx = false;
      }
    });
    fake.db.assessmentPlace.deleteMany.mockImplementationOnce(async (args) => {
      deletes.push(inTx);
      const gone = fake.places.filter((p) => p.orgId === args.where.orgId && p.id === 'dead');
      for (const p of gone) fake.places.splice(fake.places.indexOf(p), 1);
      return { count: gone.length };
    });
    const place = await takePlace(ORG);
    expect(deletes).toEqual([false]);
    expect(fake.places.map((p) => p.id)).toEqual(['theirs', place.id]);
    await place.release();
  });

  it('throws any other database error as it is', async () => {
    fake.db.$transaction.mockRejectedValueOnce(new Error('connection reset'));
    await expect(takePlace(ORG)).rejects.toThrow('connection reset');
  });

  it('logs a failed renewal and keeps the place', async () => {
    vi.useFakeTimers();
    const place = await takePlace(ORG);
    fake.db.assessmentPlace.updateMany.mockRejectedValueOnce(new Error('timeout'));
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
    expect(logger.warn).toHaveBeenCalledWith('Assessment place renewal failed', {
      placeId: place.id,
      error: 'timeout',
    });
    expect(fake.places).toHaveLength(1);
    await place.release();
  });

  it('logs a place cleared under its run, and stops renewing it', async () => {
    vi.useFakeTimers();
    const place = await takePlace(ORG);
    fake.places.splice(0, fake.places.length);
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS);
    expect(logger.warn).toHaveBeenCalledWith('Assessment place lost before its run ended', {
      placeId: place.id,
      orgId: ORG,
    });
    const writes = fake.db.assessmentPlace.updateMany.mock.calls.length;
    await vi.advanceTimersByTimeAsync(LEASE_RENEW_MS * 2);
    expect(fake.db.assessmentPlace.updateMany).toHaveBeenCalledTimes(writes);
    await place.release();
  });

  it('logs a failed release instead of throwing; the lease frees it', async () => {
    const place = await takePlace(ORG);
    fake.db.assessmentPlace.deleteMany.mockRejectedValueOnce(new Error('timeout'));
    await expect(place.release()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('Assessment place release failed', {
      placeId: place.id,
      error: 'timeout',
    });
  });
});

describe('withPlace', () => {
  it('releases the place and calls onReleased after fn resolves', async () => {
    const onReleased = vi.fn();
    const seen: number[] = [];
    const value = await withPlace(
      ORG,
      async () => {
        seen.push(fake.places.length);
        return 'done';
      },
      onReleased
    );
    expect(value).toBe('done');
    expect(seen).toEqual([1]);
    expect(fake.places).toEqual([]);
    expect(onReleased).toHaveBeenCalledTimes(1);
  });

  it('releases the place and calls onReleased when fn throws, then rethrows', async () => {
    const onReleased = vi.fn();
    await expect(
      withPlace(
        ORG,
        async () => {
          throw new Error('judge blew up');
        },
        onReleased
      )
    ).rejects.toThrow('judge blew up');
    expect(fake.places).toEqual([]);
    expect(onReleased).toHaveBeenCalledTimes(1);
  });

  it('runs nothing, and calls nothing, when no place is free', async () => {
    const later = new Date(Date.now() + 30_000);
    for (let n = 0; n < RUNNING_PER_WORKSPACE; n += 1) {
      fake.places.push({ id: `held-${n}`, orgId: ORG, leaseExpiresAt: later });
    }
    const fn = vi.fn();
    const onReleased = vi.fn();
    await expect(withPlace(ORG, fn, onReleased)).rejects.toBeInstanceOf(WorkspaceBusyError);
    expect(fn).not.toHaveBeenCalled();
    expect(onReleased).not.toHaveBeenCalled();
  });
});

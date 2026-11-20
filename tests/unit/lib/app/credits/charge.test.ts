/**
 * Tests: charging a review in CopyCredits for its cost rows (t-58).
 *
 * Mocked: Prisma (the assessment job's in-memory fake, whose `creditEntry`
 * honours the `(kind, reference)` unique index under `skipDuplicates`). Real:
 * the charge and the rate. The race against a real database is
 * `scripts/app/smoke-credit-charge.ts`.
 *
 * @see lib/app/credits/charge.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, type FakeDb } from '@/tests/unit/lib/app/assessments/fake-db';

let fake: FakeDb;
vi.mock('@/lib/db/client', () => ({
  get prisma() {
    return fake.db;
  },
}));

import {
  chargeEndedReview,
  chargeEphemeralRun,
  chargeStoredReview,
  type ChargeClient,
  type EndingClient,
} from '@/lib/app/credits/charge';

const ORG = 'org-a';
const since = new Date(Date.now() - 60_000);
const db = () => fake.db as unknown as EndingClient & ChargeClient;

beforeEach(() => {
  fake = createFakeDb();
});

describe('chargeStoredReview', () => {
  it('takes its rows since it was created, rounded up to a whole credit, as a negative CHARGE', async () => {
    fake.addCost(ORG, 0.0123, { assessmentId: 'a1' });
    fake.addCost(ORG, 0.02, { assessmentId: 'a1' });
    // Before it was created, another review's, another workspace's: none of them its own.
    fake.addCost(ORG, 9, { assessmentId: 'a1' }, new Date(since.getTime() - 1));
    fake.addCost(ORG, 9, { assessmentId: 'a2' });
    fake.addCost('org-b', 9, { assessmentId: 'a1' });

    expect(await chargeStoredReview(db(), ORG, 'a1', since)).toEqual({
      credits: 4,
      spentUsd: expect.closeTo(0.0323, 6),
    });
    expect(fake.credits).toEqual([
      expect.objectContaining({
        orgId: ORG,
        amount: -4,
        kind: 'CHARGE',
        reference: 'assessment:a1',
      }),
    ]);
  });

  it('charges a cost of whole credits exactly, not one more for the float', async () => {
    fake.addCost(ORG, 0.07, { assessmentId: 'a1' });
    expect((await chargeStoredReview(db(), ORG, 'a1', since)).credits).toBe(7);
  });

  it('charges a cost under a credit one credit, never nothing', async () => {
    fake.addCost(ORG, 0.000_01, { assessmentId: 'a1' });
    expect((await chargeStoredReview(db(), ORG, 'a1', since)).credits).toBe(1);
  });

  it('writes nothing for a review that spent nothing', async () => {
    expect(await chargeStoredReview(db(), ORG, 'a1', since)).toEqual({ credits: 0, spentUsd: 0 });
    expect(fake.db.creditEntry.createMany).not.toHaveBeenCalled();
  });

  it('charges once however many finishers race, each answering whether it took the charge', async () => {
    fake.addCost(ORG, 0.05, { assessmentId: 'a1' });

    const results = await Promise.all(
      [1, 2, 3].map(() => chargeStoredReview(db(), ORG, 'a1', since))
    );

    expect(results.map((r) => r.credits).sort()).toEqual([0, 0, 5]);
    expect(fake.credits).toHaveLength(1);
  });
});

describe('chargeEndedReview', () => {
  it('reads the review for its workspace and creation, and charges it', async () => {
    const a = fake.seed({ orgId: ORG });
    fake.addCost(ORG, 0.03, { assessmentId: a.id });

    expect(await chargeEndedReview(db(), String(a.id))).toMatchObject({ credits: 3 });
    expect(fake.credits).toEqual([
      expect.objectContaining({ reference: `assessment:${String(a.id)}` }),
    ]);
  });

  it('charges nothing when the review is gone', async () => {
    expect(await chargeEndedReview(db(), 'gone')).toBeNull();
    expect(fake.credits).toEqual([]);
  });
});

describe('chargeEphemeralRun', () => {
  it('charges the rows its judges tagged with the run, once', async () => {
    fake.addCost(ORG, 0.011, { ephemeral: true, ephemeralRun: 'r1' });
    fake.addCost(ORG, 0.011, { ephemeral: true, ephemeralRun: 'r2' });

    expect((await chargeEphemeralRun(ORG, 'r1', since)).credits).toBe(2);
    expect((await chargeEphemeralRun(ORG, 'r1', since)).credits).toBe(0);
    expect(fake.credits).toEqual([
      expect.objectContaining({ amount: -2, reference: 'ephemeral-run:r1' }),
    ]);
  });
});

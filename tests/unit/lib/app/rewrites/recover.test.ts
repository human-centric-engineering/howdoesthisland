/**
 * Tests: the rewrite recovery job (t-81), over the assessments' in-memory
 * store: a rewrite whose process died is failed and charged, once.
 *
 * @see lib/app/rewrites/recover.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, type FakeDb, type Row } from '@/tests/unit/lib/app/assessments/fake-db';

let fake: FakeDb;
vi.mock('@/lib/db/client', () => ({
  get prisma() {
    return fake.db;
  },
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { RECOVERY_BATCH } from '@/lib/app/assessments/limits';
import { LOST_REWRITE, recoverRewrites } from '@/lib/app/rewrites/recover';
import { logger } from '@/lib/logging';
import { runAsOrg } from '@/lib/tenancy/context';

const ORG = 'org-a';
const NOW = new Date('2026-11-25T12:00:00Z');
const recover = () => runAsOrg(ORG, () => recoverRewrites(NOW));

/** A rewrite row, `RUNNING` with its lease run out unless `over` says otherwise. */
function rewrite(over: Row = {}): Row {
  const row: Row = {
    id: `rw-${fake.rewrites.length + 1}`,
    orgId: ORG,
    assessmentId: 'assessment-x',
    focus: 'balanced',
    status: 'RUNNING',
    draft: 'Saved so far.',
    heldUsd: 0.05,
    costUsd: 0,
    leaseExpiresAt: new Date(NOW.getTime() - 1_000),
    createdAt: new Date(NOW.getTime() - 120_000),
    ...over,
  };
  fake.rewrites.push(row);
  return row;
}

const charges = () => fake.credits.filter((c) => c.kind === 'CHARGE');

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeDb();
  fake.grant(ORG, 1_000_000);
});

describe('recoverRewrites', () => {
  it('fails a rewrite whose lease ran out, keeps its draft, and charges what its rows record', async () => {
    const row = rewrite();
    fake.addCost(ORG, 0.07, { rewriteId: row.id }, new Date(NOW.getTime() - 60_000));

    expect(await recover()).toEqual({ failed: 1 });

    expect(row).toMatchObject({
      status: 'FAILED',
      draft: 'Saved so far.',
      error: LOST_REWRITE,
      errorCode: 'lost',
      costUsd: 0.07,
      leaseExpiresAt: null,
      completedAt: NOW,
    });
    expect(charges()).toEqual([
      expect.objectContaining({ amount: -7, reference: `rewrite:${String(row.id)}` }),
    ]);
  });

  it('fails one that died before the provider answered, charging nothing', async () => {
    const row = rewrite({ leaseExpiresAt: null });
    expect(await recover()).toEqual({ failed: 1 });
    expect(row).toMatchObject({ status: 'FAILED', costUsd: 0 });
    expect(charges()).toEqual([]);
  });

  it('leaves a rewrite whose lease is live, one ended, and another workspace’s', async () => {
    const live = rewrite({ leaseExpiresAt: new Date(NOW.getTime() + 30_000) });
    const done = rewrite({ status: 'COMPLETED', leaseExpiresAt: null });
    const other = rewrite({ orgId: 'org-b' });

    expect(await recover()).toEqual({ failed: 0 });
    expect([live.status, done.status, other.status]).toEqual(['RUNNING', 'COMPLETED', 'RUNNING']);
  });

  it('charges once, however many passes run', async () => {
    const row = rewrite();
    fake.addCost(ORG, 0.07, { rewriteId: row.id }, new Date(NOW.getTime() - 60_000));
    await recover();
    expect(await recover()).toEqual({ failed: 0 });
    expect(charges()).toHaveLength(1);
  });

  it(`takes at most ${RECOVERY_BATCH} a pass, oldest first`, async () => {
    const rows = Array.from({ length: RECOVERY_BATCH + 1 }, (_, i) =>
      rewrite({ createdAt: new Date(NOW.getTime() - 100_000 + i) })
    );
    expect(await recover()).toEqual({ failed: RECOVERY_BATCH });
    expect(rows.at(-1)?.status).toBe('RUNNING');
  });

  it('logs one that cannot be ended and goes on with the rest', async () => {
    rewrite();
    const second = rewrite();
    fake.db.$transaction.mockImplementationOnce(async () => {
      throw new Error('deadlock');
    });
    expect(await recover()).toEqual({ failed: 1 });
    expect(second.status).toBe('FAILED');
    expect(logger.error).toHaveBeenCalledWith(
      'Recovery could not end a lost rewrite',
      expect.any(Error),
      expect.objectContaining({ rewriteId: 'rw-1' })
    );
  });
});

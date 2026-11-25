/**
 * Tests: the rewrite recovery job (t-81, t-85), over the assessments'
 * in-memory store: a rewrite whose process died is failed and charged, once,
 * and priced from what it kept of its call when it left no cost row.
 *
 * Mocked: the cost write (`logCost`), which writes into the fake's cost rows
 * at a fixed price: what the row is priced from is checked here, its pricing
 * in `stream-agent.test.ts`.
 *
 * @see lib/app/rewrites/recover.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, type FakeDb, type Row } from '@/tests/unit/lib/app/assessments/fake-db';

const mocks = vi.hoisted(() => ({ logCost: vi.fn() }));

let fake: FakeDb;
vi.mock('@/lib/orchestration/llm/cost-tracker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/orchestration/llm/cost-tracker')>()),
  logCost: mocks.logCost,
}));
vi.mock('@/lib/db/client', () => ({
  get prisma() {
    return fake.db;
  },
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { RECOVERY_BATCH } from '@/lib/app/assessments/limits';
import { REWRITE_LIFETIME_MS } from '@/lib/app/rewrites/limits';
import { CLAIM_MS, LOST_REWRITE, recoverRewrites } from '@/lib/app/rewrites/recover';
import { logger } from '@/lib/logging';
import type { LogCostParams } from '@/lib/orchestration/llm/cost-tracker';
import { tokeniserForModel } from '@/lib/orchestration/llm/tokeniser';
import { requireOrgId, runAsOrg } from '@/lib/tenancy/context';

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
    // Past the longest its call can live.
    createdAt: new Date(NOW.getTime() - REWRITE_LIFETIME_MS - 60_000),
    createdByUserId: 'user-1',
    callStart: null,
    ...over,
  };
  fake.rewrites.push(row);
  return row;
}

const charges = () => fake.credits.filter((c) => c.kind === 'CHARGE');

/** What a rewrite keeps of its call as it starts. */
const CALL_START = {
  agentId: 'agent-editor',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  isLocal: false,
  promptTokens: 6_000,
  frameworkVersion: 'howdoesthisland@0.5.2',
};

/** The price every estimated row is written at, here. */
const ESTIMATE_USD = 0.123;

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeDb();
  fake.grant(ORG, 1_000_000);
  mocks.logCost.mockImplementation(async (params: LogCostParams) => {
    fake.addCost(requireOrgId(), ESTIMATE_USD, params.metadata ?? {}, NOW);
    const row = fake.costRows.at(-1);
    return { id: row?.id, totalCostUsd: ESTIMATE_USD };
  });
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
      rewrite({ createdAt: new Date(NOW.getTime() - REWRITE_LIFETIME_MS - 100_000 + i) })
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

  it('leaves one whose call could still be running, though its lease ran out', async () => {
    const young = rewrite({
      createdAt: new Date(NOW.getTime() - REWRITE_LIFETIME_MS + 1_000),
      callStart: CALL_START,
    });
    const old = rewrite();
    expect(await recover()).toEqual({ failed: 1 });
    expect([young.status, old.status]).toEqual(['RUNNING', 'FAILED']);
    expect(mocks.logCost).not.toHaveBeenCalled();
  });

  it('ends a young one that kept no call once its lease runs out: there is none to wait for', async () => {
    const young = rewrite({
      createdAt: new Date(NOW.getTime() - 30_000),
      draft: '',
      callStart: null,
    });
    expect(await recover()).toEqual({ failed: 1 });
    expect(young).toMatchObject({ status: 'FAILED', errorCode: 'lost', costUsd: 0 });
    expect(charges()).toEqual([]);
  });

  it('leaves one a save renewed while the pass was at it: its call lives, and charges itself', async () => {
    const row = rewrite({ draft: DRAFT_SAVED, callStart: CALL_START });
    // The call's save lands between the pass's claim and its ending.
    mocks.logCost.mockImplementationOnce(async () => {
      Object.assign(row, { leaseExpiresAt: new Date(NOW.getTime() + 90_000) });
      return null;
    });
    expect(await recover()).toEqual({ failed: 0 });
    expect(row.status).toBe('RUNNING');
    expect(charges()).toEqual([]);
  });

  it('leaves a young one whose call started after the pass looked: it may still be running', async () => {
    const young = rewrite({ createdAt: new Date(NOW.getTime() - 30_000), callStart: null });
    const find = fake.db.rewrite.findFirst;
    const real = find.getMockImplementation();
    find.mockImplementationOnce(async (args: { where?: Row }) => {
      // Its `callStart` lands between the pass's read and its claim.
      young.callStart = CALL_START;
      return real?.(args);
    });
    expect(await recover()).toEqual({ failed: 0 });
    expect(young.status).toBe('RUNNING');
    expect(mocks.logCost).not.toHaveBeenCalled();
    expect(charges()).toEqual([]);
  });

  it('takes one claimed by a pass alongside only once that claim runs out', async () => {
    const row = rewrite();
    row.leaseExpiresAt = new Date(NOW.getTime() + CLAIM_MS);
    expect(await recover()).toEqual({ failed: 0 });
    expect(row.status).toBe('RUNNING');
  });
});

const DRAFT_SAVED = 'Some of a draft, saved by a call still running.';

describe('recoverRewrites on a call that died mid-stream (t-85)', () => {
  const DRAFT = 'The first half of a sharper draft, saved before the process died.';

  it('prices it from what it kept and its saved draft, estimated, and charges it once', async () => {
    const row = rewrite({ draft: DRAFT, callStart: CALL_START });

    let inTransaction: number | undefined;
    mocks.logCost.mockImplementationOnce(async (params: LogCostParams) => {
      // Written with no transaction open: it needs a connection of its own.
      inTransaction = fake.db.$transaction.mock.calls.length;
      fake.addCost(requireOrgId(), ESTIMATE_USD, params.metadata ?? {}, NOW);
      return { id: fake.costRows.at(-1)?.id, totalCostUsd: ESTIMATE_USD };
    });

    expect(await recover()).toEqual({ failed: 1 });

    expect(inTransaction).toBe(0);
    expect(mocks.logCost).toHaveBeenCalledTimes(1);
    const written = mocks.logCost.mock.calls[0][0] as LogCostParams;
    expect(written).toMatchObject({
      agentId: 'agent-editor',
      userId: 'user-1',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      inputTokens: 6_000,
      outputTokens: tokeniserForModel('claude-sonnet-5-5').count(DRAFT),
      isLocal: false,
      metadata: {
        editor: 'rewrite',
        rewriteId: row.id,
        frameworkVersion: 'howdoesthisland@0.5.2',
        error: 'lost',
        estimated: true,
      },
    });
    expect(written.outputTokens).toBeGreaterThan(0);
    expect(row).toMatchObject({
      status: 'FAILED',
      errorCode: 'lost',
      draft: DRAFT,
      costUsd: ESTIMATE_USD,
    });
    // $0.123 is 12.3 credits, rounded up.
    expect(charges()).toEqual([
      expect.objectContaining({ amount: -13, reference: `rewrite:${String(row.id)}` }),
    ]);

    expect(await recover()).toEqual({ failed: 0 });
    expect(mocks.logCost).toHaveBeenCalledTimes(1);
    expect(charges()).toHaveLength(1);
  });

  it('estimates nothing for one whose call wrote its own cost row, and charges that', async () => {
    const row = rewrite({ draft: DRAFT, callStart: CALL_START });
    fake.addCost(ORG, 0.07, { rewriteId: row.id }, new Date(NOW.getTime() - 60_000));

    await recover();

    expect(mocks.logCost).not.toHaveBeenCalled();
    expect(row.costUsd).toBe(0.07);
    expect(charges()).toEqual([expect.objectContaining({ amount: -7 })]);
  });

  it('charges nothing for one that saved no draft: the provider may not have answered', async () => {
    const row = rewrite({ draft: '', callStart: CALL_START });
    expect(await recover()).toEqual({ failed: 1 });
    expect(mocks.logCost).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'FAILED', costUsd: 0 });
    expect(charges()).toEqual([]);
  });

  it('charges nothing for one that kept no call, or kept one it cannot read', async () => {
    const none = rewrite({ draft: DRAFT, callStart: null });
    const unreadable = rewrite({ draft: DRAFT, callStart: { agentId: 'agent-editor' } });
    expect(await recover()).toEqual({ failed: 2 });
    expect(mocks.logCost).not.toHaveBeenCalled();
    expect([none.status, unreadable.status]).toEqual(['FAILED', 'FAILED']);
    expect(charges()).toEqual([]);
    // The provider answered, so it may have billed: said, for each.
    expect(vi.mocked(logger.warn).mock.calls).toEqual([
      [
        'A lost rewrite answered but kept no call to price; it is ended uncharged',
        { rewriteId: none.id },
      ],
      [
        'A lost rewrite answered but kept no call to price; it is ended uncharged',
        { rewriteId: unreadable.id },
      ],
    ]);
  });

  it('ends one whose estimate could not be written uncharged, and says so', async () => {
    mocks.logCost.mockResolvedValue(null);
    const row = rewrite({ draft: DRAFT, callStart: CALL_START });
    expect(await recover()).toEqual({ failed: 1 });
    expect(row).toMatchObject({ status: 'FAILED', costUsd: 0 });
    expect(charges()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      'A lost rewrite could not be priced; it is ended uncharged',
      undefined,
      { rewriteId: row.id }
    );
  });

  it('charges, without a second estimate, the one a failed pass wrote', async () => {
    const row = rewrite({ draft: DRAFT, callStart: CALL_START });
    // The pass writes its estimate, then its transaction fails at the charge.
    const charge = fake.db.creditEntry.createMany;
    charge.mockImplementationOnce(async () => {
      throw new Error('deadlock');
    });
    expect(await recover()).toEqual({ failed: 0 });
    expect(mocks.logCost).toHaveBeenCalledTimes(1);
    // The fake does not roll back: put back what the rollback would, and let
    // the pass's claim run out. The estimate stays, written before it.
    Object.assign(row, {
      status: 'RUNNING',
      error: null,
      errorCode: null,
      completedAt: null,
      leaseExpiresAt: new Date(NOW.getTime() - 1_000),
    });

    expect(await recover()).toEqual({ failed: 1 });
    expect(mocks.logCost).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('FAILED');
    expect(charges()).toEqual([expect.objectContaining({ amount: -13 })]);
  });
});

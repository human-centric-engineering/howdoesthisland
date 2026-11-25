/**
 * Tests: the editor's verdict on a comparison (t-88), over the assessments'
 * in-memory store: when it starts, that it runs once, that the recovery tick
 * starts one a lost process left, that it says why when there is none, and
 * that it is charged once under its own reference.
 *
 * Mocked: the editor's call (`callAgent`), which writes the cost row the
 * real call would, and the version's engine, a stub that records what it was
 * asked to build and check: the framework's own request and validation are
 * tested in `engine/verdict.test.ts`.
 *
 * @see lib/app/comparisons/verdict.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, type FakeDb, type Row } from '@/tests/unit/lib/app/assessments/fake-db';

const mocks = vi.hoisted(() => ({
  callAgent: vi.fn(),
  engineForVersion: vi.fn(),
  streamCeilingUsd: vi.fn(),
}));

let fake: FakeDb;
vi.mock('@/lib/db/client', () => ({
  get prisma() {
    return fake.db;
  },
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/app/judges/run-judge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/judges/run-judge')>()),
  callAgent: mocks.callAgent,
  streamCeilingUsd: mocks.streamCeilingUsd,
}));
vi.mock('@/lib/app/assessments/engine', () => ({ engineForVersion: mocks.engineForVersion }));

import { LEASE_MS, MAX_ATTEMPTS } from '@/lib/app/assessments/limits';
import {
  estimateComparisonVerdict,
  recoverVerdicts,
  verdictProjectContext,
  startVerdict,
  startVerdictsAfterReview,
} from '@/lib/app/comparisons/verdict';
import { readComparison } from '@/lib/app/comparisons/views';
import { removeComparison } from '@/lib/app/comparisons/service';
import { cancelAssessment } from '@/lib/app/assessments/run';
import { recoverAssessments } from '@/lib/app/assessments/recover';
import { comparisonVerdictChargeReference } from '@/lib/app/credits/charge';
import { EDITOR_AGENT_SLUG } from '@/lib/app/judges/agents';
import { JudgeRunError } from '@/lib/app/judges/run-judge';
import { runAsOrg } from '@/lib/tenancy/context';

const ORG = 'org-a';
const NOW = new Date('2026-11-25T12:00:00Z');

/** Long enough for a call started after its claim to end and be written. */
const settle = () => new Promise((r) => setTimeout(r, 20));

const engine = {
  buildVerdictRequest: vi.fn(() => ({
    prompt: 'which lands better?',
    schema: {},
    schemaName: 'verdict',
    maxTokens: 100,
    timeoutMs: 1000,
  })),
  validateVerdictReply: vi.fn(),
  assemble: vi.fn((text: string) => ({ quick: text })),
  quickScan: vi.fn(() => ({})),
  appealScores: vi.fn(() => null),
};

const VERDICT = {
  draft: 1,
  why: 'The second names the reader’s problem first.',
  appeals: [{ appeal: 'pathos', why: 'It starts from what the reader feels.' }],
};

/** The editor answers with {@link VERDICT}, writing its cost row as the real call does. */
function editorAnswers(costUsd = 0.02) {
  mocks.callAgent.mockImplementation(
    async (call: { costMetadata: Record<string, string>; validate: (raw: unknown) => unknown }) => {
      fake.addCost(ORG, costUsd, { ...call.costMetadata }, new Date());
      call.validate({ raw: true });
      return { output: VERDICT, drops: [], provider: 'openai', model: 'gpt-5', costUsd };
    }
  );
}

/** A review of a draft, in `status`, with a result once it is scored. */
function review(status: string, text = 'A draft.'): Row {
  const row = fake.seed({
    status,
    result: status === 'COMPLETED' || status === 'PARTIAL' ? { scores: { text } } : null,
  });
  const content = fake.contents.find((c) => c.id === row.contentId);
  if (content) content.text = text;
  return row;
}

/** A comparison of `reviews` (`null` for a purged draft), its verdict as `over` says. */
function comparison(reviews: (Row | null)[], over: Row = {}): Row {
  const set: Row = {
    id: `set-${fake.sets.length + 1}`,
    orgId: ORG,
    kind: 'COMPARISON',
    projectId: null,
    frameworkVersionId: 'version-1',
    profile: 'full',
    judges: ['judge_ethos', 'judge_pathos'],
    context: { contentType: 'landing_page' },
    createdByUserId: 'user-1',
    createdAt: new Date(NOW.getTime() - 60_000),
    verdictStatus: 'WAITING',
    verdict: null,
    verdictReason: null,
    verdictHeldUsd: 0.05,
    verdictCostUsd: 0,
    verdictModel: null,
    verdictAttempts: 0,
    verdictLeaseExpiresAt: null,
    verdictCompletedAt: null,
    ...over,
  };
  fake.sets.push(set);
  reviews.forEach((r, position) =>
    fake.setMembers.push({
      id: `member-${String(set.id)}-${position}`,
      orgId: ORG,
      setId: set.id,
      assessmentId: r ? r.id : null,
      position,
      label: `Draft ${position + 1}`,
    })
  );
  return set;
}

const charges = () => fake.credits.filter((c) => c.kind === 'CHARGE');

beforeEach(() => {
  vi.clearAllMocks();
  fake = createFakeDb();
  fake.grant(ORG, 1_000);
  mocks.engineForVersion.mockResolvedValue({
    version: { id: 'version-1' },
    engine,
    label: 'howdoesthisland@0.5.1',
  });
  engine.validateVerdictReply.mockReturnValue({ ok: true, output: VERDICT, drops: [] });
  editorAnswers();
});

describe('startVerdict: when it runs', () => {
  it('asks the editor once every draft is final and two completed, and stores the verdict', async () => {
    const a = review('COMPLETED', 'Draft A.');
    const b = review('COMPLETED', 'Draft B.');
    const set = comparison([a, b]);

    expect(await runAsOrg(ORG, () => startVerdict(set.id as string, NOW))).toBe('started');
    await settle();

    expect(mocks.callAgent).toHaveBeenCalledTimes(1);
    const call = mocks.callAgent.mock.calls[0][0];
    expect(call).toMatchObject({
      agentSlug: EDITOR_AGENT_SLUG,
      role: 'editor',
      costMetadata: { editor: 'verdict', comparisonId: set.id },
      frameworkVersion: 'howdoesthisland@0.5.1',
      userId: 'user-1',
    });
    // No assessmentId: no draft's charge counts the verdict's rows.
    expect(call).not.toHaveProperty('assessmentId');
    call.request();
    // The completed drafts, by their place, with their texts and results.
    expect(engine.buildVerdictRequest).toHaveBeenCalledWith(
      [
        { position: 0, label: 'Draft 1', text: 'Draft A.', result: a.result },
        { position: 1, label: 'Draft 2', text: 'Draft B.', result: b.result },
      ],
      set.context,
      null
    );
    expect(fake.sets[0]).toMatchObject({
      verdictStatus: 'COMPLETED',
      verdict: VERDICT,
      verdictReason: null,
      verdictModel: 'gpt-5',
      verdictCostUsd: 0.02,
      verdictAttempts: 1,
      verdictLeaseExpiresAt: null,
    });
    const read = await runAsOrg(ORG, () => readComparison(set.id as string));
    expect(read?.verdict).toMatchObject({
      status: 'completed',
      draft: 1,
      why: VERDICT.why,
      appeals: VERDICT.appeals,
      reason: null,
      costUsd: 0.02,
    });
  });

  it('shows the editor only the drafts that completed, leaving out a partial one', async () => {
    const set = comparison([review('COMPLETED'), review('PARTIAL'), review('COMPLETED')]);
    await runAsOrg(ORG, () => startVerdict(set.id as string, NOW));
    await settle();
    mocks.callAgent.mock.calls[0][0].request();
    const shown = engine.buildVerdictRequest.mock.calls[0] as unknown as [{ position: number }[]];
    expect(shown[0].map((d) => d.position)).toEqual([0, 2]);
  });

  it('waits while any draft is queued or running', async () => {
    for (const unfinished of ['QUEUED', 'RUNNING']) {
      const set = comparison([review('COMPLETED'), review(unfinished)]);
      expect(await runAsOrg(ORG, () => startVerdict(set.id as string, NOW))).toBe('not_due');
      expect(fake.sets.at(-1)).toMatchObject({ verdictStatus: 'WAITING', verdictAttempts: 0 });
    }
    expect(mocks.callAgent).not.toHaveBeenCalled();
  });

  it('has no verdict, and says why, with fewer than two completed drafts', async () => {
    // One completed, one failed, one purged: final, but nothing to weigh.
    const set = comparison([review('COMPLETED'), review('FAILED'), null]);
    expect(await runAsOrg(ORG, () => startVerdict(set.id as string, NOW))).toBe('skipped');
    await settle();

    expect(mocks.callAgent).not.toHaveBeenCalled();
    expect(fake.sets[0]).toMatchObject({
      verdictStatus: 'SKIPPED',
      verdictReason: 'too_few_completed',
    });
    const read = await runAsOrg(ORG, () => readComparison(set.id as string));
    expect(read?.verdict).toMatchObject({
      status: 'skipped',
      draft: null,
      why: null,
      appeals: [],
      reason: 'too_few_completed',
    });
    expect(charges()).toEqual([]);
  });

  it('is not run twice: of two starters, one claims it, and a second start after it ends does nothing', async () => {
    const set = comparison([review('COMPLETED'), review('COMPLETED')]);
    const starts = await runAsOrg(ORG, () =>
      Promise.all([startVerdict(set.id as string, NOW), startVerdict(set.id as string, NOW)])
    );
    await settle();
    expect(starts.sort()).toEqual(['not_due', 'started']);
    expect(await runAsOrg(ORG, () => startVerdict(set.id as string, NOW))).toBe('not_due');
    await settle();
    expect(mocks.callAgent).toHaveBeenCalledTimes(1);
    expect(charges()).toHaveLength(1);
  });

  it('leaves a running verdict whose lease is live alone', async () => {
    const set = comparison([review('COMPLETED'), review('COMPLETED')], {
      verdictStatus: 'RUNNING',
      verdictAttempts: 1,
      verdictLeaseExpiresAt: new Date(NOW.getTime() + LEASE_MS),
    });
    expect(await runAsOrg(ORG, () => startVerdict(set.id as string, NOW))).toBe('not_due');
    expect(mocks.callAgent).not.toHaveBeenCalled();
  });

  it('starts from the end of a draft’s review only for a comparison still waiting', async () => {
    const last = review('COMPLETED');
    comparison([review('COMPLETED'), last]);
    comparison([review('COMPLETED'), last], { verdictStatus: 'COMPLETED' });
    // The draft's run ends outside a request: the start runs at once.
    await runAsOrg(ORG, async () => startVerdictsAfterReview(ORG, last.id as string));
    await settle();
    await settle();
    expect(mocks.callAgent).toHaveBeenCalledTimes(1);
    expect(fake.sets[0]?.verdictStatus).toBe('COMPLETED');
  });
});

describe('the verdict’s failure and charge', () => {
  it('is charged once under its own reference, for every attempt’s rows', async () => {
    const set = comparison([review('COMPLETED'), review('COMPLETED')], {
      // An earlier attempt whose process died after its call wrote its row.
      verdictStatus: 'RUNNING',
      verdictAttempts: 1,
      verdictLeaseExpiresAt: new Date(NOW.getTime() - 1_000),
    });
    fake.addCost(ORG, 0.03, { editor: 'verdict', comparisonId: set.id }, NOW);

    await runAsOrg(ORG, () => startVerdict(set.id as string, NOW));
    await settle();

    expect(fake.sets[0]).toMatchObject({
      verdictStatus: 'COMPLETED',
      verdictAttempts: 2,
      verdictCostUsd: 0.05,
    });
    expect(charges()).toEqual([
      expect.objectContaining({
        orgId: ORG,
        reference: comparisonVerdictChargeReference(set.id as string),
        amount: expect.any(Number),
      }),
    ]);
    expect(Number(charges()[0]?.amount)).toBeLessThan(0);
  });

  it('ends FAILED with the call’s code when the editor fails, and is charged for what it billed', async () => {
    mocks.callAgent.mockImplementation(async (call: { costMetadata: Record<string, string> }) => {
      fake.addCost(ORG, 0.01, { ...call.costMetadata }, new Date());
      const err = new JudgeRunError('malformed', 'not a verdict');
      err.spend = {
        provider: 'openai',
        model: 'gpt-5',
        usage: { input: 1, output: 1, attempts: 1 },
        costUsd: 0.01,
      };
      throw err;
    });
    const set = comparison([review('COMPLETED'), review('COMPLETED')]);
    await runAsOrg(ORG, () => startVerdict(set.id as string, NOW));
    await settle();

    expect(fake.sets[0]).toMatchObject({
      verdictStatus: 'FAILED',
      verdictReason: 'malformed',
      verdictModel: 'gpt-5',
      verdict: null,
    });
    expect(charges()).toHaveLength(1);
  });

  it('a call that ends after its verdict was claimed again does not charge: the attempt that ends it does', async () => {
    let finishFirst: () => void = () => {};
    mocks.callAgent.mockImplementationOnce(
      (call: { costMetadata: Record<string, string> }) =>
        new Promise((resolve) => {
          finishFirst = () => {
            fake.addCost(ORG, 0.02, { ...call.costMetadata }, new Date());
            resolve({
              output: VERDICT,
              drops: [],
              provider: 'openai',
              model: 'gpt-5',
              costUsd: 0.02,
            });
          };
        })
    );
    const set = comparison([review('COMPLETED'), review('COMPLETED')]);
    await runAsOrg(ORG, () => startVerdict(set.id as string, NOW));
    // Its lease runs out while the call stalls; recovery claims it again.
    const later = new Date(NOW.getTime() + LEASE_MS + 1_000);
    fake.sets[0].verdictLeaseExpiresAt = new Date(later.getTime() - 1);
    expect(await runAsOrg(ORG, () => startVerdict(set.id as string, later))).toBe('started');
    await settle();
    expect(charges()).toHaveLength(1);
    const charged = charges()[0]?.amount;

    finishFirst();
    await settle();
    // The stalled call's ending matches nothing and charges nothing more.
    expect(fake.sets[0]).toMatchObject({ verdictStatus: 'COMPLETED', verdictAttempts: 2 });
    expect(charges()).toHaveLength(1);
    expect(charges()[0]?.amount).toBe(charged);
  });

  it('charges a call whose comparison was deleted under it', async () => {
    let finish: () => void = () => {};
    mocks.callAgent.mockImplementationOnce(
      (call: { costMetadata: Record<string, string> }) =>
        new Promise((resolve) => {
          finish = () => {
            fake.addCost(ORG, 0.02, { ...call.costMetadata }, new Date());
            resolve({
              output: VERDICT,
              drops: [],
              provider: 'openai',
              model: 'gpt-5',
              costUsd: 0.02,
            });
          };
        })
    );
    const set = comparison([review('COMPLETED'), review('COMPLETED')]);
    await runAsOrg(ORG, () => startVerdict(set.id as string, NOW));
    fake.sets.splice(0, 1);
    finish();
    await settle();
    expect(charges()).toEqual([
      expect.objectContaining({ reference: comparisonVerdictChargeReference(set.id as string) }),
    ]);
  });
});

describe('round-1 review fixes', () => {
  it('charges, as it skips, a verdict an earlier attempt called before its drafts were deleted', async () => {
    const set = comparison([review('COMPLETED'), null], {
      verdictStatus: 'RUNNING',
      verdictAttempts: 1,
      verdictLeaseExpiresAt: new Date(NOW.getTime() - 1_000),
    });
    fake.addCost(ORG, 0.04, { editor: 'verdict', comparisonId: set.id }, NOW);

    expect(await runAsOrg(ORG, () => startVerdict(set.id as string, NOW))).toBe('skipped');

    expect(fake.sets[0]).toMatchObject({
      verdictStatus: 'SKIPPED',
      verdictReason: 'too_few_completed',
      verdictCostUsd: 0.04,
    });
    expect(charges()).toEqual([
      expect.objectContaining({ reference: comparisonVerdictChargeReference(set.id as string) }),
    ]);
  });

  it('charges a lost verdict when its comparison is deleted, and leaves a live one to its call', async () => {
    const lost = comparison([review('COMPLETED'), review('COMPLETED')], {
      verdictStatus: 'RUNNING',
      verdictAttempts: 1,
      verdictLeaseExpiresAt: new Date(Date.now() - 1_000),
    });
    const live = comparison([review('COMPLETED'), review('COMPLETED')], {
      verdictStatus: 'RUNNING',
      verdictAttempts: 1,
      verdictLeaseExpiresAt: new Date(Date.now() + LEASE_MS),
    });
    for (const set of [lost, live]) {
      fake.addCost(ORG, 0.04, { editor: 'verdict', comparisonId: set.id }, NOW);
    }

    await runAsOrg(ORG, () => removeComparison(lost.id as string));
    await runAsOrg(ORG, () => removeComparison(live.id as string));

    expect(fake.sets).toEqual([]);
    expect(charges().map((c) => c.reference)).toEqual([
      comparisonVerdictChargeReference(lost.id as string),
    ]);
  });

  it('starts the verdict once a cancel ends the last queued draft', async () => {
    const queued = review('QUEUED');
    comparison([review('COMPLETED'), review('COMPLETED'), queued]);
    expect(await runAsOrg(ORG, () => cancelAssessment(queued.id as string))).toBe(true);
    await settle();
    await settle();
    expect(mocks.callAgent).toHaveBeenCalledTimes(1);
    expect(fake.sets[0]?.verdictStatus).toBe('COMPLETED');
  });

  it('starts the verdict once assessment recovery gives up on the last draft', async () => {
    const stalled = review('RUNNING');
    stalled.attempts = MAX_ATTEMPTS;
    stalled.leaseExpiresAt = new Date(Date.now() - 1_000);
    comparison([review('COMPLETED'), review('COMPLETED'), stalled]);
    await runAsOrg(ORG, () => recoverAssessments());
    await settle();
    await settle();
    expect(stalled.status).toBe('FAILED');
    expect(mocks.callAgent).toHaveBeenCalledTimes(1);
  });

  it('still starts the other comparisons when one cannot be started', async () => {
    const last = review('COMPLETED');
    comparison([review('COMPLETED'), last]);
    comparison([review('COMPLETED'), last]);
    fake.db.assessmentSet.findFirst.mockRejectedValueOnce(new Error('connection reset'));
    await runAsOrg(ORG, async () => startVerdictsAfterReview(ORG, last.id as string));
    await settle();
    await settle();
    expect(mocks.callAgent).toHaveBeenCalledTimes(1);
    expect(fake.sets.map((x) => x.verdictStatus)).toEqual(['WAITING', 'COMPLETED']);
  });
});

describe('recoverVerdicts: the recovery tick', () => {
  it('starts a due verdict that has none, and a second pass does not start it again', async () => {
    // Its last draft ended in a process that died before starting it.
    const set = comparison([review('COMPLETED'), review('COMPLETED')]);
    comparison([review('COMPLETED'), review('RUNNING')]);

    expect(await runAsOrg(ORG, () => recoverVerdicts(NOW))).toEqual({
      started: 1,
      skipped: 0,
      gaveUp: 0,
    });
    await settle();
    expect(await runAsOrg(ORG, () => recoverVerdicts(NOW))).toEqual({
      started: 0,
      skipped: 0,
      gaveUp: 0,
    });
    await settle();

    expect(mocks.callAgent).toHaveBeenCalledTimes(1);
    expect(fake.sets.find((s) => s.id === set.id)?.verdictStatus).toBe('COMPLETED');
    expect(fake.sets[1]?.verdictStatus).toBe('WAITING');
  });

  it('starts again a verdict whose process died while it ran', async () => {
    comparison([review('COMPLETED'), review('COMPLETED')], {
      verdictStatus: 'RUNNING',
      verdictAttempts: 1,
      verdictLeaseExpiresAt: new Date(NOW.getTime() - 1_000),
    });
    expect((await runAsOrg(ORG, () => recoverVerdicts(NOW))).started).toBe(1);
    await settle();
    expect(fake.sets[0]).toMatchObject({ verdictStatus: 'COMPLETED', verdictAttempts: 2 });
  });

  it('gives up on one lost too often: FAILED (`lost`), charged for what its attempts recorded', async () => {
    const set = comparison([review('COMPLETED'), review('COMPLETED')], {
      verdictStatus: 'RUNNING',
      verdictAttempts: MAX_ATTEMPTS,
      verdictLeaseExpiresAt: new Date(NOW.getTime() - 1_000),
    });
    fake.addCost(ORG, 0.04, { editor: 'verdict', comparisonId: set.id }, NOW);

    expect((await runAsOrg(ORG, () => recoverVerdicts(NOW))).gaveUp).toBe(1);
    expect(mocks.callAgent).not.toHaveBeenCalled();
    expect(fake.sets[0]).toMatchObject({
      verdictStatus: 'FAILED',
      verdictReason: 'lost',
      verdictCostUsd: 0.04,
      verdictLeaseExpiresAt: null,
    });
    expect(charges()).toHaveLength(1);
  });

  it('skips, saying why, a waiting verdict whose drafts ended with fewer than two completed', async () => {
    comparison([review('COMPLETED'), review('CANCELLED')]);
    expect((await runAsOrg(ORG, () => recoverVerdicts(NOW))).skipped).toBe(1);
    expect(fake.sets[0]).toMatchObject({
      verdictStatus: 'SKIPPED',
      verdictReason: 'too_few_completed',
    });
  });

  it('leaves another workspace’s comparisons alone', async () => {
    comparison([review('COMPLETED'), review('COMPLETED')], { orgId: 'org-b' });
    expect((await runAsOrg(ORG, () => recoverVerdicts(NOW))).started).toBe(0);
  });
});

describe('estimateComparisonVerdict', () => {
  const drafts = [{ text: 'Draft A.' }, { text: 'Draft B.', label: 'B' }];

  it('is the median of the workspace’s recent verdicts that cost something', async () => {
    for (const cost of [0.02, 0.06, 0.04]) {
      comparison([], { verdictStatus: 'COMPLETED', verdictCostUsd: cost, createdAt: NOW });
    }
    comparison([], { verdictStatus: 'FAILED', verdictCostUsd: 0 });
    const usd = await estimateComparisonVerdict(ORG, engine as never, {}, drafts, ['a', 'b']);
    expect(usd).toBe(0.04);
    expect(mocks.streamCeilingUsd).not.toHaveBeenCalled();
  });

  it('with none, is what this verdict can cost at most, built from each draft’s quick scan', async () => {
    mocks.streamCeilingUsd.mockResolvedValue(0.123);
    const usd = await estimateComparisonVerdict(ORG, engine as never, {}, drafts, ['a', 'b']);
    expect(usd).toBe(0.123);
    expect(engine.buildVerdictRequest).toHaveBeenCalledWith(
      [
        { position: 0, label: null, text: 'Draft A.', result: { quick: 'Draft A.' } },
        { position: 1, label: 'B', text: 'Draft B.', result: { quick: 'Draft B.' } },
      ],
      {},
      null
    );
  });

  it('builds its ceiling with the project’s brief, as the call will read it', async () => {
    mocks.streamCeilingUsd.mockResolvedValue(0.2);
    const brief = { offer: 'A bike-sharing app for commuters.' };
    await estimateComparisonVerdict(ORG, engine as never, {}, drafts, ['a', 'b'], brief);
    const projectContext = (engine.buildVerdictRequest.mock.calls[0] as unknown[])[2];
    expect(projectContext).toEqual(verdictProjectContext(brief));
    expect(projectContext).toContain('A bike-sharing app for commuters.');
  });

  it('is nothing for drafts with too few AI reviewers for the editor, and holds nothing when the ceiling fails', async () => {
    expect(await estimateComparisonVerdict(ORG, engine as never, {}, drafts, ['a'])).toBe(0);
    mocks.streamCeilingUsd.mockRejectedValue(new Error('binding unreadable'));
    expect(await estimateComparisonVerdict(ORG, engine as never, {}, drafts, ['a', 'b'])).toBe(0);
  });
});

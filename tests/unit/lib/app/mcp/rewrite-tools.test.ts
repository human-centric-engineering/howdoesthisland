/**
 * The rewrite MCP tools of t-94, over the rewrites service they share with
 * the rewrites route.
 *
 * Unlike the review and comparison tools' tests, the library is real here:
 * the thing to pin is that a rewrite the tool answered before it finished
 * still ends and is charged afterwards, which only the service's own run can
 * show. So, as `tests/unit/lib/app/rewrites/service.test.ts`: Prisma is the
 * assessments' stateful fake, the engine is the real one, and the editor's
 * call (`streamAgent`) is scripted, writing the cost row a real call writes.
 * The budget check runs `create` in a transaction, as it does once a rewrite
 * fits. Also mocked: the membership check, the per-person cap, and Next's
 * `after()`, which records what the run was handed to, so a test can tell
 * that the work outlives the tool's answer the way it does on a serverless
 * host, where only what `after()` holds keeps running.
 *
 * @see lib/app/mcp/rewrite-draft.ts
 * @see lib/app/mcp/get-rewrite.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeDb, type FakeDb, type Row } from '@/tests/unit/lib/app/assessments/fake-db';

const mocks = vi.hoisted(() => ({
  streamAgent: vi.fn(),
  streamCeilingUsd: vi.fn(),
  engineForVersion: vi.fn(),
  reserve: vi.fn(),
  verifiedMembership: vi.fn(),
  check: vi.fn(),
  after: vi.fn(),
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
  streamAgent: mocks.streamAgent,
  streamCeilingUsd: mocks.streamCeilingUsd,
}));
vi.mock('@/lib/app/assessments/engine', () => ({ engineForVersion: mocks.engineForVersion }));
vi.mock('@/lib/app/usage/budget', () => ({ reserveRewriteBudget: mocks.reserve }));
vi.mock('@/lib/tenancy/entry', () => ({ verifiedMembership: mocks.verifiedMembership }));
vi.mock('@/lib/app/rewrites/limiter', () => ({ rewriteLimiter: { check: mocks.check } }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}));

import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import type { Assessment } from '@/lib/app/frameworks/howdoesthisland/engine/types';
import type { AgentStreamCall, AgentStreamReply } from '@/lib/app/judges/run-judge';
import { GetRewriteCapability } from '@/lib/app/mcp/get-rewrite';
import { RewriteDraftCapability } from '@/lib/app/mcp/rewrite-draft';
import { MCP_WAIT_MS } from '@/lib/app/mcp/tool-support';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';
import { runAsOrg } from '@/lib/tenancy/context';
import {
  loadCases,
  loadModel,
} from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

const ORG = 'org-a';
const inOrg = <T>(fn: () => Promise<T>) => runAsOrg(ORG, fn);

const asCreator: CapabilityContext = { userId: 'user-1', agentId: 'mcp-system' };
const noCreator: CapabilityContext = { userId: null, agentId: 'mcp-system' };

const engine = createHowDoesThisLandEngine(loadModel(), { culture: false });
const ev01 = loadCases().find((c) => c.file === 'eval/ev01.json');
if (!ev01) throw new Error('baseline case eval/ev01.json is missing');
const TEXT = ev01.input.text;
const CTX = ev01.input.ctx;
const RESULT: Assessment = engine.assemble(
  TEXT,
  CTX,
  engine.quickScan(TEXT, CTX),
  ev01.judgeOutputs,
  null
);

const GAPPY = 'We helped [ADD: a client] save [ADD: how much time] a week.';

/** A finished review of ev01. */
function finishedReview(over: Row = {}): Row {
  const review = fake.seed({ status: 'COMPLETED', result: RESULT, context: CTX, ...over });
  const content = fake.contents.find((c) => c.id === review.contentId);
  if (content) content.text = TEXT;
  return review;
}

/** The reply a call that wrote `text` answers. */
function reply(text: string, costUsd: number): AgentStreamReply {
  return {
    text,
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    usage: { input: 4000, output: 900, attempts: 1 },
    costUsd,
    costLogIds: ['cost-x'],
    finishReason: 'stop',
  };
}

/** A call that streams `pieces` at once, writing the cost row a real call writes. */
function streams(pieces: string[], costUsd = 0.04) {
  mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
    for (const piece of pieces) await call.onText(piece);
    fake.addCost(ORG, costUsd, { ...call.costMetadata, frameworkVersion: call.frameworkVersion });
    return reply(pieces.join(''), costUsd);
  });
}

/**
 * A call that writes its first piece, then holds until `finish()` is called,
 * as an editor still writing past the tool's bound.
 */
function slowCall(costUsd = 0.04) {
  let finish: () => void = () => {
    throw new Error('the call has not started');
  };
  const released = new Promise<void>((resolve) => {
    finish = resolve;
  });
  mocks.streamAgent.mockImplementation(async (call: AgentStreamCall) => {
    await call.onText('A sharper ');
    await released;
    await call.onText('draft.');
    fake.addCost(ORG, costUsd, { ...call.costMetadata, frameworkVersion: call.frameworkVersion });
    return reply('A sharper draft.', costUsd);
  });
  return { finish: () => finish() };
}

const charges = () => fake.credits.filter((c) => c.kind === 'CHARGE');

/** What `after()` was handed, settled: the rewrite's run, kept alive past the answer. */
async function handedToAfter(): Promise<void> {
  expect(mocks.after).toHaveBeenCalledTimes(1);
  const handed: unknown = mocks.after.mock.calls[0][0];
  if (!(handed instanceof Promise)) throw new Error('after() was not handed the running rewrite');
  await handed;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  fake = createFakeDb();
  fake.grant(ORG, 1_000_000);
  mocks.engineForVersion.mockResolvedValue({
    version: { id: 'version-1' },
    engine,
    label: 'howdoesthisland@0.5.1',
  });
  mocks.reserve.mockImplementation(
    (_orgId: string, create: (tx: unknown, e: unknown) => Promise<unknown>) =>
      fake.db.$transaction((tx) => create(tx, { estimateUsd: 0.05, basis: 'rewrites' }))
  );
  mocks.verifiedMembership.mockResolvedValue({ role: 'MEMBER' });
  mocks.check.mockReturnValue({ success: true, limit: 10, remaining: 9, reset: 0 });
  // Holds what it is handed; the run has already started, as under a request.
  mocks.after.mockImplementation(() => undefined);
  streams(['A sharper draft.']);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rewrite_draft', () => {
  const tool = new RewriteDraftCapability();
  const run = (args: Record<string, unknown>, context = asCreator) =>
    inOrg(() => tool.execute(tool.validate(args), context));

  it('answers a rewrite that ends within the bound with its draft and placeholders', async () => {
    const review = finishedReview();
    streams([GAPPY]);

    const result = await run({ assessmentId: review.id });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      assessmentId: review.id,
      focus: 'balanced',
      status: 'completed',
      ready: true,
      draft: GAPPY,
      placeholders: [
        { id: 'p1', label: 'a client' },
        { id: 'p2', label: 'how much time' },
      ],
      next: expect.stringContaining('fromRewriteId'),
      error: null,
    });
    expect(result.data?.reviewUrl).toMatch(new RegExp(`/assessments/${String(review.id)}$`));
    // As the route's: the cap keyed on the person, the row theirs, charged once.
    expect(mocks.check).toHaveBeenCalledWith('user:user-1');
    expect(mocks.verifiedMembership).toHaveBeenCalledWith('user-1', ORG, expect.anything());
    expect(fake.rewrites).toEqual([
      expect.objectContaining({ status: 'COMPLETED', createdByUserId: 'user-1' }),
    ]);
    expect(charges()).toEqual([expect.objectContaining({ orgId: ORG, amount: -4 })]);
  });

  it('answers the id and status past the bound, and the rewrite still ends and is charged after', async () => {
    vi.useFakeTimers();
    const review = finishedReview();
    const call = slowCall();

    const answered = run({ assessmentId: review.id });
    await vi.advanceTimersByTimeAsync(MCP_WAIT_MS);
    const result = await answered;

    const [row] = fake.rewrites;
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        id: row.id,
        status: 'running',
        ready: false,
        draft: null,
        placeholders: [],
        next: expect.stringContaining('get_rewrite'),
      }),
    });
    // Answered, and nothing charged yet: the editor is still writing.
    expect(row.status).toBe('RUNNING');
    expect(charges()).toEqual([]);

    call.finish();
    await handedToAfter();

    expect(row).toMatchObject({ status: 'COMPLETED', draft: 'A sharper draft.', costUsd: 0.04 });
    expect(charges()).toEqual([
      expect.objectContaining({ amount: -4, reference: `rewrite:${String(row.id)}` }),
    ]);
    // And get_rewrite reads it once it has.
    const read = await inOrg(() =>
      new GetRewriteCapability().execute({ rewriteId: String(row.id) }, asCreator)
    );
    expect(read.data).toMatchObject({
      status: 'completed',
      ready: true,
      draft: 'A sharper draft.',
    });
  });

  it('fills an earlier rewrite’s placeholders with the answers, as a second call', async () => {
    const review = finishedReview();
    streams([GAPPY]);
    const first = await run({ assessmentId: review.id });
    mocks.streamAgent.mockClear();
    streams(['We helped Leeds Plumbing save [ADD: how much time] a week.']);

    const result = await run({
      assessmentId: review.id,
      fromRewriteId: first.data?.id,
      answers: { p1: 'Leeds Plumbing' },
    });

    const call = mocks.streamAgent.mock.calls[0][0] as AgentStreamCall;
    expect(call.request().prompt).toContain('- [ADD: a client]: Leeds Plumbing');
    expect(result.data).toMatchObject({
      status: 'completed',
      placeholders: [{ id: 'p1', label: 'how much time' }],
    });
    expect(fake.rewrites).toHaveLength(2);
  });

  it('answers a failed rewrite with its reason, and none of what it wrote', async () => {
    const review = finishedReview();
    const { JudgeRunError } = await import('@/lib/app/judges/run-judge');
    mocks.streamAgent.mockImplementation(async (c: AgentStreamCall) => {
      await c.onText('Half a ');
      throw new JudgeRunError('refused', 'The editor declined.');
    });

    const result = await run({ assessmentId: review.id });

    expect(result.data).toMatchObject({
      status: 'failed',
      ready: true,
      draft: null,
      next: null,
      error: 'The editor declined.',
      errorCode: 'refused',
    });
  });

  it('refuses a key with no creator before reading or writing anything', async () => {
    const review = finishedReview();

    const result = await run({ assessmentId: review.id }, noCreator);

    expect(result).toEqual({
      success: false,
      error: { code: 'KEY_HAS_NO_OWNER', message: expect.any(String) },
    });
    expect(mocks.verifiedMembership).not.toHaveBeenCalled();
    expect(fake.rewrites).toEqual([]);
  });

  it('refuses a creator no longer in the workspace before the cap counts them', async () => {
    const review = finishedReview();
    mocks.verifiedMembership.mockResolvedValue({ refused: 'not-a-member' });

    const result = await run({ assessmentId: review.id });

    expect(result.error?.code).toBe('KEY_HAS_NO_OWNER');
    expect(mocks.check).not.toHaveBeenCalled();
    expect(fake.rewrites).toEqual([]);
  });

  it('refuses past the per-person cap before anything is held or written', async () => {
    const review = finishedReview();
    mocks.check.mockReturnValue({ success: false, limit: 10, remaining: 0, reset: 0 });

    const result = await run({ assessmentId: review.id });

    expect(result.error).toEqual({
      code: 'RATE_LIMIT_EXCEEDED',
      message: expect.stringContaining('Too many rewrites'),
    });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(fake.rewrites).toEqual([]);
  });

  it('passes the library’s refusals on with their codes', async () => {
    const running = finishedReview({ status: 'RUNNING', result: null });
    const elsewhere = finishedReview({ orgId: 'org-b' });

    const notFinished = await run({ assessmentId: running.id });
    const notHere = await run({ assessmentId: elsewhere.id });
    const badFocus = await run({ assessmentId: finishedReview().id, focus: 'charisma' });

    expect(notFinished.error?.code).toBe('ASSESSMENT_NOT_REWRITABLE');
    expect(notHere.error?.code).toBe('NOT_FOUND');
    expect(badFocus.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('"charisma" is not a rewrite focus'),
    });
    expect(fake.rewrites).toEqual([]);
  });

  it('keeps which placeholders were answered in the audit trail, never the answers', () => {
    const redacted = tool.redactProvenance(
      tool.validate({ assessmentId: 'a-1', fromRewriteId: 'r-1', answers: { p1: 'Jane Doe' } }),
      { success: true, data: { id: 'r-2', status: 'running' } as never }
    );

    expect(redacted.args).toEqual({
      assessmentId: 'a-1',
      focus: undefined,
      fromRewriteId: 'r-1',
      answers: ['p1'],
    });
    expect(JSON.stringify(redacted)).not.toContain('Jane Doe');
    expect(redacted.resultPreview).toBe(JSON.stringify({ id: 'r-2', status: 'running' }));
  });

  it('reads arguments as sent defensively, as a chat turn’s trace passes them', () => {
    const keyed = tool.redactProvenance(
      { assessmentId: 'a-1', answers: { p2: 'x', AcmeCorp1200: 'y' } },
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'no' } }
    ).args;
    // A key that is not a placeholder id may carry the writer's fact.
    expect(keyed).toMatchObject({ answers: ['p2', '[value]'] });

    const args = tool.redactProvenance({ assessmentId: 'free text here', answers: 'x' } as never, {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'no' },
    }).args;

    expect(args).toEqual({
      assessmentId: '[value]',
      focus: undefined,
      fromRewriteId: undefined,
      answers: undefined,
    });
  });
});

describe('get_rewrite', () => {
  const tool = new GetRewriteCapability();

  it('reads a running rewrite without its partial draft', async () => {
    const review = finishedReview();
    fake.rewrites.push({
      id: 'rw-1',
      orgId: ORG,
      assessmentId: review.id,
      focus: 'balanced',
      status: 'RUNNING',
      draft: 'Half a ',
      error: null,
      errorCode: null,
      modelName: null,
      costUsd: 0,
      createdAt: new Date(),
      completedAt: null,
    });

    const result = await inOrg(() => tool.execute({ rewriteId: 'rw-1' }, asCreator));

    expect(result.data).toMatchObject({ id: 'rw-1', status: 'running', ready: false, draft: null });
  });

  it('is not found for another workspace’s rewrite, or none', async () => {
    const review = finishedReview({ orgId: 'org-b' });
    fake.rewrites.push({
      id: 'rw-b',
      orgId: 'org-b',
      assessmentId: review.id,
      focus: 'balanced',
      status: 'COMPLETED',
      draft: 'Theirs.',
      error: null,
      errorCode: null,
      modelName: null,
      costUsd: 0,
      createdAt: new Date(),
      completedAt: new Date(),
    });

    const theirs = await inOrg(() => tool.execute({ rewriteId: 'rw-b' }, asCreator));
    const none = await inOrg(() => tool.execute({ rewriteId: 'rw-none' }, asCreator));

    expect(theirs.error?.code).toBe('NOT_FOUND');
    expect(none.error?.code).toBe('NOT_FOUND');
  });

  it('throws a failure that is not a refusal, for the dispatcher to log', async () => {
    vi.spyOn(fake.db.rewrite, 'findFirst').mockRejectedValueOnce(new Error('connection lost'));

    await expect(inOrg(() => tool.execute({ rewriteId: 'rw-1' }, asCreator))).rejects.toThrow(
      'connection lost'
    );
  });

  it('previews the id and status of what it read', () => {
    const redacted = tool.redactProvenance(
      { rewriteId: 'rw-1' },
      { success: true, data: { id: 'rw-1', status: 'completed' } as never }
    );

    expect(redacted).toEqual({
      args: { rewriteId: 'rw-1' },
      resultPreview: JSON.stringify({ id: 'rw-1', status: 'completed' }),
    });
  });

  it('keeps only an id-shaped id in the audit trail', () => {
    const redacted = tool.redactProvenance(
      { rewriteId: 'Jane Doe’s draft' },
      {
        success: false,
        error: { code: 'NOT_FOUND', message: 'no' },
      }
    );

    expect(redacted.args).toEqual({ rewriteId: '[value]' });
  });
});

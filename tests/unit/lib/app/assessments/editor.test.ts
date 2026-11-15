/**
 * Tests: runEditor — the editor's summary of a full assessment (t-25).
 *
 * The engine is the real 0.5.1 engine, and the result one it assembled from a
 * baseline case, so a reply goes through the real request builder and
 * post-validator; the shared agent path (`callAgent`), the structured
 * runner, the budget lock and the limiter are real too. Mocked, as in
 * `run-judge.test.ts`: the agent row, the budget read, the cost write, the
 * binding and the provider, a scripted `chat()`.
 *
 * @see lib/app/assessments/editor.ts · lib/app/judges/run-judge.ts (callAgent)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  checkBudget: vi.fn(),
  logCost: vi.fn(),
  resolve: vi.fn(),
  getProvider: vi.fn(),
  isLocalProvider: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: { aiAgent: { findUnique: mocks.findUnique } },
}));
vi.mock('@/lib/orchestration/llm/cost-tracker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/orchestration/llm/cost-tracker')>()),
  checkBudget: mocks.checkBudget,
  logCost: mocks.logCost,
}));
vi.mock('@/lib/orchestration/llm/agent-resolver', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/orchestration/llm/agent-resolver')>()),
  resolveAgentProviderAndModel: mocks.resolve,
}));
vi.mock('@/lib/orchestration/llm/provider-manager', () => ({
  getProvider: mocks.getProvider,
  isLocalProvider: mocks.isLocalProvider,
}));

import {
  editorCostUsd,
  editorRecord,
  editorSkipReason,
  runEditor,
  withEditor,
  type EditorOutcome,
  type RunEditorInput,
} from '@/lib/app/assessments/editor';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import { EDITOR_AGENT_SLUG } from '@/lib/app/judges/agents';
import { APPROVED_MODELS } from '@/lib/app/judges/approved-models';
import type { LlmResponse } from '@/lib/orchestration/llm/types';
import { runAsOrg } from '@/lib/tenancy/context';
import {
  loadCases,
  loadModel,
} from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

const engine = createHowDoesThisLandEngine(loadModel(), { culture: false });
const ev01 = loadCases().find((c) => c.file === 'eval/ev01.json');
if (!ev01) throw new Error('baseline case eval/ev01.json is missing');
const TEXT = ev01.input.text;
const CTX = ev01.input.ctx;
const RESULT = engine.assemble(TEXT, CTX, engine.quickScan(TEXT, CTX), ev01.judgeOutputs, null);
const ORG = 'org-editor';
const JUDGES = ['judge_ethos', 'judge_pathos'];

const change = (recommendation: string) => ({
  recommendation,
  change: 'Do this.',
  why: 'Because.',
});
const goodReply = {
  verdict: 'It lands, mostly.',
  changes: [change('rec_1'), change('rec_2'), change('rec_3')],
  works: ['The opening.'],
};

let agentSeq = 0;
/** A fresh agent id per test, so the real limiter's windows never carry over. */
function agentRow(over: Record<string, unknown> = {}) {
  agentSeq += 1;
  return {
    id: `editor-${agentSeq}`,
    isActive: true,
    provider: '',
    model: '',
    temperature: 0.4,
    maxTokens: 32_768,
    rateLimitRpm: null,
    systemInstructions: 'You are the editor.',
    ...over,
  };
}

const response = (content: string, over: Partial<LlmResponse> = {}): LlmResponse => ({
  content,
  model: 'gpt-5',
  usage: { inputTokens: 3000, outputTokens: 300 },
  finishReason: 'stop',
  ...over,
});

const chat = vi.fn<(...args: unknown[]) => Promise<LlmResponse>>();

const bind = (model: string, provider = 'openai') =>
  mocks.resolve.mockResolvedValue({
    providerSlug: provider,
    model,
    fallbacks: [],
    provenance: { task: 'chat', primary: 'primary', fallbacks: 'system' },
  });

const run = (over: Partial<RunEditorInput> = {}) =>
  runAsOrg(ORG, () =>
    runEditor({
      engine,
      frameworkVersion: 'howdoesthisland@0.5.1',
      text: TEXT,
      ctx: CTX,
      result: RESULT,
      judges: JUDGES,
      answered: 2,
      assessmentId: 'assessment-1',
      userId: 'user-1',
      ...over,
    })
  );

/** The outcome, held to `failed`. */
async function failed(promise: Promise<EditorOutcome>) {
  const outcome = await promise;
  if (outcome.status !== 'failed') throw new Error(`expected failed, got ${outcome.status}`);
  return outcome;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue(agentRow());
  mocks.checkBudget.mockResolvedValue({
    withinBudget: true,
    spent: 0,
    limit: null,
    remaining: null,
  });
  mocks.logCost.mockResolvedValue({ id: 'cost-1', totalCostUsd: 0.02 });
  bind('gpt-5');
  mocks.getProvider.mockResolvedValue({ name: 'openai', isLocal: false, chat });
  mocks.isLocalProvider.mockResolvedValue(false);
});

describe('when the editor is asked', () => {
  it.each([
    ['a quick run (no judges)', [], 0],
    ['a single-judge run', ['judge_ethos'], 1],
  ])('makes no editor call for %s', async (_what, judges, answered) => {
    expect(await run({ judges, answered })).toEqual({
      status: 'skipped',
      reason: 'too_few_judges',
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    expect(mocks.logCost).not.toHaveBeenCalled();
  });

  it('makes no editor call when no judge answered', async () => {
    expect(await run({ answered: 0 })).toEqual({ status: 'skipped', reason: 'no_judge_answered' });
    expect(chat).not.toHaveBeenCalled();
  });

  it('asks for two judges or more', () => {
    expect(editorSkipReason(['a', 'b'], 1)).toBeNull();
    expect(editorSkipReason(['a'], 1)).toBe('too_few_judges');
  });
});

describe('a summary the editor writes', () => {
  it('is the engine’s request, sent strict to the editor’s agent, and comes back validated', async () => {
    chat.mockResolvedValueOnce(response(JSON.stringify(goodReply)));

    const outcome = await run();

    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId_slug: { orgId: ORG, slug: EDITOR_AGENT_SLUG } } })
    );
    const request = engine.buildEditorRequest(TEXT, CTX, RESULT, null);
    const [messages, options] = chat.mock.calls[0];
    expect(messages).toEqual([
      { role: 'system', content: 'You are the editor.' },
      { role: 'user', content: request.prompt },
    ]);
    expect(options).toMatchObject({
      responseFormat: {
        type: 'json_schema',
        name: request.schemaName,
        schema: request.schema,
        strict: true,
      },
      maxTokens: request.maxTokens,
    });
    expect(outcome).toMatchObject({
      status: 'written',
      summary: goodReply,
      drops: [],
      spend: { provider: 'openai', model: 'gpt-5', costUsd: 0.02 },
    });
  });

  it('logs its cost as the editor’s, with the version and the assessment', async () => {
    chat.mockResolvedValueOnce(response(JSON.stringify(goodReply)));
    await run();
    expect(mocks.logCost).toHaveBeenCalledTimes(1);
    const row = mocks.logCost.mock.calls[0][0];
    expect(row).toMatchObject({ userId: 'user-1', model: 'gpt-5', inputTokens: 3000 });
    expect(row.metadata).toEqual({
      editor: 'summary',
      frameworkVersion: 'howdoesthisland@0.5.1',
      assessmentId: 'assessment-1',
      attempts: 1,
    });
  });

  it('drops a change naming a recommendation the result does not have, and records it', async () => {
    const unknown = `rec_${RESULT.recommendations.length + 1}`;
    chat.mockResolvedValueOnce(
      response(
        JSON.stringify({
          ...goodReply,
          changes: [change('rec_1'), change(unknown), change('rec_2')],
        })
      )
    );
    const outcome = await run();
    if (outcome.status !== 'written') throw new Error(outcome.status);
    expect(outcome.summary.changes.map((c) => c.recommendation)).toEqual(['rec_1', 'rec_2']);
    expect(outcome.drops).toContainEqual({
      at: 'changes[1]',
      reason: 'unknown_id',
      detail: unknown,
    });
    expect(editorRecord(outcome)).toMatchObject({ status: 'written', dropped: outcome.drops });
  });

  it('retries a reply that names no recommendation it has, then fails as malformed', async () => {
    const bad = response(JSON.stringify({ ...goodReply, changes: [change('rec_99')] }));
    chat.mockResolvedValueOnce(bad).mockResolvedValueOnce(bad);
    const outcome = await failed(run());
    expect(chat).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({
      code: 'malformed',
      message: "The editor's reply was not usable, twice.",
      spend: { usage: { input: 6000, output: 600, attempts: 2 }, costUsd: 0.02 },
    });
    expect(mocks.logCost.mock.calls[0][0].metadata).toMatchObject({
      editor: 'summary',
      attempts: 2,
      error: 'malformed',
    });
  });
});

describe('the judges’ checks, through the shared path, under the editor role', () => {
  it('refuses a model approved for the judges but not for the editor, before anything is spent', async () => {
    const judgeOnly = APPROVED_MODELS.judge.find(
      (j) => !APPROVED_MODELS.editor.some((e) => e.provider === j.provider && e.model === j.model)
    );
    if (!judgeOnly) throw new Error('every judge model is also an editor model');
    bind(judgeOnly.model, judgeOnly.provider);
    const outcome = await failed(run());
    expect(outcome.code).toBe('model_not_approved');
    expect(outcome.message).toContain(`The editor is bound to "${judgeOnly.model}"`);
    expect(outcome).not.toHaveProperty('spend');
    expect(chat).not.toHaveBeenCalled();
    expect(mocks.checkBudget).not.toHaveBeenCalled();
  });

  it('takes the editor entry’s settings for the bound model', async () => {
    const entry = APPROVED_MODELS.editor.find((e) => e.model === 'gpt-5');
    chat.mockResolvedValueOnce(response(JSON.stringify(goodReply)));
    await run();
    expect(chat.mock.calls[0][1]).toMatchObject({ timeoutMs: entry?.settings.timeoutMs });
  });

  it('refuses an editor over its budget, before the provider', async () => {
    mocks.checkBudget.mockResolvedValue({
      withinBudget: false,
      orgCapExceeded: true,
      spent: 10,
      limit: 10,
      remaining: 0,
    });
    const outcome = await failed(run());
    expect(outcome).toMatchObject({
      code: 'over_budget',
      message: "The editor is over the workspace's monthly budget.",
    });
    expect(chat).not.toHaveBeenCalled();
    expect(mocks.logCost).not.toHaveBeenCalled();
  });

  it('refuses an editor past its own rate limit, before the provider', async () => {
    mocks.findUnique.mockResolvedValue(agentRow({ rateLimitRpm: 1 }));
    chat.mockResolvedValue(response(JSON.stringify(goodReply)));
    expect((await run()).status).toBe('written');
    const outcome = await failed(run());
    expect(outcome).toMatchObject({
      code: 'rate_limited',
      message: 'The editor is over its rate limit.',
    });
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing', null, 'agent_not_found', 'This workspace has no agent for the editor.'],
    [
      'switched off',
      { isActive: false },
      'agent_inactive',
      'The agent for the editor is switched off.',
    ],
  ])('fails when the editor agent is %s', async (_what, row, code, message) => {
    mocks.findUnique.mockResolvedValue(row === null ? null : agentRow(row));
    expect(await failed(run())).toMatchObject({ code, message });
  });

  it('fails as refused on an empty reply, without a retry', async () => {
    chat.mockResolvedValueOnce(response(''));
    expect(await failed(run())).toMatchObject({
      code: 'refused',
      message: 'The provider declined to run the editor.',
    });
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it('lets an error that is not the call’s (the agent read failing) propagate', async () => {
    mocks.findUnique.mockRejectedValue(new Error('database gone'));
    await expect(run()).rejects.toThrow('database gone');
  });
});

describe('the stored record', () => {
  it('marks a failure with its code, model and cost, and carries no summary', () => {
    const outcome: EditorOutcome = {
      status: 'failed',
      code: 'provider_error',
      message: 'x',
      spend: {
        provider: 'openai',
        model: 'gpt-5',
        usage: { input: 1, output: 0, attempts: 1 },
        costUsd: 0.01,
      },
      latencyMs: 1,
    };
    expect(withEditor({ scores: {} }, outcome)).toEqual({
      scores: {},
      editor: { status: 'failed', errorCode: 'provider_error', model: 'gpt-5', costUsd: 0.01 },
    });
    expect(editorCostUsd(outcome)).toBe(0.01);
  });

  it('marks a failure that spent nothing with no model and no cost', () => {
    const outcome: EditorOutcome = {
      status: 'failed',
      code: 'over_budget',
      message: 'x',
      latencyMs: 0,
    };
    expect(editorRecord(outcome)).toEqual({
      status: 'failed',
      errorCode: 'over_budget',
      model: null,
      costUsd: 0,
    });
    expect(editorCostUsd(outcome)).toBe(0);
  });

  it('leaves a result that is not an object as it is', () => {
    expect(withEditor(null, { status: 'skipped', reason: 'too_few_judges' })).toBeNull();
  });
});

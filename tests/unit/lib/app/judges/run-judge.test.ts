/**
 * Tests: runJudge — one judge on its workspace's agent (t-19).
 *
 * The engine is the real 0.5.1 engine, so a reply goes through the real
 * post-validator, and the structured-completion runner, the budget lock and
 * the limiter are real too. Mocked: the agent row, the budget read, the cost
 * write, the binding and the provider, which is a scripted `chat()`.
 *
 * @see lib/app/judges/run-judge.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import { indexModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { JudgeRunError, runJudge, type RunJudgeInput } from '@/lib/app/judges/run-judge';
import { NoEligibleProviderError } from '@/lib/orchestration/llm/agent-resolver';
import { withAgentBudgetLock } from '@/lib/orchestration/llm/budget-mutex';
import { ProviderError } from '@/lib/orchestration/llm/provider';
import type { LlmResponse } from '@/lib/orchestration/llm/types';
import { runAsOrg } from '@/lib/tenancy/context';
import {
  loadCases,
  loadModel,
} from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

const model = loadModel();
const m = indexModel(model);
const engine = createHowDoesThisLandEngine(model, { culture: false });
const ev01 = loadCases().find((c) => c.file === 'eval/ev01.json');
if (!ev01) throw new Error('baseline case eval/ev01.json is missing');
const TEXT = ev01.input.text;
const CTX = ev01.input.ctx;
const IN_TEXT = 'a revolutionary, world-class platform';

const ORG = 'org-judges';
const SLOT = 'judge_ethos';
const ETHOS_DIMS = m.DIMS.filter((d) => d.appeal === 'ethos').map((d) => d.id);

/** An ethos reply the validator keeps whole. */
const ethosReply = (over: Record<string, unknown> = {}) => ({
  appeal: 'ethos',
  summary: 'Two sentences.',
  dimension_scores: ETHOS_DIMS.map((id) => ({ id, score: 2, rationale: 'r' })),
  highlights: [{ quote: IN_TEXT, dimension: 'eth_polish', polarity: 'weakness', note: 'n' }],
  recommendations: [],
  red_flags: [],
  ...over,
});

let agentSeq = 0;
/** A fresh agent id per test, so the real limiter's windows never carry over. */
function agentRow(over: Record<string, unknown> = {}) {
  agentSeq += 1;
  return {
    id: `agent-${agentSeq}`,
    isActive: true,
    provider: '',
    model: '',
    temperature: 0.2,
    maxTokens: 16_384,
    rateLimitRpm: null,
    systemInstructions: 'You are the Ethos judge.',
    ...over,
  };
}

function response(content: string, over: Partial<LlmResponse> = {}): LlmResponse {
  return {
    content,
    model: 'gpt-4.1',
    usage: { inputTokens: 1000, outputTokens: 200 },
    finishReason: 'stop',
    ...over,
  };
}

const chat = vi.fn<(...args: unknown[]) => Promise<LlmResponse>>();

const input = (over: Partial<RunJudgeInput<typeof CTX, unknown>> = {}) => ({
  engine,
  frameworkVersion: 'howdoesthisland@0.5.1',
  text: TEXT,
  ctx: CTX,
  ...over,
});

const run = (over: Partial<RunJudgeInput<typeof CTX, unknown>> = {}, slot = SLOT) =>
  runAsOrg(ORG, () => runJudge(slot, input(over)));

async function refusal(promise: Promise<unknown>): Promise<JudgeRunError> {
  const err: unknown = await promise.then(
    () => null,
    (e: unknown) => e
  );
  if (!(err instanceof JudgeRunError))
    throw new Error(`expected a JudgeRunError, got ${String(err)}`);
  return err;
}

/** The one cost row's params. */
function costRow(): Record<string, unknown> & { metadata: Record<string, unknown> } {
  expect(mocks.logCost).toHaveBeenCalledTimes(1);
  return mocks.logCost.mock.calls[0][0];
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
  mocks.logCost.mockResolvedValue({ id: 'cost-1', totalCostUsd: 0.0036 });
  mocks.resolve.mockResolvedValue({
    providerSlug: 'openai',
    model: 'gpt-4.1',
    fallbacks: [],
    provenance: { task: 'chat', primary: 'primary', fallbacks: 'system' },
  });
  mocks.getProvider.mockResolvedValue({ name: 'openai', isLocal: false, chat });
  mocks.isLocalProvider.mockResolvedValue(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runJudge on a good reply', () => {
  it('sends the engine’s request in strict mode and returns the checked output', async () => {
    chat.mockResolvedValueOnce(response(JSON.stringify(ethosReply())));

    const result = await run({ projectContext: 'We sell bicycles.' });

    const request = engine.buildJudgeRequest(SLOT, TEXT, CTX, 'We sell bicycles.');
    expect(chat).toHaveBeenCalledTimes(1);
    const [messages, options] = chat.mock.calls[0];
    expect(messages).toEqual([
      { role: 'system', content: 'You are the Ethos judge.' },
      { role: 'user', content: request.prompt },
    ]);
    expect(options).toMatchObject({
      model: 'gpt-4.1',
      temperature: 0.2,
      maxTokens: request.maxTokens,
      timeoutMs: request.timeoutMs,
      responseFormat: {
        type: 'json_schema',
        name: request.schemaName,
        schema: request.schema,
        strict: true,
      },
    });
    expect(result).toMatchObject({
      slot: SLOT,
      output: ethosReply(),
      drops: [],
      provider: 'openai',
      model: 'gpt-4.1',
      usage: { input: 1000, output: 200, attempts: 1 },
      costUsd: 0.0036,
      costLogId: 'cost-1',
      finishReason: 'stop',
    });
  });

  it('looks the agent up by the org’s slug for the slot', async () => {
    chat.mockResolvedValueOnce(response(JSON.stringify(ethosReply())));
    await run();
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId_slug: { orgId: ORG, slug: 'hdtl-judge-ethos' } },
      })
    );
  });

  it('logs the cost with the judge, the framework version and the assessment', async () => {
    chat.mockResolvedValueOnce(response(JSON.stringify(ethosReply())));
    const agent = agentRow();
    mocks.findUnique.mockResolvedValue(agent);

    await run({ assessmentId: 'asmt-1', userId: 'user-1' });

    expect(costRow()).toEqual({
      agentId: agent.id,
      provider: 'openai',
      model: 'gpt-4.1',
      inputTokens: 1000,
      outputTokens: 200,
      operation: 'chat',
      isLocal: false,
      userId: 'user-1',
      metadata: {
        judge: SLOT,
        frameworkVersion: 'howdoesthisland@0.5.1',
        assessmentId: 'asmt-1',
        attempts: 1,
      },
    });
  });

  it('carries no assessmentId on an ephemeral run', async () => {
    chat.mockResolvedValueOnce(response(JSON.stringify(ethosReply())));
    await run();
    expect(costRow().metadata).not.toHaveProperty('assessmentId');
  });

  it('never asks for more than the agent’s ceiling', async () => {
    mocks.findUnique.mockResolvedValue(agentRow({ maxTokens: 4096 }));
    chat.mockResolvedValueOnce(response(JSON.stringify(ethosReply())));
    await run();
    expect(chat.mock.calls[0][1]).toMatchObject({ maxTokens: 4096 });
  });

  it('passes the agent’s own binding to the resolver', async () => {
    mocks.findUnique.mockResolvedValue(agentRow({ provider: 'openai', model: 'gpt-5' }));
    chat.mockResolvedValueOnce(response(JSON.stringify(ethosReply())));
    await run();
    expect(mocks.resolve).toHaveBeenCalledWith(
      { provider: 'openai', model: 'gpt-5', fallbackProviders: [] },
      'chat'
    );
  });
});

describe('runJudge refuses before any provider call', () => {
  it('when the binding cannot be resolved, as provider_error, counting nothing', async () => {
    const agent = agentRow({ rateLimitRpm: 1 });
    mocks.findUnique.mockResolvedValue(agent);
    mocks.resolve.mockRejectedValueOnce(new NoEligibleProviderError());

    const err = await refusal(run());

    expect(err.code).toBe('provider_error');
    expect(err.cause).toBeInstanceOf(NoEligibleProviderError);
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    expect(mocks.logCost).not.toHaveBeenCalled();
    // The failed run took no rate-limit slot.
    mocks.findUnique.mockResolvedValue(agent);
    chat.mockResolvedValueOnce(response(JSON.stringify(ethosReply())));
    await expect(run()).resolves.toMatchObject({ slot: SLOT });
  });

  it('when the slot does not run with the culture switch off, before anything is counted', async () => {
    await expect(run({}, 'judge_culture')).rejects.toThrow(
      'does not run with the culture switch off'
    );
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it('when the workspace has no agent for the slot', async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect((await refusal(run())).code).toBe('agent_not_found');
    expect(chat).not.toHaveBeenCalled();
  });

  it('when the agent is switched off', async () => {
    mocks.findUnique.mockResolvedValue(agentRow({ isActive: false }));
    expect((await refusal(run())).code).toBe('agent_inactive');
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it('when the agent is over budget, logging no cost', async () => {
    mocks.checkBudget.mockResolvedValue({
      withinBudget: false,
      spent: 12,
      limit: 10,
      remaining: -2,
    });
    expect((await refusal(run())).code).toBe('over_budget');
    expect(mocks.getProvider).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    expect(mocks.logCost).not.toHaveBeenCalled();
  });
});

describe('runJudge on a local provider', () => {
  it('runs over budget, as chat does, and logs the row as local', async () => {
    mocks.isLocalProvider.mockResolvedValue(true);
    mocks.checkBudget.mockResolvedValue({
      withinBudget: false,
      spent: 12,
      limit: 10,
      remaining: -2,
    });
    chat.mockResolvedValueOnce(response(JSON.stringify(ethosReply())));

    await expect(run()).resolves.toMatchObject({ output: ethosReply() });
    expect(mocks.isLocalProvider).toHaveBeenCalledWith('openai');
    expect(costRow()).toMatchObject({ isLocal: true });
  });

  it('logs a paid provider’s row as not local', async () => {
    chat.mockResolvedValueOnce(response(JSON.stringify(ethosReply())));
    await run();
    expect(costRow()).toMatchObject({ isLocal: false });
  });
});

describe('runJudge holds the budget check under the agent’s budget lock', () => {
  it('waits for a lock someone else holds before reading the budget', async () => {
    const agent = agentRow();
    mocks.findUnique.mockResolvedValue(agent);
    chat.mockResolvedValueOnce(response(JSON.stringify(ethosReply())));

    let release!: () => void;
    const held = withAgentBudgetLock(
      agent.id,
      () => new Promise<void>((resolve) => (release = resolve))
    );
    const judged = run();

    // Let the run get as far as it can while the lock is held.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.findUnique).toHaveBeenCalled();
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();

    release();
    await held;
    await judged;
    expect(mocks.checkBudget).toHaveBeenCalledWith(agent.id);
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

describe('runJudge applies the agent’s rateLimitRpm', () => {
  it('refuses the call past the limit, before the provider', async () => {
    mocks.findUnique.mockResolvedValue(agentRow({ rateLimitRpm: 2 }));
    chat.mockResolvedValue(response(JSON.stringify(ethosReply())));

    await run();
    await run();
    const err = await refusal(run());

    expect(err.code).toBe('rate_limited');
    expect(err.resetAt).toEqual(expect.any(Number));
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('counts each agent apart', async () => {
    chat.mockResolvedValue(response(JSON.stringify(ethosReply())));
    mocks.findUnique.mockResolvedValue(agentRow({ rateLimitRpm: 1 }));
    await run();
    mocks.findUnique.mockResolvedValue(agentRow({ rateLimitRpm: 1 }));
    await expect(run()).resolves.toMatchObject({ slot: SLOT });
  });

  it('does not cap an agent with no rateLimitRpm', async () => {
    chat.mockResolvedValue(response(JSON.stringify(ethosReply())));
    for (let i = 0; i < 15; i++) await run();
    expect(chat).toHaveBeenCalledTimes(15);
  });
});

describe('runJudge on a malformed reply', () => {
  it('retries once, and returns the retry’s reply, counting both attempts’ cost', async () => {
    chat
      .mockResolvedValueOnce(
        response('not json', { usage: { inputTokens: 1000, outputTokens: 50 } })
      )
      .mockResolvedValueOnce(
        response(JSON.stringify(ethosReply()), { usage: { inputTokens: 1100, outputTokens: 210 } })
      );

    const result = await run();

    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][1]).toMatchObject({ temperature: 0 });
    expect(result.output).toEqual(ethosReply());
    expect(result.usage).toEqual({ input: 2100, output: 260, attempts: 2 });
    expect(costRow()).toMatchObject({
      inputTokens: 2100,
      outputTokens: 260,
      metadata: { attempts: 2 },
    });
  });

  it('retries a reply of the wrong shape, which the validator refuses whole', async () => {
    chat
      .mockResolvedValueOnce(response(JSON.stringify({ appeal: 'ethos', summary: 's' })))
      .mockResolvedValueOnce(response(JSON.stringify(ethosReply())));
    await expect(run()).resolves.toMatchObject({ output: ethosReply() });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('fails after the retry, still logging both attempts’ cost', async () => {
    chat
      .mockResolvedValueOnce(response('nope', { usage: { inputTokens: 1000, outputTokens: 40 } }))
      .mockResolvedValueOnce(response('[]', { usage: { inputTokens: 1100, outputTokens: 30 } }));

    const err = await refusal(run());

    expect(err.code).toBe('malformed');
    expect(chat).toHaveBeenCalledTimes(2);
    expect(costRow()).toMatchObject({
      inputTokens: 2100,
      outputTokens: 70,
      metadata: { attempts: 2, error: 'malformed', judge: SLOT },
    });
  });
});

describe('runJudge on a truncated reply', () => {
  it('fails as truncated, logging the usage the provider attached', async () => {
    const usage = { inputTokens: 1000, outputTokens: 8192 };
    chat
      .mockRejectedValueOnce(
        new ProviderError('cut off', { code: 'truncated_no_output', retriable: false, usage })
      )
      .mockRejectedValueOnce(
        new ProviderError('cut off', { code: 'truncated_no_output', retriable: false, usage })
      );

    const err = await refusal(run());

    expect(err.code).toBe('truncated');
    expect(chat).toHaveBeenCalledTimes(2);
    expect(costRow()).toMatchObject({
      inputTokens: 2000,
      outputTokens: 16_384,
      metadata: { attempts: 2, error: 'truncated' },
    });
  });

  it('fails as truncated when the provider returns a cut-off reply', async () => {
    const cut = JSON.stringify(ethosReply()).slice(0, 80);
    chat.mockResolvedValue(response(cut, { finishReason: 'length' }));
    expect((await refusal(run())).code).toBe('truncated');
    expect(costRow()).toMatchObject({ inputTokens: 2000, outputTokens: 400 });
  });
});

describe('runJudge on a provider refusal', () => {
  it('fails as refused on an empty reply (OpenAI’s strict refusal), without a retry', async () => {
    chat.mockResolvedValueOnce(response(''));

    const err = await refusal(run());

    expect(err.code).toBe('refused');
    expect(chat).toHaveBeenCalledTimes(1);
    expect(costRow()).toMatchObject({ metadata: { attempts: 1, error: 'refused' } });
  });

  it('fails as refused on a content-filter finish, without a billed retry', async () => {
    chat.mockResolvedValueOnce(response('', { finishReason: 'error' }));

    const err = await refusal(run());

    expect(err.code).toBe('refused');
    expect(chat).toHaveBeenCalledTimes(1);
    expect(costRow()).toMatchObject({
      inputTokens: 1000,
      outputTokens: 200,
      metadata: { attempts: 1, error: 'refused' },
    });
  });

  it('fails as provider_error when the call itself fails, logging nothing unbilled', async () => {
    chat.mockRejectedValueOnce(
      new ProviderError('401 bad key', { code: 'auth', status: 401, retriable: false })
    );

    const err = await refusal(run());

    expect(err.code).toBe('provider_error');
    expect(err.message).not.toContain('bad key');
    expect(mocks.logCost).not.toHaveBeenCalled();
  });
});

describe('runJudge counts prompt-cache tokens and the service tier', () => {
  it('sums each attempt’s cache reads and writes into the cost row, with the tier', async () => {
    chat
      .mockResolvedValueOnce(
        response('nope', {
          usage: { inputTokens: 1000, outputTokens: 40, cacheReadTokens: 600, serviceTier: 'flex' },
        })
      )
      .mockResolvedValueOnce(
        response(JSON.stringify(ethosReply()), {
          usage: {
            inputTokens: 1100,
            outputTokens: 200,
            cacheReadTokens: 700,
            cacheWriteTokens: 50,
            serviceTier: 'flex',
          },
        })
      );

    await run();

    expect(costRow()).toMatchObject({
      inputTokens: 2100,
      outputTokens: 240,
      cacheReadTokens: 1300,
      cacheWriteTokens: 50,
      serviceTier: 'flex',
    });
  });

  it('names no tier when the attempts were served at different ones', async () => {
    chat
      .mockResolvedValueOnce(
        response('nope', {
          usage: { inputTokens: 1000, outputTokens: 40, serviceTier: 'priority' },
        })
      )
      .mockResolvedValueOnce(response(JSON.stringify(ethosReply())));
    await run();
    expect(costRow()).not.toHaveProperty('serviceTier');
  });

  it('leaves them off a row whose attempts reported none', async () => {
    chat.mockResolvedValueOnce(response(JSON.stringify(ethosReply())));
    await run();
    const row = costRow();
    expect(row).not.toHaveProperty('cacheReadTokens');
    expect(row).not.toHaveProperty('cacheWriteTokens');
    expect(row).not.toHaveProperty('serviceTier');
  });
});

describe('runJudge on a failure that is not a ProviderError', () => {
  it('fails as provider_error, e.g. a timeout abort, keeping the cause', async () => {
    const abort = new DOMException('The operation timed out.', 'TimeoutError');
    chat.mockRejectedValueOnce(abort);

    const err = await refusal(run());

    expect(err.code).toBe('provider_error');
    expect(err.cause).toBe(abort);
    expect(mocks.logCost).not.toHaveBeenCalled();
  });
});

describe('runJudge passes a reply through the engine’s validator', () => {
  it('drops unknown ids and clamps out-of-range scores, returning the drop record', async () => {
    const [first, ...rest] = ETHOS_DIMS;
    chat.mockResolvedValueOnce(
      response(
        JSON.stringify(
          ethosReply({
            dimension_scores: [
              { id: first, score: 99, rationale: 'r' },
              ...rest.map((id) => ({ id, score: 2, rationale: 'r' })),
              { id: 'eth_nope', score: 2, rationale: 'r' },
            ],
          })
        )
      )
    );

    const { output, drops } = await run();

    expect(drops.map((d) => d.reason).sort()).toEqual(['out_of_range', 'unknown_id']);
    const scores = (output as { dimension_scores: { id: string; score: number }[] })
      .dimension_scores;
    expect(scores.map((s) => s.id)).toEqual(ETHOS_DIMS);
    expect(scores[0].score).toBeLessThan(99);
  });
});

describe('runJudge when the cost write fails', () => {
  it('returns the reply with no row id when logCost writes nothing', async () => {
    chat.mockResolvedValueOnce(response(JSON.stringify(ethosReply())));
    mocks.logCost.mockResolvedValueOnce(null);
    await expect(run()).resolves.toMatchObject({ costLogId: null, costUsd: 0 });
  });

  it('still returns the reply', async () => {
    chat.mockResolvedValueOnce(response(JSON.stringify(ethosReply())));
    mocks.logCost.mockRejectedValueOnce(new Error('db down'));
    await expect(run()).resolves.toMatchObject({ costLogId: null, costUsd: 0 });
  });
});

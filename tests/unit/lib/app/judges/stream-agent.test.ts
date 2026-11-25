/**
 * Tests: streamAgent — one streamed call to an app agent, the editor's
 * rewrite (t-81).
 *
 * The budget lock and the limiter are real. Mocked: the agent row, the
 * budget read, the cost write, the binding and the provider, which is a
 * scripted `chatStream()`.
 *
 * @see lib/app/judges/run-judge.ts
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
// The editor's model priced at $3 in and $15 out per million tokens, so a
// ceiling's price is checked against arithmetic, not against `calculateCost`.
vi.mock('@/lib/orchestration/llm/model-registry', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/orchestration/llm/model-registry')>();
  return {
    ...real,
    getModel: (id: string) =>
      id === 'claude-sonnet-5-5'
        ? {
            id,
            name: 'Sonnet',
            provider: 'anthropic',
            tier: 'mid',
            inputCostPerMillion: 3,
            outputCostPerMillion: 15,
            maxContext: 200_000,
            supportsTools: true,
          }
        : real.getModel(id),
  };
});
vi.mock('@/lib/orchestration/llm/provider-manager', () => ({
  getProvider: mocks.getProvider,
  isLocalProvider: mocks.isLocalProvider,
}));

import {
  JudgeRunError,
  recordStoppedStream,
  streamAgent,
  streamCeilingUsd,
  type AgentStreamCall,
  type StreamStart,
} from '@/lib/app/judges/run-judge';
import { tokeniserForModel } from '@/lib/orchestration/llm/tokeniser';
import { ProviderError } from '@/lib/orchestration/llm/provider';
import type { StreamChunk } from '@/lib/orchestration/llm/types';
import { currentPrivacyScope, type PrivacyScope } from '@/lib/orchestration/privacy/scope';
import { runAsOrg } from '@/lib/tenancy/context';

const ORG = 'org-rewrites';
let agentSeq = 0;

function agentRow(over: Record<string, unknown> = {}) {
  agentSeq += 1;
  return {
    id: `agent-${agentSeq}`,
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

const DONE: StreamChunk = {
  type: 'done',
  usage: { inputTokens: 3000, outputTokens: 800 },
  finishReason: 'stop',
};

/** A `chatStream` that yields `chunks`, then throws `fail` if given. */
function scripted(chunks: StreamChunk[], fail?: Error) {
  return vi.fn(async function* () {
    for (const chunk of chunks) yield chunk;
    if (fail) throw fail;
  });
}

let chatStream = scripted([]);

function call(over: Partial<AgentStreamCall> = {}): AgentStreamCall {
  return {
    agentSlug: 'hdtl-editor',
    role: 'editor',
    name: 'editor',
    target: 'the editor',
    request: () => ({ prompt: 'Rewrite this.', maxTokens: 12_000, reasoningEffort: 'low' }),
    onText: vi.fn(),
    costMetadata: { editor: 'rewrite', rewriteId: 'rw-1' },
    frameworkVersion: 'howdoesthisland@0.5.2',
    userId: 'user-1',
    ...over,
  };
}

const run = (over: Partial<AgentStreamCall> = {}) => runAsOrg(ORG, () => streamAgent(call(over)));

async function refusal(promise: Promise<unknown>): Promise<JudgeRunError> {
  const err: unknown = await promise.then(
    () => null,
    (e: unknown) => e
  );
  if (!(err instanceof JudgeRunError))
    throw new Error(`expected a JudgeRunError, got ${String(err)}`);
  return err;
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
  mocks.logCost.mockResolvedValue({ id: 'cost-1', totalCostUsd: 0.021 });
  mocks.resolve.mockResolvedValue({
    providerSlug: 'anthropic',
    model: 'claude-sonnet-5-5',
    fallbacks: [],
    provenance: { task: 'chat', primary: 'primary', fallbacks: 'system' },
  });
  chatStream = scripted([
    { type: 'text', content: 'A better ' },
    { type: 'text', content: 'draft.' },
    DONE,
  ]);
  mocks.getProvider.mockImplementation(async () => ({
    name: 'anthropic',
    isLocal: false,
    chatStream,
  }));
  mocks.isLocalProvider.mockResolvedValue(false);
});

describe('streamAgent on a good reply', () => {
  it('hands each piece to onText in order, and answers the whole text with its cost', async () => {
    const onText = vi.fn();
    const reply = await run({ onText });

    expect(onText.mock.calls.map(([t]) => t)).toEqual(['A better ', 'draft.']);
    expect(reply).toEqual({
      text: 'A better draft.',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      usage: { input: 3000, output: 800, attempts: 1 },
      costUsd: 0.021,
      costLogIds: ['cost-1'],
      finishReason: 'stop',
    });
  });

  it('sends the agent’s instructions and the prompt, with the request’s effort and the lowest ceiling', async () => {
    await run();

    expect(chatStream).toHaveBeenCalledTimes(1);
    const [messages, options] = chatStream.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(messages).toEqual([
      { role: 'system', content: 'You are the editor.' },
      { role: 'user', content: 'Rewrite this.' },
    ]);
    // The request's 12,000 is under the approved entry's and the agent's 32,768.
    expect(options).toMatchObject({
      model: 'claude-sonnet-5-5',
      temperature: 0.4,
      maxTokens: 12_000,
      reasoningEffort: 'low',
      timeoutMs: 300_000,
    });
  });

  it('takes the approved entry’s effort when the request names none', async () => {
    await run({ request: () => ({ prompt: 'Rewrite this.', maxTokens: 12_000 }) });
    const [, options] = chatStream.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(options.reasoningEffort).toBe('medium');
  });

  it('writes one cost row tagged as the caller asked, with no assessmentId', async () => {
    await run();

    expect(mocks.logCost).toHaveBeenCalledTimes(1);
    const row = mocks.logCost.mock.calls[0][0];
    expect(row).toMatchObject({
      userId: 'user-1',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      inputTokens: 3000,
      outputTokens: 800,
      metadata: {
        editor: 'rewrite',
        rewriteId: 'rw-1',
        frameworkVersion: 'howdoesthisland@0.5.2',
        attempts: 1,
      },
    });
    expect(row.metadata).not.toHaveProperty('assessmentId');
  });

  it('reads the stream inside the agent’s privacy scope', async () => {
    let scope: PrivacyScope | undefined;
    chatStream = vi.fn(async function* () {
      scope = currentPrivacyScope();
      yield { type: 'text', content: 'Text.' };
      yield DONE;
    });
    const agent = agentRow();
    mocks.findUnique.mockResolvedValue(agent);

    await run();

    expect(scope).toBeDefined();
    expect(JSON.stringify(scope)).toContain(agent.id);
  });

  it('waits for onText before reading the next piece', async () => {
    const order: string[] = [];
    chatStream = vi.fn(async function* () {
      order.push('yield 1');
      yield { type: 'text', content: 'one' };
      order.push('yield 2');
      yield { type: 'text', content: 'two' };
      yield DONE;
    });
    await run({
      onText: async (t) => {
        await Promise.resolve();
        order.push(`saved ${t}`);
      },
    });
    expect(order).toEqual(['yield 1', 'saved one', 'yield 2', 'saved two']);
  });
});

describe('streamAgent refusals before anything is spent', () => {
  it('refuses an agent the workspace does not have, or has switched off', async () => {
    mocks.findUnique.mockResolvedValueOnce(null);
    expect((await refusal(run())).code).toBe('agent_not_found');
    mocks.findUnique.mockResolvedValueOnce(agentRow({ isActive: false }));
    expect((await refusal(run())).code).toBe('agent_inactive');
    expect(chatStream).not.toHaveBeenCalled();
    expect(mocks.logCost).not.toHaveBeenCalled();
  });

  it('refuses a model not approved for the editor', async () => {
    mocks.resolve.mockResolvedValueOnce({
      providerSlug: 'openai',
      model: 'gpt-4o',
      fallbacks: [],
      provenance: { task: 'chat', primary: 'primary', fallbacks: 'system' },
    });
    expect((await refusal(run())).code).toBe('model_not_approved');
    expect(chatStream).not.toHaveBeenCalled();
  });

  it('refuses over budget, naming the cap', async () => {
    mocks.checkBudget.mockResolvedValueOnce({ withinBudget: false, orgCapExceeded: true });
    const err = await refusal(run());
    expect(err.code).toBe('over_budget');
    expect(err.cap).toBe('org');
    expect(chatStream).not.toHaveBeenCalled();
  });

  it('refuses past the agent’s own rate limit', async () => {
    const agent = agentRow({ rateLimitRpm: 1 });
    mocks.findUnique.mockResolvedValue(agent);
    await run();
    expect((await refusal(run())).code).toBe('rate_limited');
  });

  it('lets a request builder’s throw through, before anything is resolved', async () => {
    const boom = new Error('bad focus');
    await expect(
      run({
        request: () => {
          throw boom;
        },
      })
    ).rejects.toBe(boom);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});

describe('streamAgent failures after the call', () => {
  it('is refused on a content-filter finish, and still records what was billed', async () => {
    chatStream = scripted([
      { type: 'text', content: 'Part' },
      { ...DONE, finishReason: 'error' },
    ]);
    const err = await refusal(run());
    expect(err.code).toBe('refused');
    expect(err.spend?.costUsd).toBe(0.021);
    expect(mocks.logCost.mock.calls[0][0].metadata.error).toBe('refused');
  });

  it('is truncated, not refused, when it reached its ceiling having written nothing', async () => {
    chatStream = scripted([{ ...DONE, finishReason: 'length' }]);
    expect((await refusal(run())).code).toBe('truncated');
  });

  it('stops part-way, not refused, when the stream ends with no terminal chunk and no text', async () => {
    chatStream = scripted([]);
    const err = await refusal(run());
    expect(err).toMatchObject({
      code: 'provider_error',
      message: "The editor's reply stopped part-way.",
    });
  });

  it('is refused on an empty reply', async () => {
    chatStream = scripted([{ type: 'text', content: '   ' }, DONE]);
    expect((await refusal(run())).code).toBe('refused');
  });

  it('is truncated when cut off at its ceiling', async () => {
    chatStream = scripted([
      { type: 'text', content: 'A long draft that' },
      { ...DONE, finishReason: 'length' },
    ]);
    const err = await refusal(run());
    expect(err.code).toBe('truncated');
    expect(err.spend?.usage.output).toBe(800);
  });

  it('fails when the stream ends with no terminal chunk, recording an estimate of what it was billed', async () => {
    chatStream = scripted([{ type: 'text', content: 'A draft that' }]);
    const err = await refusal(run());
    expect(err.code).toBe('provider_error');
    const row = mocks.logCost.mock.calls[0][0];
    // The instructions and prompt in, the text streamed out, counted.
    expect(row.inputTokens).toBeGreaterThan(0);
    expect(row.outputTokens).toBeGreaterThan(0);
    expect(row.metadata).toMatchObject({ estimated: true, error: 'provider_error' });
    expect(err.spend?.costUsd).toBe(0.021);
  });

  it('records the provider’s usage, not an estimate, when it reported one', async () => {
    await run();
    expect(mocks.logCost.mock.calls[0][0].metadata).not.toHaveProperty('estimated');
  });

  it('records nothing for a call stopped before the provider answered', async () => {
    chatStream = scripted([], new ProviderError('request aborted', { code: 'aborted' }));
    const err = await refusal(run());
    expect(err.code).toBe('provider_error');
    expect(mocks.logCost).not.toHaveBeenCalled();
    expect(err.spend).toBeUndefined();
  });

  it('records the usage a provider error carries', async () => {
    chatStream = scripted(
      [{ type: 'text', content: 'Half' }],
      new ProviderError('reset', {
        code: 'provider_error',
        usage: { inputTokens: 3000, outputTokens: 100 },
      })
    );
    const err = await refusal(run());
    expect(err.code).toBe('provider_error');
    expect(mocks.logCost.mock.calls[0][0]).toMatchObject({ inputTokens: 3000, outputTokens: 100 });
  });

  it('stops when onText throws, and records an estimate of what was billed by then', async () => {
    chatStream = scripted([{ type: 'text', content: 'one' }, { ...DONE }]);
    const err = await refusal(
      run({
        onText: () => {
          throw new Error('save failed');
        },
      })
    );
    expect(err.code).toBe('provider_error');
    // The terminal chunk was never read, so its usage is estimated.
    expect(mocks.logCost.mock.calls[0][0].metadata).toMatchObject({ estimated: true });
    expect(err.spend?.costUsd).toBe(0.021);
  });

  it('records an estimate for a call its signal stopped part-way', async () => {
    const controller = new AbortController();
    chatStream = vi.fn(async function* () {
      yield { type: 'text', content: 'Half a draft' } satisfies StreamChunk;
      controller.abort();
      throw new ProviderError('request aborted', { code: 'aborted' });
    });
    const err = await refusal(run({ signal: controller.signal }));
    expect(err.code).toBe('provider_error');
    expect(mocks.logCost.mock.calls[0][0]).toMatchObject({
      outputTokens: expect.any(Number),
      metadata: expect.objectContaining({ estimated: true, rewriteId: 'rw-1' }),
    });
  });

  it('passes the caller’s signal to the provider', async () => {
    const controller = new AbortController();
    await run({ signal: controller.signal });
    const [, options] = chatStream.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(options.signal).toBe(controller.signal);
  });
});

/** `parts` as the editor's model counts them. */
const tokens = (...parts: string[]) =>
  parts.reduce((sum, part) => sum + tokeniserForModel('claude-sonnet-5-5').count(part), 0);

describe('streamAgent onStart (t-85)', () => {
  it('hands over what the call is priced from, before the provider is asked', async () => {
    const seen: string[] = [];
    const onStart = vi.fn(async () => {
      seen.push(`start, provider asked ${mocks.getProvider.mock.calls.length} times`);
    });
    await run({ onStart });

    expect(seen).toEqual(['start, provider asked 0 times']);
    expect(onStart).toHaveBeenCalledWith({
      agentId: expect.stringMatching(/^agent-/),
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      isLocal: false,
      promptTokens: tokens('You are the editor.', 'Rewrite this.'),
    });
  });

  it('is not called for a call refused before anything is spent', async () => {
    mocks.findUnique.mockResolvedValue(agentRow({ isActive: false }));
    const onStart = vi.fn(async () => undefined);
    await refusal(run({ onStart }));
    expect(onStart).not.toHaveBeenCalled();
  });

  it('lets its throw through, before the provider is asked or anything recorded', async () => {
    const err = await run({
      onStart: async () => {
        throw new Error('could not keep it');
      },
    }).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toEqual(new Error('could not keep it'));
    expect(chatStream).not.toHaveBeenCalled();
    expect(mocks.logCost).not.toHaveBeenCalled();
  });
});

describe('recordStoppedStream (t-85)', () => {
  const START: StreamStart = {
    agentId: 'agent-editor',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    isLocal: false,
    promptTokens: 5_000,
  };
  const tags = {
    costMetadata: { editor: 'rewrite', rewriteId: 'rw-9' },
    frameworkVersion: 'howdoesthisland@0.5.2',
    userId: 'user-1',
  };

  it('writes the row a call stopped there would have: the kept prompt count and the reply, estimated', async () => {
    const reply = 'A draft that got this far before the process died.';
    const row = await runAsOrg(ORG, () => recordStoppedStream(START, reply, tags, 'lost'));

    expect(row).toEqual({ id: 'cost-1', totalCostUsd: 0.021 });
    expect(mocks.logCost).toHaveBeenCalledTimes(1);
    expect(mocks.logCost.mock.calls[0][0]).toEqual({
      agentId: 'agent-editor',
      userId: 'user-1',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      inputTokens: 5_000,
      outputTokens: tokens(reply),
      operation: 'chat',
      isLocal: false,
      metadata: {
        editor: 'rewrite',
        rewriteId: 'rw-9',
        frameworkVersion: 'howdoesthisland@0.5.2',
        attempts: 1,
        error: 'lost',
        estimated: true,
      },
    });
    expect(tokens(reply)).toBeGreaterThan(0);
  });

  it('writes nothing for an empty reply: the provider may not have answered', async () => {
    expect(await recordStoppedStream(START, '', tags, 'lost')).toBeNull();
    expect(mocks.logCost).not.toHaveBeenCalled();
  });

  it('answers null when the write fails', async () => {
    mocks.logCost.mockResolvedValue(null);
    expect(await recordStoppedStream(START, 'Some.', tags, 'lost')).toBeNull();
  });
});

describe('streamCeilingUsd (t-86)', () => {
  const ceiling = (maxTokens = 12_000, prompt = 'Rewrite this.') =>
    runAsOrg(ORG, () => streamCeilingUsd(call(), { prompt, maxTokens }));

  /** The price of `input` tokens in and `output` out, at $3 and $15 a million. */
  const price = (input: number, output: number) => (input * 3 + output * 15) / 1_000_000;

  it('prices the prompt and the whole output ceiling at the agent’s binding', async () => {
    const usd = await ceiling();
    expect(usd).toBeCloseTo(price(tokens('You are the editor.', 'Rewrite this.'), 12_000), 12);
    // The ceiling is most of it: 12,000 out at $15 a million is $0.18.
    expect(usd).toBeGreaterThan(0.18);
  });

  it('scales with the request: a longer text’s ceiling costs more', async () => {
    const short = await ceiling(8_192, 'Short.');
    const long = await ceiling(20_000, 'Long. '.repeat(2_000));
    expect(long).toBeGreaterThan(short ?? Infinity);
  });

  it('holds the ceiling to the agent’s own, as the call does', async () => {
    mocks.findUnique.mockResolvedValue(agentRow({ maxTokens: 4_000 }));
    expect(await ceiling(12_000)).toBeCloseTo(
      price(tokens('You are the editor.', 'Rewrite this.'), 4_000),
      12
    );
  });

  it('is 0 for a local model', async () => {
    mocks.isLocalProvider.mockResolvedValue(true);
    expect(await ceiling()).toBe(0);
  });

  it('is null for a call that would be refused before it spent', async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await ceiling()).toBeNull();
    mocks.findUnique.mockResolvedValue(agentRow({ isActive: false }));
    expect(await ceiling()).toBeNull();
    mocks.findUnique.mockResolvedValue(agentRow());
    mocks.resolve.mockResolvedValue({
      providerSlug: 'anthropic',
      model: 'claude-not-approved',
      fallbacks: [],
      provenance: { task: 'chat', primary: 'primary', fallbacks: 'system' },
    });
    expect(await ceiling()).toBeNull();
  });

  it('checks no budget and takes no rate-limit slot', async () => {
    mocks.findUnique.mockResolvedValue(agentRow({ rateLimitRpm: 1 }));
    await ceiling();
    await ceiling();
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    // The agent's one call a minute is still there for the call itself.
    await run();
    expect(chatStream).toHaveBeenCalledTimes(1);
  });
});

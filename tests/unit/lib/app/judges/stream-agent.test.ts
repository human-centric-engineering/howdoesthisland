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
vi.mock('@/lib/orchestration/llm/provider-manager', () => ({
  getProvider: mocks.getProvider,
  isLocalProvider: mocks.isLocalProvider,
}));

import { JudgeRunError, streamAgent, type AgentStreamCall } from '@/lib/app/judges/run-judge';
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

  it('fails when the stream ends with no terminal chunk, recording nothing billed', async () => {
    chatStream = scripted([{ type: 'text', content: 'A draft that' }]);
    const err = await refusal(run());
    expect(err.code).toBe('provider_error');
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

  it('stops when onText throws, and records what was billed by then', async () => {
    chatStream = scripted([{ type: 'text', content: 'one' }, { ...DONE }]);
    const err = await refusal(
      run({
        onText: () => {
          throw new Error('save failed');
        },
      })
    );
    expect(err.code).toBe('provider_error');
    // The terminal chunk was never read, so nothing was billed on this path.
    expect(err.spend).toBeUndefined();
  });

  it('passes the caller’s signal to the provider', async () => {
    const controller = new AbortController();
    await run({ signal: controller.signal });
    const [, options] = chatStream.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(options.signal).toBe(controller.signal);
  });
});

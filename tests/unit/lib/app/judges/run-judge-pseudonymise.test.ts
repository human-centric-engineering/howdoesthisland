/**
 * Tests: a judge run under `pseudonymise` (t-22).
 *
 * Since Sunrise 0.19.0 the privacy stage on the provider-manager Proxy can
 * replace personal data with placeholders before a call and restore them in
 * the reply. A judge quotes the text, and the engine drops any quote it cannot
 * find in the text, so a quote that came back as `[EMAIL_1]` would be dropped.
 * This proves it comes back restored first: through the real Proxy and the
 * real stage, the vendor sees only placeholders, and the quote it writes with
 * one survives post-validation.
 *
 * Mocked: Prisma, the settings (the install's mode is `pseudonymise`), the
 * budget and cost writes, and the binding. The provider is a fake registered
 * on the real provider manager, so the call goes through the Proxy.
 *
 * @see lib/app/judges/run-judge.ts · tests/unit/lib/orchestration/llm/provider-manager.privacy.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmProvider } from '@/lib/orchestration/llm/provider';

const mocks = vi.hoisted(() => ({
  agentFindUnique: vi.fn(),
  checkBudget: vi.fn(),
  logCost: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    aiProviderConfig: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    aiAgent: { findUnique: mocks.agentFindUnique },
    org: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock('@/lib/orchestration/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/orchestration/settings')>()),
  getOrchestrationSettings: vi.fn(async () => ({
    globalMonthlyBudgetUsd: null,
    privacyMode: 'pseudonymise',
    privacyIgnoredEntityTypes: ['DATE', 'LOCATION'],
    privacyProtectLocalProviders: false,
  })),
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
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import { indexModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { runJudge } from '@/lib/app/judges/run-judge';
import { clearCache, registerProviderInstance } from '@/lib/orchestration/llm/provider-manager';
import { runAsOrg } from '@/lib/tenancy/context';
import { __resetPrivacyAdaptersForTests } from '@/lib/privacy/adapters/registry';
import {
  loadCases,
  loadModel,
} from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

const model = loadModel();
const m = indexModel(model);
const engine = createHowDoesThisLandEngine(model, { culture: false });
const SLOT = 'judge_ethos';
const EMAIL = 'priya.sharma@example.com';
const TEXT = `Our bikes are built in Leeds by people who ride them. Write to ${EMAIL} for a test ride.`;
const ev01 = loadCases().find((c) => c.file === 'eval/ev01.json');
if (!ev01) throw new Error('baseline case eval/ev01.json is missing');
const CTX = ev01.input.ctx;

/** A vendor that quotes the text back, with the placeholder it was sent for the email. */
function quotingVendor() {
  const received: unknown[][] = [];
  const provider = {
    name: 'openai',
    isLocal: false,
    chat: vi.fn(async (...args: unknown[]) => {
      received.push(args);
      const placeholder = /\[EMAIL_\d+\]/.exec(JSON.stringify(args))?.[0];
      if (!placeholder) throw new Error('the request carried no email placeholder');
      const reply = {
        appeal: 'ethos',
        summary: 'Plain and specific.',
        dimension_scores: m.DIMS.filter((d) => d.appeal === 'ethos').map((d) => ({
          id: d.id,
          score: 3,
          rationale: 'r',
        })),
        highlights: [
          {
            quote: `Write to ${placeholder} for a test ride.`,
            dimension: 'eth_polish',
            polarity: 'strength',
            note: 'A direct offer.',
          },
        ],
        recommendations: [],
        red_flags: [],
      };
      return {
        content: JSON.stringify(reply),
        model: 'gpt-4.1',
        usage: { inputTokens: 100, outputTokens: 50 },
        finishReason: 'stop',
      };
    }),
    chatStream: vi.fn(),
    embed: vi.fn(),
    embedMany: vi.fn(),
    transcribe: vi.fn(),
    listModels: vi.fn(async () => []),
    testConnection: vi.fn(async () => ({ ok: true, models: [] })),
  } as unknown as LlmProvider;
  return { provider, received };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
  __resetPrivacyAdaptersForTests();
  // runJudge's lookup is by org and slug; the stage's (the agent's own mode) is by id.
  mocks.agentFindUnique.mockImplementation(async (args: { where: Record<string, unknown> }) =>
    'orgId_slug' in args.where
      ? {
          id: 'agent-ethos',
          isActive: true,
          provider: 'openai',
          model: 'gpt-4.1',
          temperature: 0.2,
          maxTokens: 16_384,
          rateLimitRpm: null,
          systemInstructions: 'You are the Ethos judge.',
        }
      : null
  );
  mocks.checkBudget.mockResolvedValue({
    withinBudget: true,
    spent: 0,
    limit: null,
    remaining: null,
  });
  mocks.logCost.mockResolvedValue({ id: 'cost-1', totalCostUsd: 0.001 });
  mocks.resolve.mockResolvedValue({
    providerSlug: 'openai',
    model: 'gpt-4.1',
    fallbacks: [],
    provenance: { task: 'chat', primary: 'primary', fallbacks: 'system' },
  });
});

describe('runJudge under pseudonymise', () => {
  it('sends the judge placeholders only, and keeps the quote it wrote with one, restored', async () => {
    const { provider, received } = quotingVendor();
    registerProviderInstance('openai', provider);

    const run = await runAsOrg('org-judges', () =>
      runJudge(SLOT, { engine, frameworkVersion: 'howdoesthisland@0.5.1', text: TEXT, ctx: CTX })
    );

    expect(received).toHaveLength(1);
    expect(JSON.stringify(received)).not.toContain(EMAIL);
    expect(run.output.highlights).toEqual([
      expect.objectContaining({ quote: `Write to ${EMAIL} for a test ride.` }),
    ]);
    expect(run.drops.filter((d) => d.at.startsWith('highlights'))).toEqual([]);
  });
});

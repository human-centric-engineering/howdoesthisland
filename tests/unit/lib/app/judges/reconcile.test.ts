/**
 * Tests: the judge and editor agents through the REAL reconcile (t-17).
 *
 * A new workspace gets all ten, bound to OpenAI on the interim models, and a
 * second reconcile writes nothing. Driven, as core's own reconcile tests are,
 * against an in-memory stand-in for the delegates the reconcile touches, so
 * "writes nothing" is a fact about state rather than about what a mock was
 * told to answer. Only the reconcile's list of definitions is narrowed, to
 * ours: core's agents have their own tests, and need capabilities and
 * knowledge this stand-in does not hold.
 *
 * @see lib/app/judges/agents.ts
 * @see lib/orchestration/agents/reconcile-platform-agents.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const mockEnv = vi.hoisted(() => ({ TENANCY_MODE: 'multi' }));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/orchestration/capabilities/dispatcher', () => ({
  capabilityDispatcher: { clearCache: vi.fn() },
}));
vi.mock('@/lib/orchestration/knowledge/resolveAgentDocumentAccess', () => ({
  invalidateAgentAccess: vi.fn(),
}));

vi.mock('@/lib/orchestration/agents/platform-agents', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/orchestration/agents/platform-agents')>();
  return {
    ...actual,
    platformAgentsForOrg: (orgId: string) =>
      actual.platformAgentsForOrg(orgId).filter((d) => d.slug.startsWith('hdtl-')),
  };
});

const fake = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: string };
  const state = {
    seq: 0,
    orgs: new Map<string, { id: string; settings: unknown }>(),
    agents: [] as Row[],
    versions: [] as Row[],
    providers: [] as Row[],
    models: [] as Row[],
    writes: [] as string[],
    orgOf: () => 'NO-CONTEXT',
  };
  const write = (name: string) => state.writes.push(name);
  const unjson = (v: unknown) => (v === Prisma.JsonNull || v === Prisma.DbNull ? null : v);
  const AGENT_DEFAULTS = {
    fallbackProviders: [],
    bindingOwner: null,
    providerConfig: null,
    monthlyBudgetUsd: null,
    maxCostPerTurnUsd: null,
    rateLimitRpm: null,
    retentionDays: null,
    systemInstructionsHistory: [],
    deletedAt: null,
    lastActiveAt: null,
    isSystem: false,
  };
  const db = {
    user: { findFirst: async () => ({ id: 'service-account' }) },
    org: {
      findUnique: async ({ where }: { where: { id: string } }) => state.orgs.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { settings: unknown } }) => {
        write('org.update');
        const org = state.orgs.get(where.id)!;
        org.settings = unjson(data.settings);
        return org;
      },
    },
    aiAgent: {
      findMany: async ({ where }: { where: { orgId: string; slug: { in: string[] } } }) =>
        state.agents
          .filter((a) => a.orgId === where.orgId && where.slug.in.includes(a.slug as string))
          .map((a) => ({ ...a, capabilities: [], grantedTags: [], grantedDocuments: [] })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        write('aiAgent.create');
        const row: Row = {
          ...AGENT_DEFAULTS,
          ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, unjson(v)])),
          id: `agent-${++state.seq}`,
          orgId: state.orgOf(),
          createdAt: new Date(),
          updatedAt: state.seq,
        };
        state.agents.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        write('aiAgent.update');
        const row = state.agents.find((a) => a.id === where.id)!;
        for (const [k, v] of Object.entries(data)) row[k] = unjson(v);
        return row;
      },
    },
    aiCapability: { findMany: async () => [] },
    knowledgeTag: { findMany: async () => [] },
    aiAgentCapability: {
      createMany: async () => (write('aiAgentCapability.createMany'), { count: 0 }),
      deleteMany: async () => (write('aiAgentCapability.deleteMany'), { count: 0 }),
      updateMany: async () => (write('aiAgentCapability.updateMany'), { count: 0 }),
    },
    aiAgentKnowledgeTag: {
      createMany: async () => (write('aiAgentKnowledgeTag.createMany'), { count: 0 }),
      deleteMany: async () => (write('aiAgentKnowledgeTag.deleteMany'), { count: 0 }),
    },
    aiAgentKnowledgeDocument: {
      deleteMany: async () => (write('aiAgentKnowledgeDocument.deleteMany'), { count: 0 }),
    },
    aiAgentVersion: {
      findMany: async ({ where }: { where: { agentId: string } }) =>
        state.versions.filter((v) => v.agentId === where.agentId),
      findFirst: async ({ where }: { where: { agentId: string } }) => {
        const mine = state.versions.filter((v) => v.agentId === where.agentId);
        return mine.length === 0
          ? null
          : { version: Math.max(...mine.map((v) => v.version as number)) };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        write('aiAgentVersion.create');
        const row = { ...data, id: `version-${++state.seq}`, orgId: state.orgOf() };
        state.versions.push(row);
        return row;
      },
    },
    aiProviderConfig: {
      // The catalogue asks for active rows; the org policy asks by slug or name.
      findMany: async ({
        where,
      }: {
        where: { isActive?: boolean; OR?: Array<{ slug?: { in: string[] } }> };
      }) =>
        state.providers.filter((p) =>
          where.OR
            ? where.OR.some((clause) => clause.slug?.in.includes(p.slug as string))
            : p.isActive === where.isActive
        ),
    },
    aiProviderModel: { findMany: async () => state.models.filter((m) => m.isActive) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { state, db };
});
vi.mock('@/lib/db/client', () => ({ prisma: fake.db }));

import { EDITOR_AGENT_SLUG, judgeAgentDefinitions } from '@/lib/app/judges/agents';
import { reconcilePlatformAgents } from '@/lib/orchestration/agents/reconcile-platform-agents';
import { __resetPlatformAgentsForTests } from '@/lib/orchestration/agents/platform-agents';
import { forgetOrgProviderPolicy } from '@/lib/orchestration/llm/org-provider-policy';
import { getTenantContext } from '@/lib/tenancy/context';

const ORG = 'cmorg000000000000000workspc';
const SLUGS = judgeAgentDefinitions().map((d) => d.slug);

function agentsOf(orgId: string) {
  return fake.state.agents.filter((a) => a.orgId === orgId);
}

beforeEach(() => {
  __resetPlatformAgentsForTests();
  forgetOrgProviderPolicy(ORG);
  process.env.T17_OPENAI_KEY = 'sk-test';
  const s = fake.state;
  s.seq = 0;
  // A new workspace, approved for OpenAI as provisioning approves it.
  s.orgs = new Map([[ORG, { id: ORG, settings: { providers: { approved: ['prov-openai'] } } }]]);
  s.agents = [];
  s.versions = [];
  s.providers = [
    {
      id: 'prov-openai',
      slug: 'openai',
      name: 'OpenAI',
      providerType: 'openai-compatible',
      apiKeyEnvVar: 'T17_OPENAI_KEY',
      isLocal: false,
      isActive: true,
      jurisdiction: null,
      createdAt: new Date(0),
    },
  ];
  s.models = [
    {
      id: 'm1',
      providerSlug: 'openai',
      modelId: 'gpt-4.1',
      isActive: true,
      capabilities: ['chat'],
    },
    { id: 'm2', providerSlug: 'openai', modelId: 'gpt-5', isActive: true, capabilities: ['chat'] },
  ];
  s.writes = [];
  s.orgOf = () => getTenantContext()?.orgId ?? 'NO-CONTEXT';
});

afterEach(() => {
  delete process.env.T17_OPENAI_KEY;
});

describe('reconciling a new workspace', () => {
  it('creates all ten agents, bound to OpenAI on the interim models', async () => {
    const result = await reconcilePlatformAgents(ORG);

    expect(result.created).toEqual(SLUGS);
    expect(result.refused).toEqual([]);
    const bindings = Object.fromEntries(
      agentsOf(ORG).map((a) => [a.slug, [a.provider, a.model, a.bindingOwner]])
    );
    const judge = ['openai', 'gpt-4.1', 'platform'];
    expect(bindings).toEqual({
      'hdtl-judge-ethos': judge,
      'hdtl-judge-pathos': judge,
      'hdtl-judge-logos': judge,
      'hdtl-judge-kairos': judge,
      'hdtl-judge-lenses': judge,
      'hdtl-judge-influence': judge,
      'hdtl-judge-craft': judge,
      'hdtl-judge-audience': judge,
      'hdtl-judge-culture': judge,
      [EDITOR_AGENT_SLUG]: ['openai', 'gpt-5', 'platform'],
    });
    // Each a system instance, made by the service account, in the workspace.
    for (const a of agentsOf(ORG)) {
      expect(a).toMatchObject({ orgId: ORG, isSystem: true, createdBy: 'service-account' });
    }
  });

  it('writes nothing on a second reconcile', async () => {
    await reconcilePlatformAgents(ORG);
    expect(fake.state.writes.length).toBeGreaterThan(0); // the first run did write
    fake.state.writes = [];

    const second = await reconcilePlatformAgents(ORG);

    expect(second).toMatchObject({ created: [], updated: [], unchanged: SLUGS });
    expect(fake.state.writes).toEqual([]);
  });

  it('creates them inheriting when the workspace is not yet approved for OpenAI', async () => {
    // createOrg's own reconcile runs before provisioning writes the grant.
    fake.state.orgs.get(ORG)!.settings = null;

    const result = await reconcilePlatformAgents(ORG);

    expect(result.created).toEqual(SLUGS);
    for (const a of agentsOf(ORG)) {
      expect([a.provider, a.model]).toEqual(['', '']);
    }
  });
});

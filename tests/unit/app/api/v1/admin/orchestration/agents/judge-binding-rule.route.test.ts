/**
 * Tests: a platform agent's `bindingRule`, through Sunrise's agent routes
 * (j4, D8).
 *
 * The seam is generic and behaviour-neutral at rest: an agent whose
 * definition sets no rule is never refused (`assertBindingAllowed`), and the
 * platform's own protection tests run unchanged. HowDoesThisLand's judges set
 * one, so the agent PATCH and a version restore refuse a model off the judge's
 * approved list, and accept one on it.
 *
 * @see lib/orchestration/agents/platform-agent-guard.ts (assertBindingAllowed)
 * @see lib/app/judges/approved-models.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/config', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}));

const db = vi.hoisted(() => ({
  agentFindUnique: vi.fn(),
  agentUpdate: vi.fn(),
  versionFindFirst: vi.fn(),
  versionCreate: vi.fn(),
}));

vi.mock('@/lib/db/client', () => {
  const mock = {
    aiAgent: { findUnique: db.agentFindUnique, update: db.agentUpdate },
    aiAgentVersion: { findFirst: db.versionFindFirst, create: db.versionCreate },
    aiAgentKnowledgeTag: { deleteMany: vi.fn(), createMany: vi.fn() },
    aiAgentKnowledgeDocument: { deleteMany: vi.fn(), createMany: vi.fn() },
    knowledgeTag: { findMany: vi.fn().mockResolvedValue([]) },
    aiKnowledgeDocument: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation((fn: (tx: typeof mock) => Promise<unknown>) => fn(mock));
  return { prisma: mock };
});

vi.mock('@/lib/security/ip', () => ({ getClientIP: vi.fn(() => '127.0.0.1') }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/orchestration/audit/admin-audit-logger')>()),
  logAdminAction: vi.fn(),
}));
vi.mock('@/lib/orchestration/hooks/registry', () => ({ emitHookEvent: vi.fn() }));
vi.mock('@/lib/orchestration/webhooks/dispatcher', () => ({
  dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/orchestration/agents/reconcile-platform-agents', () => ({
  tryReconcilePlatformAgents: vi.fn(),
}));
vi.mock('@/lib/orchestration/knowledge/resolveAgentDocumentAccess', () => ({
  invalidateAgentAccess: vi.fn(),
}));
// Provider approval is its own rule (§120), off at single tenancy anyway.
vi.mock('@/lib/orchestration/agents/provider-approval', () => ({
  assertAgentProvidersApproved: vi.fn(),
}));

import { PATCH } from '@/app/api/v1/admin/orchestration/agents/[id]/route';
import { POST as RESTORE } from '@/app/api/v1/admin/orchestration/agents/[id]/versions/[versionId]/restore/route';
import { auth } from '@/lib/auth/config';
import { ValidationError } from '@/lib/api/errors';
import { judgeAgentSlug } from '@/lib/app/judges/agents';
import { assertBindingAllowed } from '@/lib/orchestration/agents/platform-agent-guard';
import {
  __resetPlatformAgentsForTests,
  registerPlatformAgent,
  type PlatformAgentDefinition,
} from '@/lib/orchestration/agents/platform-agents';
import { mockAdminUser } from '@/tests/helpers/auth';

const AGENT_ID = 'cmjbv4i3x00003wsloputgwul';
const VERSION_ID = 'cmjbv4i3x00004wsloputgwu3';
const ETHOS = judgeAgentSlug('judge_ethos');
const INFLUENCE = judgeAgentSlug('judge_influence');

function judgeAgent(over: Record<string, unknown> = {}) {
  return {
    id: AGENT_ID,
    orgId: null,
    name: 'Ethos Judge',
    slug: ETHOS,
    description: 'A judge',
    systemInstructions: 'You are the Ethos judge.',
    systemInstructionsHistory: [],
    provider: 'openai',
    model: 'gpt-4.1',
    fallbackProviders: [],
    providerConfig: null,
    bindingOwner: 'org',
    isActive: true,
    isSystem: true,
    deletedAt: null,
    rateLimitRpm: null,
    grantedTags: [],
    grantedDocuments: [],
    ...over,
  };
}

function patch(body: Record<string, unknown>) {
  const request = {
    method: 'PATCH',
    headers: new Headers({ 'content-type': 'application/json' }),
    url: `http://localhost:3000/api/v1/admin/orchestration/agents/${AGENT_ID}`,
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
  return PATCH(request, { params: Promise.resolve({ id: AGENT_ID }) });
}

function restore() {
  return RESTORE(
    new NextRequest(
      `http://localhost:3000/api/v1/admin/orchestration/agents/${AGENT_ID}/versions/${VERSION_ID}/restore`,
      { method: 'POST' }
    ),
    { params: Promise.resolve({ id: AGENT_ID, versionId: VERSION_ID }) }
  );
}

function version(snapshot: Record<string, unknown>) {
  return {
    orgId: null,
    id: VERSION_ID,
    agentId: AGENT_ID,
    version: 2,
    snapshot: { fallbackProviders: [], ...snapshot },
    changeSummary: 'model changed',
    createdBy: 'admin-1',
    createdAt: new Date('2026-01-01'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
  db.agentUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...judgeAgent(), ...data })
  );
  db.versionCreate.mockResolvedValue({});
});

describe('the agent PATCH, on a judge', () => {
  it('refuses a model off the judge’s approved list, writing nothing', async () => {
    db.agentFindUnique.mockResolvedValue(judgeAgent());

    const response = await patch({ model: 'gpt-4o-mini' });

    expect(response.status).toBe(400);
    const json = (await response.json()) as {
      error: { code: string; message: string; details: Record<string, string[]> };
    };
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.message).toContain('"gpt-4o-mini" is not approved for this judge');
    expect(json.error.details.model).toHaveLength(1);
    expect(db.agentUpdate).not.toHaveBeenCalled();
  });

  it('refuses a model approved for a judge but not for the influence judge', async () => {
    db.agentFindUnique.mockResolvedValue(judgeAgent({ slug: INFLUENCE }));
    const response = await patch({ provider: 'anthropic', model: 'claude-haiku-4.5' });
    expect(response.status).toBe(400);
    expect(db.agentUpdate).not.toHaveBeenCalled();
  });

  it('accepts a model on the list and writes it', async () => {
    db.agentFindUnique.mockResolvedValue(judgeAgent());
    const response = await patch({ model: 'gpt-5' });
    expect(response.status).toBe(200);
    expect(db.agentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ model: 'gpt-5' }) })
    );
  });

  it('does not refuse an echo of a binding the agent already holds', async () => {
    // Bound before the list existed; editing its rate limit must still work.
    db.agentFindUnique.mockResolvedValue(judgeAgent({ model: 'gpt-4o-mini' }));
    const response = await patch({ provider: 'openai', model: 'gpt-4o-mini', rateLimitRpm: 30 });
    expect(response.status).toBe(200);
  });
});

describe('a version restore, on a judge', () => {
  beforeEach(() => {
    db.agentFindUnique.mockResolvedValue(judgeAgent());
  });

  it('refuses a version whose model is off the list', async () => {
    db.versionFindFirst.mockResolvedValue(version({ provider: 'openai', model: 'gpt-4o-mini' }));
    const response = await restore();
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: { message: string } };
    expect(json.error.message).toContain('"gpt-4o-mini" is not approved for this judge');
    expect(db.agentUpdate).not.toHaveBeenCalled();
  });

  it('restores a version whose model is on it', async () => {
    db.versionFindFirst.mockResolvedValue(version({ provider: 'openai', model: 'gpt-5' }));
    const response = await restore();
    expect(response.status).toBe(200);
  });

  it('is not asked while the platform owns the binding, which the restore leaves alone', async () => {
    db.agentFindUnique.mockResolvedValue(judgeAgent({ bindingOwner: 'platform' }));
    db.versionFindFirst.mockResolvedValue(version({ provider: 'openai', model: 'gpt-4o-mini' }));
    const response = await restore();
    expect(response.status).toBe(200);
  });
});

describe('assertBindingAllowed, the seam', () => {
  const SLUG = 'test-ruled-agent';
  const definition = (rule?: PlatformAgentDefinition['bindingRule']): PlatformAgentDefinition => ({
    slug: SLUG,
    audience: 'every-org',
    agent: {
      name: 'Ruled',
      description: 'd',
      systemInstructions: 's',
      temperature: 0,
      maxTokens: 100,
    },
    capabilities: [],
    knowledgeTags: [],
    ...(rule ? { bindingRule: rule } : {}),
  });
  const current = { isSystem: true, slug: SLUG, provider: 'openai', model: 'a' };

  beforeEach(() => {
    __resetPlatformAgentsForTests();
  });

  it('never refuses an agent whose definition sets no rule', () => {
    registerPlatformAgent(definition());
    expect(() => assertBindingAllowed(current, { provider: 'x', model: 'anything' })).not.toThrow();
  });

  it('never refuses an org’s own agent, or one no definition names', () => {
    registerPlatformAgent(definition(() => 'no'));
    expect(() =>
      assertBindingAllowed({ ...current, isSystem: false }, { model: 'b' })
    ).not.toThrow();
    expect(() =>
      assertBindingAllowed({ ...current, slug: 'retired' }, { model: 'b' })
    ).not.toThrow();
  });

  it('asks the rule with the pair the write lands on, and only when it changes', () => {
    const rule = vi.fn((b: { provider: string; model: string }) =>
      b.model === 'b' ? null : `"${b.model}" is not allowed`
    );
    registerPlatformAgent(definition(rule));

    expect(() => assertBindingAllowed(current, { provider: 'openai', model: 'a' })).not.toThrow();
    expect(rule).not.toHaveBeenCalled();

    expect(() => assertBindingAllowed(current, { model: 'b' })).not.toThrow();
    expect(rule).toHaveBeenLastCalledWith({ provider: 'openai', model: 'b' });

    expect(() => assertBindingAllowed(current, { provider: 'other' })).toThrow(ValidationError);
    expect(rule).toHaveBeenLastCalledWith({ provider: 'other', model: 'a' });
  });
});

/**
 * Tests: GET /api/v1/workspaces/[id]/judges and PATCH …/judges/[key] (j4).
 *
 * Admission is the authorization policy's (the workspace's OWNER or ADMIN,
 * acting in it), exercised for real through the guard. The choice runs the
 * real `chooseJudgeModel`, so a model off the approved list is refused at the
 * API; only the availability source and the agent rows are mocked.
 *
 * @see app/api/v1/workspaces/[id]/judges/route.ts
 * @see app/api/v1/workspaces/[id]/judges/[key]/route.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { DEFAULT_ORG_ROLE, ORG_ADMIN_ROLE, ORG_OWNER_ROLE } from '@/lib/tenancy/roles';

const mockEnv = vi.hoisted(() => ({
  TENANCY_MODE: 'multi',
  NEXT_PUBLIC_APP_URL: 'http://app.test',
  BETTER_AUTH_URL: 'http://app.test',
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: mockGetSession } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    org: { findUnique: vi.fn() },
    orgMembership: { findUnique: vi.fn(), findMany: vi.fn() },
    aiApiKey: { findFirst: vi.fn(), update: vi.fn() },
    aiAgent: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    aiAgentVersion: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/security/ip', () => ({ getClientIP: vi.fn(() => '127.0.0.1') }));
const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: vi.fn(async () => mockLog) }));
vi.mock('@/lib/logging', () => ({ logger: mockLog }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/orchestration/audit/admin-audit-logger')>()),
  logAdminAction: vi.fn(),
}));
vi.mock('@/lib/orchestration/agents/reconcile-platform-agents', () => ({
  tryReconcilePlatformAgents: vi.fn(),
}));
// The workspace has OpenAI's catalogue available.
vi.mock('@/lib/app/judges/availability', () => ({
  grantedCatalogueAvailability: vi.fn(() =>
    Promise.resolve(
      ['gpt-4.1', 'gpt-5', 'gpt-4o', 'gpt-4o-mini'].map((model) => ({ provider: 'openai', model }))
    )
  ),
}));

import { GET } from '@/app/api/v1/workspaces/[id]/judges/route';
import { PATCH } from '@/app/api/v1/workspaces/[id]/judges/[key]/route';
import { prisma } from '@/lib/db/client';
import { judgeAgentSlug } from '@/lib/app/judges/agents';
import { CHOOSABLE_AGENTS } from '@/lib/app/judges/model-choice';
import { createMockAuthSession } from '@/tests/helpers/auth';

const WS = 'cmorg000000000000000team1';
const ETHOS = judgeAgentSlug('judge_ethos');

function session(activeOrgId: string | null) {
  const base = createMockAuthSession();
  return { session: { ...base.session, activeOrgId }, user: { ...base.user, role: 'USER' } };
}

function memberOf(role: string) {
  vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue({
    role,
    org: { status: 'ACTIVE' },
  } as never);
}

function get(orgId = WS) {
  const request = new Request(
    `http://localhost/api/v1/workspaces/${orgId}/judges`
  ) as unknown as NextRequest;
  return GET(request, { params: Promise.resolve({ id: orgId }) });
}

function patch(key: string, body: unknown, orgId = WS) {
  const request = new Request(`http://localhost/api/v1/workspaces/${orgId}/judges/${key}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
  return PATCH(request, { params: Promise.resolve({ id: orgId, key }) });
}

const json = async (res: Response) => JSON.parse(await res.text());

const ethosRow = {
  id: 'agent-ethos',
  orgId: WS,
  slug: ETHOS,
  name: 'Ethos Judge',
  provider: 'openai',
  model: 'gpt-4.1',
  providerConfig: null,
  bindingOwner: 'platform',
  isSystem: true,
  grantedTags: [],
  grantedDocuments: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  mockEnv.TENANCY_MODE = 'multi';
  vi.mocked(prisma.aiApiKey.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.org.findUnique).mockResolvedValue({
    id: WS,
    name: 'Design Team',
    status: 'ACTIVE',
  } as never);
  mockGetSession.mockResolvedValue(session(WS));
  memberOf(ORG_ADMIN_ROLE);
  vi.mocked(prisma.aiAgent.findMany).mockResolvedValue(
    CHOOSABLE_AGENTS.map((a) => ({
      slug: a.slug,
      name: a.key,
      provider: 'openai',
      model: a.role === 'editor' ? 'gpt-5' : 'gpt-4.1',
      bindingOwner: 'platform',
    })) as never
  );
  vi.mocked(prisma.aiAgent.findFirst).mockResolvedValue(ethosRow as never);
  vi.mocked(prisma.aiAgent.update).mockImplementation((({ data }: { data: object }) =>
    Promise.resolve({ ...ethosRow, ...data })) as never);
  vi.mocked(prisma.aiAgentVersion.findFirst).mockResolvedValue({ version: 2 } as never);
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => unknown) =>
    fn(prisma)) as never);
});

describe('GET /api/v1/workspaces/[id]/judges', () => {
  it.each([ORG_ADMIN_ROLE, ORG_OWNER_ROLE])(
    'answers a workspace %s with each agent’s options',
    async (role) => {
      memberOf(role);
      const res = await get();
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.data.agents).toHaveLength(CHOOSABLE_AGENTS.length);
      const ethos = body.data.agents.find((a: { key: string }) => a.key === 'judge_ethos');
      expect(ethos.options.map((o: { model: string }) => o.model)).toEqual([
        'gpt-4.1',
        'gpt-5',
        'gpt-4o',
      ]);
      expect(JSON.stringify(body)).not.toMatch(/maxTokens|temperature|reasoningEffort|timeout/);
    }
  );

  it('refuses a MEMBER, and someone acting in another workspace', async () => {
    memberOf(DEFAULT_ORG_ROLE);
    expect((await get()).status).toBe(403);
    memberOf(ORG_ADMIN_ROLE);
    mockGetSession.mockResolvedValue(session('cmorg0000000000000000org2'));
    expect((await get()).status).toBe(403);
    expect(prisma.aiAgent.findMany).not.toHaveBeenCalled();
  });

  it('is not available at single tenancy', async () => {
    mockEnv.TENANCY_MODE = 'single';
    const res = await get();
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('WORKSPACES_UNAVAILABLE');
  });
});

describe('PATCH /api/v1/workspaces/[id]/judges/[key]', () => {
  it('refuses a model off the approved list with a 400, writing nothing', async () => {
    const res = await patch('judge_ethos', { model: 'gpt-4o-mini' });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.model[0]).toContain('not one of the models approved');
    expect(prisma.aiAgent.update).not.toHaveBeenCalled();
  });

  it('refuses an approved model the workspace does not have', async () => {
    const res = await patch('judge_ethos', { model: 'claude-sonnet-4' });
    expect(res.status).toBe(400);
    expect(prisma.aiAgent.update).not.toHaveBeenCalled();
  });

  it('binds an approved, available model and answers the agent as GET shows it', async () => {
    const res = await patch('judge_ethos', { model: 'gpt-5' });
    expect(res.status).toBe(200);
    expect(prisma.aiAgent.update).toHaveBeenCalledWith({
      where: { id: 'agent-ethos' },
      data: { provider: 'openai', model: 'gpt-5', bindingOwner: 'org' },
    });
    expect((await json(res)).data).toMatchObject({ key: 'judge_ethos' });
  });

  it('validates the key and the body', async () => {
    expect((await patch('not-a-judge', { model: 'gpt-5' })).status).toBe(400);
    expect((await patch('judge_ethos', { model: 7 })).status).toBe(400);
    expect((await patch('judge_nobody', { model: 'gpt-5' })).status).toBe(404);
  });

  it('refuses a MEMBER', async () => {
    memberOf(DEFAULT_ORG_ROLE);
    expect((await patch('judge_ethos', { model: 'gpt-5' })).status).toBe(403);
    expect(prisma.aiAgent.update).not.toHaveBeenCalled();
  });
});

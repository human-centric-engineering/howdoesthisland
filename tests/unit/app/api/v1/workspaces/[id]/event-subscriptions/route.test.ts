/**
 * Tests: a workspace's webhook routes (t-99) —
 * `…/event-subscriptions`, `…/{subscriptionId}`, `…/{subscriptionId}/rotate-secret`
 * and `…/{subscriptionId}/deliveries` — with the service and access helper
 * behind them (`lib/app/events/subscriptions.ts`, `route-access.ts`).
 *
 * Admission is the authorization policy's, exercised for real through the
 * guard. Only prisma, the logger and the audit writer are mocked, so what is
 * written to `aiEventHook` is what the route and the service really built.
 *
 * @see app/api/v1/workspaces/[id]/event-subscriptions/route.ts
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

const mockPrisma = vi.hoisted(() => {
  const p = {
    user: { findUnique: vi.fn() },
    org: { findUnique: vi.fn() },
    orgMembership: { findUnique: vi.fn(), findMany: vi.fn() },
    aiApiKey: { findFirst: vi.fn(), update: vi.fn() },
    project: { findFirst: vi.fn() },
    aiEventHook: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    aiEventHookDelivery: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return p;
});
vi.mock('@/lib/db/client', () => ({ prisma: mockPrisma }));
const mockIsApiKey = vi.hoisted(() => ({ fn: null as null | ((s: unknown) => boolean) }));
vi.mock('@/lib/auth/api-keys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/api-keys')>();
  return {
    ...actual,
    isApiKeySession: vi.fn((s: Parameters<typeof actual.isApiKeySession>[0]) =>
      mockIsApiKey.fn ? mockIsApiKey.fn(s) : actual.isApiKeySession(s)
    ),
  };
});
const mockInvalidate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/orchestration/hooks/registry', () => ({ invalidateHookCache: mockInvalidate }));
const mockOrgForMint = vi.hoisted(() => ({ fn: null as null | (() => string) }));
vi.mock('@/lib/tenancy/entry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tenancy/entry')>();
  return {
    ...actual,
    orgForMint: vi.fn(() => (mockOrgForMint.fn ? mockOrgForMint.fn() : actual.orgForMint())),
  };
});
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

import * as collection from '@/app/api/v1/workspaces/[id]/event-subscriptions/route';
import * as item from '@/app/api/v1/workspaces/[id]/event-subscriptions/[subscriptionId]/route';
import * as rotate from '@/app/api/v1/workspaces/[id]/event-subscriptions/[subscriptionId]/rotate-secret/route';
import * as deliveries from '@/app/api/v1/workspaces/[id]/event-subscriptions/[subscriptionId]/deliveries/route';
import { ForbiddenError } from '@/lib/api/errors';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { createMockAuthSession } from '@/tests/helpers/auth';
import { MAX_SUBSCRIPTIONS_PER_WORKSPACE } from '@/lib/app/events/types';

const WS = 'cmorg000000000000000team1';
const OTHER = 'cmorg0000000000000000org2';
const SUB = 'cmhook00000000000000hook1';
const PROJECT = 'cmproj00000000000000proj1';
const BASE = `http://localhost/api/v1/workspaces/${WS}/event-subscriptions`;

function session(activeOrgId: string | null, role = 'USER') {
  const base = createMockAuthSession();
  return { session: { ...base.session, activeOrgId }, user: { ...base.user, role } };
}
function memberOf(role: string) {
  mockPrisma.orgMembership.findUnique.mockResolvedValue({ role, org: { status: 'ACTIVE' } });
}
function hookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SUB,
    name: 'CMS',
    eventType: 'app.assessment.finished',
    action: {
      type: 'webhook',
      url: 'https://cms.example.com/hook',
      headers: { Authorization: 'Bearer receiver-token' },
    },
    filter: null,
    isEnabled: true,
    secret: 'a'.repeat(64),
    createdAt: new Date('2026-11-27T10:00:00Z'),
    updatedAt: new Date('2026-11-27T10:00:00Z'),
    creator: { name: 'Sam' },
    ...overrides,
  };
}
const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as unknown as NextRequest;
const wsParams = (id = WS) => ({ params: Promise.resolve({ id }) });
const subParams = (id = WS) => ({ params: Promise.resolve({ id, subscriptionId: SUB }) });
const json = async (res: Response) => JSON.parse(await res.text());
const create = (body: unknown) => collection.POST(req(BASE, 'POST', body), wsParams());
const valid = {
  name: 'CMS',
  eventType: 'app.assessment.finished',
  url: 'https://cms.example.com/hook',
};

beforeEach(() => {
  vi.resetAllMocks();
  mockIsApiKey.fn = null;
  mockOrgForMint.fn = null;
  mockEnv.TENANCY_MODE = 'multi';
  mockPrisma.aiApiKey.findFirst.mockResolvedValue(null);
  mockPrisma.org.findUnique.mockResolvedValue({ id: WS, name: 'Design Team', status: 'ACTIVE' });
  mockGetSession.mockResolvedValue(session(WS));
  memberOf(ORG_ADMIN_ROLE);
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn(mockPrisma)
  );
  mockPrisma.$executeRaw.mockResolvedValue(0);
  mockPrisma.aiEventHook.findMany.mockResolvedValue([hookRow()]);
  mockPrisma.aiEventHook.findFirst.mockResolvedValue(hookRow());
  mockPrisma.aiEventHook.count.mockResolvedValue(0);
  mockPrisma.aiEventHook.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => hookRow(data)
  );
  mockPrisma.aiEventHook.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.aiEventHook.deleteMany.mockResolvedValue({ count: 1 });
  mockPrisma.project.findFirst.mockResolvedValue({ archivedAt: null });
  mockPrisma.aiEventHookDelivery.findFirst.mockResolvedValue(null);
});

describe('who may reach the webhook routes', () => {
  it.each([ORG_ADMIN_ROLE, ORG_OWNER_ROLE])('serves a workspace %s', async (role) => {
    memberOf(role);
    expect((await collection.GET(req(BASE), wsParams())).status).toBe(200);
  });

  it('refuses a MEMBER, and someone acting in another workspace, reading nothing', async () => {
    memberOf(DEFAULT_ORG_ROLE);
    expect((await collection.GET(req(BASE), wsParams())).status).toBe(403);
    memberOf(ORG_ADMIN_ROLE);
    mockGetSession.mockResolvedValue(session(OTHER));
    expect((await collection.GET(req(BASE), wsParams())).status).toBe(403);
    expect(mockPrisma.aiEventHook.findMany).not.toHaveBeenCalled();
  });

  it('refuses an API-key session on every route, so a key cannot mint a signing secret', async () => {
    mockIsApiKey.fn = () => true;
    const answers = await Promise.all([
      collection.GET(req(BASE), wsParams()),
      create(valid),
      item.PATCH(req(`${BASE}/${SUB}`, 'PATCH', { isEnabled: false }), subParams()),
      item.DELETE(req(`${BASE}/${SUB}`, 'DELETE'), subParams()),
      rotate.POST(req(`${BASE}/${SUB}/rotate-secret`, 'POST'), subParams()),
      deliveries.GET(req(`${BASE}/${SUB}/deliveries`), subParams()),
    ]);
    expect(answers.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]);
    expect(mockPrisma.aiEventHook.create).not.toHaveBeenCalled();
    expect(mockPrisma.aiEventHook.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.aiEventHook.deleteMany).not.toHaveBeenCalled();
  });

  it('answers WORKSPACES_UNAVAILABLE at single tenancy, on every route', async () => {
    mockEnv.TENANCY_MODE = 'single';
    const answers = await Promise.all([
      collection.GET(req(BASE), wsParams()),
      create(valid),
      item.GET(req(`${BASE}/${SUB}`), subParams()),
      item.PATCH(req(`${BASE}/${SUB}`, 'PATCH', { isEnabled: false }), subParams()),
      item.DELETE(req(`${BASE}/${SUB}`, 'DELETE'), subParams()),
      rotate.POST(req(`${BASE}/${SUB}/rotate-secret`, 'POST'), subParams()),
      deliveries.GET(req(`${BASE}/${SUB}/deliveries`), subParams()),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(400);
      expect((await json(res)).error.code).toBe('WORKSPACES_UNAVAILABLE');
    }
    expect(mockPrisma.aiEventHook.findFirst).not.toHaveBeenCalled();
  });

  it('refuses making or rotating a secret during a support session', async () => {
    mockGetSession.mockResolvedValue(session(WS, 'ADMIN'));
    mockOrgForMint.fn = () => {
      throw new ForbiddenError('Credentials cannot be created during a support session');
    };
    expect((await create(valid)).status).toBe(403);
    expect(
      (await rotate.POST(req(`${BASE}/${SUB}/rotate-secret`, 'POST'), subParams())).status
    ).toBe(403);
    expect(mockPrisma.aiEventHook.create).not.toHaveBeenCalled();
    expect(mockPrisma.aiEventHook.updateMany).not.toHaveBeenCalled();
  });
});

describe('GET …/event-subscriptions', () => {
  it('lists only the workspace’s hooks for the app’s events, with no secret or header value', async () => {
    const res = await collection.GET(req(BASE), wsParams());
    const body = await json(res);
    expect(mockPrisma.aiEventHook.findMany.mock.calls[0]?.[0].where).toEqual({
      orgId: WS,
      eventType: { in: ['app.assessment.finished', 'app.comparison.finished'] },
    });
    expect(body.data.subscriptions).toEqual([
      expect.objectContaining({
        id: SUB,
        url: 'https://cms.example.com/hook',
        headerNames: ['Authorization'],
        hasSecret: true,
        createdByName: 'Sam',
      }),
    ]);
    const text = JSON.stringify(body);
    expect(text).not.toContain('a'.repeat(64));
    expect(text).not.toContain('receiver-token');
  });

  it('gives each hook its newest delivery in the workspace, or null before any was sent', async () => {
    const second = 'cmhook00000000000000hook2';
    mockPrisma.aiEventHook.findMany.mockResolvedValue([hookRow(), hookRow({ id: second })]);
    mockPrisma.aiEventHookDelivery.findFirst.mockImplementation(
      async ({ where }: { where: { hookId: string } }) =>
        where.hookId === SUB
          ? {
              status: 'failed',
              attempts: 2,
              lastResponseCode: 503,
              createdAt: new Date('2026-11-27T11:00:00Z'),
            }
          : null
    );

    const body = await json(await collection.GET(req(BASE), wsParams()));

    expect(body.data.subscriptions.map((s: { lastDelivery: unknown }) => s.lastDelivery)).toEqual([
      {
        status: 'failed',
        attempts: 2,
        lastResponseCode: 503,
        createdAt: '2026-11-27T11:00:00.000Z',
      },
      null,
    ]);
    expect(mockPrisma.aiEventHookDelivery.findFirst.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({
        where: { orgId: WS, hookId: SUB },
        orderBy: { createdAt: 'desc' },
      }),
      expect.objectContaining({ where: { orgId: WS, hookId: second } }),
    ]);
  });
});

describe('POST …/event-subscriptions', () => {
  it('writes a signed core hook in the workspace and answers its secret once', async () => {
    const res = await create({ ...valid, projectId: PROJECT });
    expect(res.status).toBe(201);
    const body = await json(res);
    const data = mockPrisma.aiEventHook.create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({
      name: 'CMS',
      eventType: 'app.assessment.finished',
      action: { type: 'webhook', url: 'https://cms.example.com/hook' },
      filter: { projectId: PROJECT },
      isEnabled: true,
      orgId: WS,
      createdBy: createMockAuthSession().user.id,
    });
    expect(data.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(body.data.secret).toBe(data.secret);
    expect(body.data.subscription).not.toHaveProperty('secret');
    expect(mockInvalidate).toHaveBeenCalled();
    // The project was checked as the workspace's.
    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PROJECT, orgId: WS } })
    );
    // Audited and logged without the secret.
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hook.create', entityId: SUB })
    );
    expect(JSON.stringify(vi.mocked(logAdminAction).mock.calls)).not.toContain(data.secret);
    expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain(data.secret);
  });

  it.each([
    ['a core event', { ...valid, eventType: 'workflow.completed' }],
    ['an http address', { ...valid, url: 'http://cms.example.com/hook' }],
    ['a private address', { ...valid, url: 'https://10.0.0.5/hook' }],
    ['the metadata address', { ...valid, url: 'https://169.254.169.254/latest' }],
    ['a reserved header', { ...valid, headers: { 'X-Sunrise-Signature': 'forged' } }],
    ['a header with a line break', { ...valid, headers: { 'X-Token': 'a\r\nX-Evil: 1' } }],
    ['a header value fetch cannot send', { ...valid, headers: { 'X-Token': 'clé✓' } }],
    ['a header the sender manages', { ...valid, headers: { Connection: 'close' } }],
    [
      'the event-type header core sends',
      { ...valid, headers: { 'X-Hook-Event': 'app.comparison.finished' } },
    ],
    ['two headers differing only in case', { ...valid, headers: { 'X-A': '1', 'x-a': '2' } }],
    ['a field the route does not take', { ...valid, secret: 'mine' }],
    ['no name', { ...valid, name: '' }],
  ])('refuses %s, writing nothing', async (_label, body) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('VALIDATION_ERROR');
    expect(mockPrisma.aiEventHook.create).not.toHaveBeenCalled();
  });

  it('refuses a project that is not the workspace’s', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null);
    expect((await create({ ...valid, projectId: PROJECT })).status).toBe(400);
    mockPrisma.project.findFirst.mockResolvedValue({ archivedAt: new Date() });
    expect((await create({ ...valid, projectId: PROJECT })).status).toBe(400);
    expect(mockPrisma.aiEventHook.create).not.toHaveBeenCalled();
  });

  it('refuses one past the workspace’s limit, counted under the lock', async () => {
    mockPrisma.aiEventHook.count.mockResolvedValue(MAX_SUBSCRIPTIONS_PER_WORKSPACE);
    const res = await create(valid);
    expect(res.status).toBe(409);
    expect((await json(res)).error.code).toBe('SUBSCRIPTION_LIMIT');
    expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    expect(mockPrisma.aiEventHook.create).not.toHaveBeenCalled();
  });
});

describe('PATCH and DELETE …/event-subscriptions/{subscriptionId}', () => {
  it('refuses a new address without its headers, so a stored credential never follows it', async () => {
    const res = await item.PATCH(
      req(`${BASE}/${SUB}`, 'PATCH', { url: 'https://attacker.example.com/x' }),
      subParams()
    );
    expect(res.status).toBe(400);
    expect(mockPrisma.aiEventHook.updateMany).not.toHaveBeenCalled();
  });

  it('refuses any change during a support session, since it outlives the grant', async () => {
    mockGetSession.mockResolvedValue(session(WS, 'ADMIN'));
    mockOrgForMint.fn = () => {
      throw new ForbiddenError('Credentials cannot be created during a support session');
    };
    const res = await item.PATCH(req(`${BASE}/${SUB}`, 'PATCH', { isEnabled: true }), subParams());
    expect(res.status).toBe(403);
    expect(mockPrisma.aiEventHook.updateMany).not.toHaveBeenCalled();
  });

  it('changes the address with its headers, scoped to the workspace’s app hooks', async () => {
    const res = await item.PATCH(
      req(`${BASE}/${SUB}`, 'PATCH', {
        url: 'https://new.example.com/hook',
        headers: { Authorization: 'Bearer new-token' },
        projectId: null,
      }),
      subParams()
    );
    expect(res.status).toBe(200);
    const call = mockPrisma.aiEventHook.updateMany.mock.calls[0]?.[0];
    expect(call.where).toEqual({
      id: SUB,
      orgId: WS,
      eventType: { in: ['app.assessment.finished', 'app.comparison.finished'] },
    });
    expect(call.data.action).toEqual({
      type: 'webhook',
      url: 'https://new.example.com/hook',
      headers: { Authorization: 'Bearer new-token' },
    });
    expect(mockInvalidate).toHaveBeenCalled();
    // The audit says what changed, never a header's value.
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { changed: ['url', 'headers', 'projectId'], workspaceWebhook: true },
      })
    );
    expect(JSON.stringify(vi.mocked(logAdminAction).mock.calls)).not.toContain('new-token');
  });

  it('answers 404 for another workspace’s hook, or one for a core event, writing nothing', async () => {
    mockPrisma.aiEventHook.findFirst.mockResolvedValue(null);
    const res = await item.PATCH(req(`${BASE}/${SUB}`, 'PATCH', { isEnabled: false }), subParams());
    expect(res.status).toBe(404);
    expect((await item.DELETE(req(`${BASE}/${SUB}`, 'DELETE'), subParams())).status).toBe(404);
    expect(mockPrisma.aiEventHook.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.aiEventHook.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses an empty change', async () => {
    expect((await item.PATCH(req(`${BASE}/${SUB}`, 'PATCH', {}), subParams())).status).toBe(400);
  });

  it('deletes the hook and drops the cache', async () => {
    const res = await item.DELETE(req(`${BASE}/${SUB}`, 'DELETE'), subParams());
    expect(res.status).toBe(200);
    expect(mockPrisma.aiEventHook.deleteMany.mock.calls[0]?.[0].where).toMatchObject({
      id: SUB,
      orgId: WS,
    });
    expect(mockInvalidate).toHaveBeenCalled();
  });
});

describe('POST …/rotate-secret', () => {
  it('stores a new secret and answers it once', async () => {
    const res = await rotate.POST(req(`${BASE}/${SUB}/rotate-secret`, 'POST'), subParams());
    expect(res.status).toBe(200);
    const body = await json(res);
    const stored = mockPrisma.aiEventHook.updateMany.mock.calls[0]?.[0].data.secret;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toBe('a'.repeat(64));
    expect(body.data).toEqual({ id: SUB, secret: stored, rotatedAt: expect.any(String) });
    expect(mockInvalidate).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logAdminAction).mock.calls)).not.toContain(stored);
  });
});

describe('GET …/deliveries', () => {
  it('pages the hook’s deliveries in the workspace, with each event’s id and no payload', async () => {
    mockPrisma.aiEventHookDelivery.findMany.mockResolvedValue([
      {
        id: 'del-1',
        eventType: 'app.assessment.finished',
        payload: { data: { eventId: 'assessment:a1', overall: 71 } },
        status: 'delivered',
        attempts: 1,
        lastAttemptAt: new Date(),
        nextRetryAt: null,
        lastResponseCode: 200,
        lastError: null,
        createdAt: new Date(),
      },
    ]);
    mockPrisma.aiEventHookDelivery.count.mockResolvedValue(1);
    const res = await deliveries.GET(
      req(`${BASE}/${SUB}/deliveries?status=delivered&limit=5`),
      subParams()
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(mockPrisma.aiEventHookDelivery.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { orgId: WS, hookId: SUB, status: 'delivered' },
      take: 5,
    });
    expect(body.data).toEqual([
      expect.objectContaining({ id: 'del-1', eventId: 'assessment:a1', lastResponseCode: 200 }),
    ]);
    expect(body.data[0]).not.toHaveProperty('payload');
    expect(body.meta).toMatchObject({ page: 1, limit: 5, total: 1 });
  });
});

describe('GET …/event-subscriptions/{subscriptionId}', () => {
  it('reads one, scoped to the workspace’s app hooks, with its project filter', async () => {
    mockPrisma.aiEventHook.findFirst.mockResolvedValue(
      hookRow({
        filter: { projectId: PROJECT },
        action: { type: 'webhook', url: 'https://x.example.com/h' },
      })
    );
    const res = await item.GET(req(`${BASE}/${SUB}`), subParams());
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.data.subscription).toMatchObject({ projectId: PROJECT, headerNames: [] });
    expect(mockPrisma.aiEventHook.findFirst.mock.calls[0]?.[0].where).toMatchObject({
      id: SUB,
      orgId: WS,
    });
  });

  it('reads a hook whose stored action or filter it cannot parse without throwing', async () => {
    mockPrisma.aiEventHook.findFirst.mockResolvedValue(
      hookRow({ action: 'not an action', filter: ['nonsense'], creator: null, secret: null })
    );
    const body = await json(await item.GET(req(`${BASE}/${SUB}`), subParams()));
    expect(body.data.subscription).toMatchObject({
      url: '',
      headerNames: [],
      projectId: null,
      hasSecret: false,
      createdByName: null,
    });
  });

  it('changes a hook whose stored action it cannot read, rather than failing', async () => {
    mockPrisma.aiEventHook.findFirst.mockResolvedValue(hookRow({ action: 'not an action' }));
    const off = await item.PATCH(req(`${BASE}/${SUB}`, 'PATCH', { isEnabled: false }), subParams());
    expect(off.status).toBe(200);
    const headersOnly = await item.PATCH(
      req(`${BASE}/${SUB}`, 'PATCH', { headers: { 'X-A': '1' } }),
      subParams()
    );
    expect(headersOnly.status).toBe(400);
    const both = await item.PATCH(
      req(`${BASE}/${SUB}`, 'PATCH', { url: 'https://n.example.com/h', headers: {} }),
      subParams()
    );
    expect(both.status).toBe(200);
  });

  it('refuses a malformed subscription id', async () => {
    const res = await item.GET(req(`${BASE}/nope`), {
      params: Promise.resolve({ id: WS, subscriptionId: 'nope' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('the service’s other changes', () => {
  it('replaces the headers keeping the address, and changes name, event and switch', async () => {
    const res = await item.PATCH(
      req(`${BASE}/${SUB}`, 'PATCH', {
        name: 'CMS 2',
        eventType: 'app.comparison.finished',
        isEnabled: false,
        headers: { 'X-New': 'v' },
        projectId: PROJECT,
      }),
      subParams()
    );
    expect(res.status).toBe(200);
    const data = mockPrisma.aiEventHook.updateMany.mock.calls[0]?.[0].data;
    expect(data).toEqual({
      name: 'CMS 2',
      eventType: 'app.comparison.finished',
      isEnabled: false,
      action: { type: 'webhook', url: 'https://cms.example.com/hook', headers: { 'X-New': 'v' } },
      filter: { projectId: PROJECT },
    });
  });

  it('writes an empty filter for the whole workspace, which core matches as no filter', async () => {
    await item.PATCH(req(`${BASE}/${SUB}`, 'PATCH', { projectId: null }), subParams());
    expect(mockPrisma.aiEventHook.updateMany.mock.calls[0]?.[0].data).toEqual({ filter: {} });
    await create(valid);
    expect(mockPrisma.aiEventHook.create.mock.calls[0]?.[0].data.filter).toEqual({});
  });

  it('stores a new address with no headers when it is given `{}`', async () => {
    await item.PATCH(
      req(`${BASE}/${SUB}`, 'PATCH', { url: 'https://n.example.com/h', headers: {} }),
      subParams()
    );
    expect(mockPrisma.aiEventHook.updateMany.mock.calls[0]?.[0].data.action).toEqual({
      type: 'webhook',
      url: 'https://n.example.com/h',
      headers: {},
    });
  });

  it('keeps the stored headers when only the headers are left out and the address is unchanged', async () => {
    await item.PATCH(req(`${BASE}/${SUB}`, 'PATCH', { name: 'Renamed' }), subParams());
    expect(mockPrisma.aiEventHook.updateMany.mock.calls[0]?.[0].data).toEqual({ name: 'Renamed' });
  });

  it('answers 404 when the row went between the read and the write', async () => {
    mockPrisma.aiEventHook.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.aiEventHook.deleteMany.mockResolvedValue({ count: 0 });
    expect(
      (await item.PATCH(req(`${BASE}/${SUB}`, 'PATCH', { isEnabled: false }), subParams())).status
    ).toBe(404);
    expect((await item.DELETE(req(`${BASE}/${SUB}`, 'DELETE'), subParams())).status).toBe(404);
    expect(
      (await rotate.POST(req(`${BASE}/${SUB}/rotate-secret`, 'POST'), subParams())).status
    ).toBe(404);
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('refuses to make a subscription in a workspace other than the one entered', async () => {
    mockOrgForMint.fn = () => OTHER;
    expect((await create(valid)).status).toBe(403);
    expect(mockPrisma.aiEventHook.create).not.toHaveBeenCalled();
  });

  it('lists every delivery when no status is asked for, and one with no event id as null', async () => {
    mockPrisma.aiEventHookDelivery.findMany.mockResolvedValue([
      {
        id: 'del-2',
        eventType: 'app.assessment.finished',
        payload: { data: {} },
        status: 'failed',
        attempts: 3,
        lastAttemptAt: null,
        nextRetryAt: null,
        lastResponseCode: 500,
        lastError: 'boom',
        createdAt: new Date(),
      },
    ]);
    mockPrisma.aiEventHookDelivery.count.mockResolvedValue(1);
    const body = await json(await deliveries.GET(req(`${BASE}/${SUB}/deliveries`), subParams()));
    expect(mockPrisma.aiEventHookDelivery.findMany.mock.calls[0]?.[0].where).toEqual({
      orgId: WS,
      hookId: SUB,
    });
    expect(body.data[0].eventId).toBeNull();
  });
});

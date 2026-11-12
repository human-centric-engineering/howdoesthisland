/**
 * Unit Tests: POST /api/v1/workspaces (t-8)
 *
 * Real `withAuth`; `createTeamWorkspace` is mocked (it has its own tests) but
 * the real `WorkspaceLimitError` is kept so the guard's APIError mapping is
 * what answers the 409. Covers every error code the route documents.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { DEFAULT_ORG_ROLE } from '@/lib/tenancy/roles';

const mockEnv = vi.hoisted(() => ({ TENANCY_MODE: 'multi' }));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: mockGetSession } } }));
const mockHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(mockHeaders.current)) }));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    orgMembership: { findUnique: vi.fn(), findMany: vi.fn() },
    aiApiKey: { findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/workspaces/create', async () => {
  const actual = await vi.importActual<typeof import('@/lib/app/workspaces/create')>(
    '@/lib/app/workspaces/create'
  );
  return { ...actual, createTeamWorkspace: mockCreate };
});

import { POST } from '@/app/api/v1/workspaces/route';
import { prisma } from '@/lib/db/client';
import { WorkspaceLimitError } from '@/lib/app/workspaces/create';
import { createMockAuthSession } from '@/tests/helpers/auth';

const USER_ID = 'cmjbv4i3x00003wsloputgwul';
const ACTIVE_ORG = 'cmorg000000000000000active';
const CREATED = {
  id: 'cmorg000000000000000newws1',
  slug: 'design-team',
  name: 'Design Team',
  role: 'OWNER',
};

function session() {
  const base = createMockAuthSession();
  return { ...base, session: { ...base.session, activeOrgId: ACTIVE_ORG } };
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  mockHeaders.current = new Headers(headers);
  const res = await POST(
    new Request('http://localhost/api/v1/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }) as unknown as NextRequest
  );
  return { res, json: JSON.parse(await res.text()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.TENANCY_MODE = 'multi';
  mockGetSession.mockResolvedValue(session());
  // The guard enters the session's active org at multi and checks the membership.
  vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue({
    role: DEFAULT_ORG_ROLE,
    org: { status: 'ACTIVE' },
  } as never);
  vi.mocked(prisma.aiApiKey.findFirst).mockResolvedValue(null);
  mockCreate.mockResolvedValue(CREATED);
});

describe('POST /api/v1/workspaces', () => {
  it('creates the workspace, answering 201 with it in the envelope', async () => {
    const { res, json } = await post({ name: 'Design Team' });

    expect(res.status).toBe(201);
    expect(json).toEqual({ success: true, data: CREATED });
  });

  it('passes the trimmed name and the caller’s own id', async () => {
    await post({ name: '  Design Team  ' });

    expect(mockCreate).toHaveBeenCalledWith({ name: 'Design Team', ownerUserId: USER_ID });
  });

  it('ignores an owner named in the body', async () => {
    await post({ name: 'Design Team', ownerUserId: 'cmattacker000000000000000', userId: 'x' });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toEqual({ name: 'Design Team', ownerUserId: USER_ID });
  });

  it.each([
    ['a missing name', {}],
    ['an empty name', { name: '' }],
    ['a whitespace-only name', { name: '   ' }],
    ['a non-string name', { name: 42 }],
    ['a name over 100 characters', { name: 'a'.repeat(101) }],
  ])('rejects %s with 400 VALIDATION_ERROR', async (_label, body) => {
    const { res, json } = await post(body);

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('accepts a name of exactly 100 characters', async () => {
    const name = 'a'.repeat(100);

    const { res } = await post({ name });

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith({ name, ownerUserId: USER_ID });
  });

  it('answers 400 WORKSPACES_UNAVAILABLE at single, creating nothing', async () => {
    mockEnv.TENANCY_MODE = 'single';

    const { res, json } = await post({ name: 'Design Team' });

    expect(res.status).toBe(400);
    expect(json.error.code).toBe('WORKSPACES_UNAVAILABLE');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('answers 401 UNAUTHORIZED without a session', async () => {
    mockGetSession.mockResolvedValue(null);

    const { res, json } = await post({ name: 'Design Team' });

    expect(res.status).toBe(401);
    expect(json.error.code).toBe('UNAUTHORIZED');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('answers 403 FORBIDDEN to an API key, creating nothing', async () => {
    vi.mocked(prisma.aiApiKey.findFirst).mockResolvedValue({
      id: 'cmkey000000000000000key1',
      userId: USER_ID,
      scopes: ['chat'],
      rateLimitRpm: null,
      expiresAt: null,
      createdAt: new Date(),
      orgId: ACTIVE_ORG,
      user: {
        id: USER_ID,
        name: 'Key Owner',
        email: 'owner@example.com',
        emailVerified: true,
        image: null,
        role: 'USER',
        accountType: 'HUMAN',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as never);

    const { res, json } = await post(
      { name: 'Design Team' },
      { authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef' }
    );

    expect(res.status).toBe(403);
    expect(json.error.code).toBe('FORBIDDEN');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('answers 409 WORKSPACE_LIMIT_REACHED with the limit in details', async () => {
    mockCreate.mockRejectedValue(new WorkspaceLimitError(10));

    const { res, json } = await post({ name: 'Design Team' });

    expect(res.status).toBe(409);
    expect(json.error.code).toBe('WORKSPACE_LIMIT_REACHED');
    expect(json.error.details).toEqual({ limit: 10 });
  });

  it('answers 500 INTERNAL_ERROR for an unexpected failure', async () => {
    mockCreate.mockRejectedValue(new Error('connection refused to db-internal:5432'));

    const { res, json } = await post({ name: 'Design Team' });

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });
});

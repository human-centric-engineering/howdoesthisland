/**
 * Unit Tests: GET /api/v1/workspaces/invitations (t-9)
 *
 * Real `withAuth`; `listInvitationsFor` is mocked (it has its own tests).
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

const mockList = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/workspaces/invitations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/app/workspaces/invitations')>();
  return { ...actual, listInvitationsFor: mockList };
});

import { GET } from '@/app/api/v1/workspaces/invitations/route';
import { prisma } from '@/lib/db/client';
import { createMockAuthSession } from '@/tests/helpers/auth';

const USER_ID = 'cmjbv4i3x00003wsloputgwul';
const ACTIVE_ORG = 'cmorg000000000000000active';

function session() {
  const base = createMockAuthSession();
  return { ...base, session: { ...base.session, activeOrgId: ACTIVE_ORG } };
}

async function get(headers: Record<string, string> = {}) {
  mockHeaders.current = new Headers(headers);
  const res = await GET(
    new Request('http://localhost/api/v1/workspaces/invitations', {
      headers,
    }) as unknown as NextRequest
  );
  return { res, json: JSON.parse(await res.text()) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockEnv.TENANCY_MODE = 'multi';
  mockGetSession.mockResolvedValue(session());
  vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue({
    role: DEFAULT_ORG_ROLE,
    org: { status: 'ACTIVE' },
  } as never);
  vi.mocked(prisma.aiApiKey.findFirst).mockResolvedValue(null);
  mockList.mockResolvedValue([]);
});

describe('GET /api/v1/workspaces/invitations', () => {
  it('lists for the session user only, wrapping the result in an `invitations` envelope', async () => {
    const expiresAt = new Date('2026-11-20T00:00:00.000Z');
    const createdAt = new Date('2026-11-06T00:00:00.000Z');
    mockList.mockResolvedValue([
      {
        id: 'i1',
        workspace: { id: 'w1', name: 'Design Team' },
        role: 'MEMBER',
        invitedBy: 'Alice',
        expiresAt,
        createdAt,
      },
    ]);

    const { res, json } = await get();

    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith(USER_ID);
    expect(json).toEqual({
      success: true,
      data: {
        invitations: [
          {
            id: 'i1',
            workspace: { id: 'w1', name: 'Design Team' },
            role: 'MEMBER',
            invitedBy: 'Alice',
            expiresAt: expiresAt.toISOString(),
            createdAt: createdAt.toISOString(),
          },
        ],
      },
    });
  });

  it('answers an empty list as an empty array, not an error', async () => {
    const { res, json } = await get();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ invitations: [] });
  });

  it('ignores a userId in the query string', async () => {
    mockHeaders.current = new Headers();
    await GET(
      new Request(
        'http://localhost/api/v1/workspaces/invitations?userId=cmattacker0000000000001'
      ) as unknown as NextRequest
    );

    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(USER_ID);
  });

  it('answers 400 WORKSPACES_UNAVAILABLE at single, reading nothing', async () => {
    mockEnv.TENANCY_MODE = 'single';

    const { res, json } = await get();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe('WORKSPACES_UNAVAILABLE');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null);

    const { res, json } = await get();

    expect(res.status).toBe(401);
    expect(json.error.code).toBe('UNAUTHORIZED');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('answers 403 FORBIDDEN to an API key, reading nothing', async () => {
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

    const { res, json } = await get({
      authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef',
    });

    expect(res.status).toBe(403);
    expect(json.error.code).toBe('FORBIDDEN');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('answers 500 INTERNAL_ERROR for an unexpected failure', async () => {
    mockList.mockRejectedValue(new Error('db down'));

    const { res, json } = await get();

    expect(res.status).toBe(500);
    expect(json.error.code).toBe('INTERNAL_ERROR');
  });
});

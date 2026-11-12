/**
 * Unit Tests: POST /api/v1/workspaces/invitations/[invitationId]/accept (t-9)
 *
 * Real `withAuth`; `acceptInvitation` is mocked (it has its own tests) but the real
 * `WorkspaceInvitationError` / `OrgLifecycleError` are thrown so the
 * guard's APIError mapping is what answers.
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

const mockAnswer = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/workspaces/invitations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/app/workspaces/invitations')>();
  return { ...actual, acceptInvitation: mockAnswer };
});

import { POST } from '@/app/api/v1/workspaces/invitations/[invitationId]/accept/route';
import { prisma } from '@/lib/db/client';
import { WorkspaceInvitationError } from '@/lib/app/workspaces/invitations';
import { OrgLifecycleError } from '@/lib/tenancy/lifecycle';
import { createMockAuthSession } from '@/tests/helpers/auth';

const USER_ID = 'cmjbv4i3x00003wsloputgwul';
const ACTIVE_ORG = 'cmorg000000000000000active';
const INVITATION_ID = 'cminvitation000000000001';

function session() {
  const base = createMockAuthSession();
  return { ...base, session: { ...base.session, activeOrgId: ACTIVE_ORG } };
}

async function post(
  invitationId = INVITATION_ID,
  body: unknown = undefined,
  headers: Record<string, string> = {}
) {
  mockHeaders.current = new Headers(headers);
  const res = await POST(
    new Request(`http://localhost/api/v1/workspaces/invitations/${invitationId}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ invitationId }) }
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
  mockAnswer.mockResolvedValue({ orgId: 'cmorg000000000000000team1', role: 'ADMIN' });
});

describe('POST .../invitations/[invitationId]/accept', () => {
  it('accepts, answering 200 with the membership { orgId, role }', async () => {
    const { res, json } = await post();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      success: true,
      data: { orgId: 'cmorg000000000000000team1', role: 'ADMIN' },
    });
    expect(mockAnswer).toHaveBeenCalledTimes(1);
  });

  it('answers as the session user, never a user named in the body or query', async () => {
    await post(INVITATION_ID, { userId: 'cmattacker000000000000000' });

    expect(mockAnswer).toHaveBeenCalledWith(INVITATION_ID, USER_ID);
  });

  it('passes the invitation id from the URL', async () => {
    await post('cminvitation000000000002');

    expect(mockAnswer).toHaveBeenCalledWith('cminvitation000000000002', USER_ID);
  });

  it('answers 404 INVITATION_NOT_FOUND for a missing or someone else’s invitation', async () => {
    mockAnswer.mockRejectedValue(
      new WorkspaceInvitationError('INVITATION_NOT_FOUND', 'Invitation not found')
    );

    const { res, json } = await post();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('INVITATION_NOT_FOUND');
  });

  it('answers 409 INVITATION_ALREADY_ANSWERED', async () => {
    mockAnswer.mockRejectedValue(
      new WorkspaceInvitationError('INVITATION_ALREADY_ANSWERED', 'Already answered')
    );

    const { res, json } = await post();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe('INVITATION_ALREADY_ANSWERED');
  });

  it('answers 410 INVITATION_EXPIRED', async () => {
    mockAnswer.mockRejectedValue(new WorkspaceInvitationError('INVITATION_EXPIRED', 'Expired'));

    const { res, json } = await post();

    expect(res.status).toBe(410);
    expect(json.error.code).toBe('INVITATION_EXPIRED');
  });

  it('answers 409 ALREADY_MEMBER when the caller is already in the workspace', async () => {
    mockAnswer.mockRejectedValue(
      new OrgLifecycleError('ALREADY_MEMBER', 'That user is already a member')
    );

    const { res, json } = await post();

    expect(res.status).toBe(409);
    expect(json.error.code).toBe('ALREADY_MEMBER');
  });
  it('rejects an empty invitation id with 400 VALIDATION_ERROR before the domain runs', async () => {
    const { res, json } = await post(' ');

    expect(res.status).toBe(400);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(mockAnswer).not.toHaveBeenCalled();
  });

  it('answers 400 WORKSPACES_UNAVAILABLE at single, doing nothing', async () => {
    mockEnv.TENANCY_MODE = 'single';

    const { res, json } = await post();

    expect(res.status).toBe(400);
    expect(json.error.code).toBe('WORKSPACES_UNAVAILABLE');
    expect(mockAnswer).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null);

    const { res, json } = await post();

    expect(res.status).toBe(401);
    expect(json.error.code).toBe('UNAUTHORIZED');
    expect(mockAnswer).not.toHaveBeenCalled();
  });

  it('answers 403 FORBIDDEN to an API key, doing nothing', async () => {
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

    const { res, json } = await post(INVITATION_ID, undefined, {
      authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef',
    });

    expect(res.status).toBe(403);
    expect(json.error.code).toBe('FORBIDDEN');
    expect(mockAnswer).not.toHaveBeenCalled();
  });
});

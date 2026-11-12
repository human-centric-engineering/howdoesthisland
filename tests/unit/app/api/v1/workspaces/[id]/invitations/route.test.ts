/**
 * Unit Tests: POST /api/v1/workspaces/[id]/invitations (t-9)
 *
 * Runs the REAL `withAuth`, default policy, entry rule and `resolveOrgResource`
 * at `TENANCY_MODE=multi`, with Prisma mocked at the delegates. The route's
 * domain call is a spy (its own tests are in tests/unit/lib/app/workspaces),
 * except in the last block, where the real `inviteIntoWorkspace` runs so the
 * 202 body can be compared across an address with and without an account.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { DEFAULT_ORG_ROLE, ORG_ADMIN_ROLE, ORG_OWNER_ROLE } from '@/lib/tenancy/roles';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';

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
    verification: { count: vi.fn() },
    workspaceInvitation: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock('@/lib/utils/invitation-token', () => ({
  getValidInvitation: vi.fn(),
  INVITATION_IDENTIFIER_PREFIX: 'invitation:',
}));
const mockDeliver = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/invitation-delivery', () => ({ deliverInvitation: mockDeliver }));
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/security/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/rate-limit')>();
  return { ...actual, inviteLimiter: { check: vi.fn() } };
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

const mockInvite = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/workspaces/invitations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/app/workspaces/invitations')>();
  return {
    ...actual,
    inviteIntoWorkspace: mockInvite,
    realInviteIntoWorkspace: actual.inviteIntoWorkspace,
  };
});

import { POST } from '@/app/api/v1/workspaces/[id]/invitations/route';
import { prisma } from '@/lib/db/client';
import { sendEmail } from '@/lib/email/send';
import { getValidInvitation } from '@/lib/utils/invitation-token';
import { inviteLimiter } from '@/lib/security/rate-limit';
import { OrgLifecycleError } from '@/lib/tenancy/lifecycle';
import * as invitationsModule from '@/lib/app/workspaces/invitations';
import { createMockAuthSession } from '@/tests/helpers/auth';

const WS = 'cmorg000000000000000team1';
const OTHER_WS = 'cmorg0000000000000000org2';
const USER_ID = 'cmjbv4i3x00003wsloputgwul';
const invitee = { name: 'Jane Doe', email: 'jane@example.com' };

function session(activeOrgId: string | null, role: 'USER' | 'ADMIN' = 'USER') {
  const base = createMockAuthSession();
  return {
    session: { ...base.session, activeOrgId },
    user: { ...base.user, role },
  };
}

function memberOf(role: string) {
  vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue({
    role,
    org: { status: 'ACTIVE' },
  } as never);
}

function post(body: unknown, orgId = WS, headers: Record<string, string> = {}) {
  const request = new Request(`http://localhost/api/v1/workspaces/${orgId}/invitations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
  return POST(request, { params: Promise.resolve({ id: orgId }) });
}

const json = async (res: Response) => JSON.parse(await res.text());

beforeEach(() => {
  vi.resetAllMocks();
  mockEnv.TENANCY_MODE = 'multi';
  vi.mocked(prisma.aiApiKey.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.org.findUnique).mockResolvedValue({
    id: WS,
    name: 'Design Team',
    status: 'ACTIVE',
  } as never);
  vi.mocked(inviteLimiter.check).mockReturnValue({
    success: true,
    remaining: 9,
    reset: 0,
  } as never);
  mockInvite.mockResolvedValue(undefined);
  mockGetSession.mockResolvedValue(session(WS));
  memberOf(ORG_ADMIN_ROLE);
});

describe('POST /api/v1/workspaces/[id]/invitations — admission and validation', () => {
  it('lets a workspace ADMIN invite: 202 with the email echoed, the domain called with the URL org and body', async () => {
    const res = await post({ ...invitee, orgRole: ORG_ADMIN_ROLE });
    const body = await json(res);

    expect(res.status).toBe(202);
    expect(body).toEqual({
      success: true,
      data: { email: 'jane@example.com', message: 'Invitation sent to jane@example.com.' },
    });
    expect(mockInvite).toHaveBeenCalledTimes(1);
    expect(mockInvite.mock.calls[0][0]).toMatchObject({
      orgId: WS,
      email: 'jane@example.com',
      name: 'Jane Doe',
      orgRole: ORG_ADMIN_ROLE,
      actor: { platformAdmin: false, orgRole: ORG_ADMIN_ROLE },
      inviter: { id: USER_ID, name: 'Test User' },
    });
  });

  it('names the inviter generically when the session user has no name', async () => {
    const s = session(WS);
    mockGetSession.mockResolvedValue({ ...s, user: { ...s.user, name: '' } });

    await post(invitee);

    expect(mockInvite.mock.calls[0][0].inviter).toEqual({
      id: USER_ID,
      name: 'A workspace admin',
    });
  });

  it('passes an OWNER actor through for an OWNER caller', async () => {
    memberOf(ORG_OWNER_ROLE);

    await post({ ...invitee, orgRole: ORG_OWNER_ROLE });

    expect(mockInvite.mock.calls[0][0].actor).toMatchObject({ orgRole: ORG_OWNER_ROLE });
  });

  it('takes the workspace from the URL, ignoring an orgId in the body', async () => {
    await post({ ...invitee, orgId: OTHER_WS });

    expect(mockInvite.mock.calls[0][0].orgId).toBe(WS);
  });

  it.each([
    ['a missing name', { email: 'a@b.co' }],
    ['an empty name', { name: '', email: 'a@b.co' }],
    ['a malformed email', { name: 'X', email: 'nope' }],
    ['an unknown role', { name: 'X', email: 'a@b.co', orgRole: 'ROOT' }],
  ])('rejects %s with 400 VALIDATION_ERROR before the domain runs', async (_l, bad) => {
    const res = await post(bad);

    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('VALIDATION_ERROR');
    expect(mockInvite).not.toHaveBeenCalled();
  });

  it('answers 400 WORKSPACES_UNAVAILABLE at single, doing nothing', async () => {
    mockEnv.TENANCY_MODE = 'single';

    const res = await post(invitee);

    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('WORKSPACES_UNAVAILABLE');
    expect(mockInvite).not.toHaveBeenCalled();
  });

  it('answers 401 without a session', async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await post(invitee);

    expect(res.status).toBe(401);
    expect((await json(res)).error.code).toBe('UNAUTHORIZED');
    expect(mockInvite).not.toHaveBeenCalled();
  });

  it('refuses an API-key caller with 403', async () => {
    vi.mocked(prisma.aiApiKey.findFirst).mockResolvedValue({
      id: 'cmkey000000000000000key1',
      userId: USER_ID,
      scopes: ['admin'],
      rateLimitRpm: null,
      expiresAt: null,
      createdAt: new Date(),
      orgId: WS,
      user: {
        id: USER_ID,
        name: 'Key Owner',
        email: 'owner@example.com',
        emailVerified: true,
        image: null,
        role: 'ADMIN',
        accountType: 'HUMAN',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as never);

    const res = await post(invitee, WS, {
      authorization: 'Bearer sk_deadbeefdeadbeefdeadbeefdeadbeef',
    });

    expect(res.status).toBe(403);
    expect(mockInvite).not.toHaveBeenCalled();
  });

  it('refuses a plain MEMBER with 403', async () => {
    memberOf(DEFAULT_ORG_ROLE);

    const res = await post(invitee);

    expect(res.status).toBe(403);
    expect(mockInvite).not.toHaveBeenCalled();
  });

  it('refuses someone who is not a member of the workspace', async () => {
    vi.mocked(prisma.orgMembership.findUnique).mockResolvedValue(null);

    const res = await post(invitee);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(mockInvite).not.toHaveBeenCalled();
  });

  it('refuses an ADMIN of workspace A who names workspace B in the URL', async () => {
    mockGetSession.mockResolvedValue(session(OTHER_WS));

    const res = await post(invitee, WS);

    expect(res.status).toBe(403);
    expect(mockInvite).not.toHaveBeenCalled();
  });

  it('answers 403 for a workspace that does not exist, as for one the caller is not in', async () => {
    vi.mocked(prisma.org.findUnique).mockResolvedValue(null);

    const res = await post(invitee);

    expect(res.status).toBe(403);
    expect(mockInvite).not.toHaveBeenCalled();
  });

  it('answers 429 when the invite limiter says no, before the domain runs', async () => {
    vi.mocked(inviteLimiter.check).mockReturnValue({
      success: false,
      limit: 10,
      remaining: 0,
      reset: Math.floor(Date.now() / 1000) + 60,
    });

    const res = await post(invitee);

    expect(res.status).toBe(429);
    expect(inviteLimiter.check).toHaveBeenCalledWith('127.0.0.1');
    expect(mockInvite).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/workspaces/[id]/invitations — errors from the domain', () => {
  it('maps OWNER_STANDING to 403', async () => {
    mockInvite.mockRejectedValue(
      new OrgLifecycleError('OWNER_STANDING', 'Only an owner may invite')
    );

    const res = await post({ ...invitee, orgRole: ORG_OWNER_ROLE });

    expect(res.status).toBe(403);
    expect((await json(res)).error.code).toBe('OWNER_STANDING');
  });

  it('maps ORG_NOT_ACTIVE to 400', async () => {
    mockInvite.mockRejectedValue(new OrgLifecycleError('ORG_NOT_ACTIVE', 'Suspended'));

    const res = await post(invitee);

    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('ORG_NOT_ACTIVE');
  });

  it('maps INSTALL_ORG_MEMBERSHIP to 400', async () => {
    mockInvite.mockRejectedValue(new OrgLifecycleError('INSTALL_ORG_MEMBERSHIP', 'Install org'));

    const res = await post(invitee);

    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe('INSTALL_ORG_MEMBERSHIP');
  });

  it('answers 500 INTERNAL_ERROR for an unexpected failure', async () => {
    mockInvite.mockRejectedValue(new Error('connection refused to db-internal:5432'));

    const res = await post(invitee);

    expect(res.status).toBe(500);
    expect((await json(res)).error.code).toBe('INTERNAL_ERROR');
  });
});

describe('POST /api/v1/workspaces/[id]/invitations — the answer never reveals an account', () => {
  const real = invitationsModule as unknown as {
    realInviteIntoWorkspace: typeof invitationsModule.inviteIntoWorkspace;
  };

  beforeEach(() => {
    mockInvite.mockImplementation(real.realInviteIntoWorkspace);
    vi.mocked(sendEmail).mockResolvedValue({ success: true, status: 'sent', id: 'e1' });
    vi.mocked(getValidInvitation).mockResolvedValue(null);
    vi.mocked(prisma.verification.count).mockResolvedValue(0);
    // The caller's own membership (the entry rule) vs the invitee's (the domain).
    vi.mocked(prisma.orgMembership.findUnique).mockImplementation(((args: {
      where: { orgId_userId: { userId: string } };
    }) =>
      Promise.resolve(
        args.where.orgId_userId.userId === USER_ID
          ? { role: ORG_ADMIN_ROLE, org: { status: 'ACTIVE' } }
          : inviteeIsMember
            ? { id: 'm9' }
            : null
      )) as never);
    vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.workspaceInvitation.upsert).mockResolvedValue({} as never);
    mockDeliver.mockResolvedValue({ emailStatus: 'sent' });
    inviteeIsMember = false;
  });

  let inviteeIsMember = false;

  async function answerWhen(setup: () => void) {
    vi.clearAllMocks();
    setup();
    const res = await post(invitee);
    return { status: res.status, text: await res.text() };
  }

  it('answers byte-identically for an address with an account, without one, an existing member, and the service account', async () => {
    const noAccount = await answerWhen(() => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    });
    expect(mockDeliver).toHaveBeenCalledTimes(1);
    expect(prisma.workspaceInvitation.upsert).not.toHaveBeenCalled();

    const hasAccount = await answerWhen(() => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u9',
        accountType: 'HUMAN',
      } as never);
    });
    expect(prisma.workspaceInvitation.upsert).toHaveBeenCalledTimes(1);
    expect(mockDeliver).not.toHaveBeenCalled();

    const member = await answerWhen(() => {
      inviteeIsMember = true;
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u9',
        accountType: 'HUMAN',
      } as never);
    });
    expect(prisma.workspaceInvitation.upsert).not.toHaveBeenCalled();
    expect(mockDeliver).not.toHaveBeenCalled();
    inviteeIsMember = false;

    const service = await answerWhen(() => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'svc',
        accountType: 'SERVICE',
      } as never);
    });
    expect(prisma.workspaceInvitation.upsert).not.toHaveBeenCalled();

    expect(noAccount.status).toBe(202);
    expect(noAccount.text).toBe(
      JSON.stringify({
        success: true,
        data: { email: 'jane@example.com', message: 'Invitation sent to jane@example.com.' },
      })
    );
    expect(hasAccount).toEqual(noAccount);
    expect(member).toEqual(noAccount);
    expect(service).toEqual(noAccount);
  });

  it('answers identically when a sign-up invitation into another org blocks the send', async () => {
    const baseline = await answerWhen(() => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    });

    const blocked = await answerWhen(() => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(getValidInvitation).mockResolvedValue({
        metadata: { orgId: OTHER_WS, role: 'USER' },
      } as never);
    });

    expect(mockDeliver).not.toHaveBeenCalled();
    expect(blocked).toEqual(baseline);
    expect(blocked.text).not.toContain(OTHER_WS);
  });

  it('still refuses the install org the same way whether or not the address has an account', async () => {
    vi.mocked(prisma.org.findUnique).mockResolvedValue({
      id: INSTALL_ORG_ID,
      status: 'ACTIVE',
    } as never);
    mockGetSession.mockResolvedValue(session(INSTALL_ORG_ID));

    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const a = await post(invitee, INSTALL_ORG_ID);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u9',
      accountType: 'HUMAN',
    } as never);
    const b = await post(invitee, INSTALL_ORG_ID);

    expect(a.status).toBe(400);
    expect(b.status).toBe(400);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(0);
  });
});

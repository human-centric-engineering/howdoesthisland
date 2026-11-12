/**
 * Tests: the signup-org seam through the real signup hooks (t-6)
 *
 * An uninvited signup runs `userCreateBeforeHook` → `userCreateAfterHook` →
 * `sessionCreateBeforeHook`. The request-state carrier between them
 * (`lib/auth/pending-signup.ts`) is a small stateful fake, so what one hook
 * records is what the next reads; the database is mocked at the client. The
 * fork's resolver (`lib/app/signup-org.ts`) is swapped per test.
 *
 * Pinned:
 * - registered, an uninvited password signup and an uninvited OAuth signup each
 *   end with exactly one membership, in the resolved org as OWNER, and a first
 *   session on that org;
 * - invited signups and the first human never ask the resolver;
 * - a resolver that throws, answers nothing, or names a missing org falls back
 *   to the install org, logged at `error`;
 * - with no resolver the decision is today's, at `single` and at `multi`.
 *
 * The resolver's own arms are in tests/unit/lib/tenancy/signup-org.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserCreateData, SessionCreateData } from '@/lib/auth/config';
import type { PendingSignup } from '@/lib/auth/pending-signup';
import type { SignupOrgResolver } from '@/lib/tenancy/signup-org';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { DEFAULT_ORG_ROLE, ORG_OWNER_ROLE } from '@/lib/tenancy/roles';

const mockEnv = vi.hoisted(() => ({
  TENANCY_MODE: 'multi',
  SIGNUP_MODE: 'open',
  REQUIRE_EMAIL_VERIFICATION: false,
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  EMAIL_FROM: 'test@example.com',
}));
vi.mock('@/lib/env', () => ({
  env: mockEnv,
  isProduction: () => false,
  isDevelopment: () => false,
  isTest: () => true,
}));
vi.mock('better-auth', () => ({
  betterAuth: vi.fn(() => ({ api: { getSession: vi.fn() }, handler: vi.fn() })),
}));
vi.mock('better-auth/adapters/prisma', () => ({ prismaAdapter: vi.fn(() => ({})) }));
const mockGetOAuthState = vi.hoisted(() => vi.fn());
vi.mock('better-auth/api', () => ({
  getOAuthState: mockGetOAuthState,
  createAuthMiddleware: vi.fn((fn: unknown) => fn),
  APIError: class APIError extends Error {
    constructor(status: string, body?: { message?: string }) {
      super(body?.message ?? status);
    }
  },
}));

const mockPrisma = vi.hoisted(() => ({
  user: { update: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
  authBootstrap: { findUnique: vi.fn(), upsert: vi.fn() },
  org: { findUnique: vi.fn() },
  orgMembership: {
    upsert:
      vi.fn<
        (args: { create: { orgId: string; userId: string; role: string } }) => Promise<unknown>
      >(),
    count: vi.fn(),
  },
  $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  verification: { findFirst: vi.fn() },
}));
vi.mock('@/lib/db/client', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock('@/lib/email/client', () => ({ validateEmailConfig: vi.fn() }));
vi.mock('@/lib/utils/invitation-token', () => ({
  validateInvitationToken: vi.fn(),
  deleteInvitationToken: vi.fn(),
  getValidInvitation: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/waitlist/link', () => ({
  linkWaitlistEntryToAccount: vi.fn().mockResolvedValue(true),
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({ logger: mockLogger }));

// The request state, as one signup request would carry it between the hooks.
const carrier = vi.hoisted(() => ({
  pending: null as PendingSignup | null,
  accepted: false,
}));
vi.mock('@/lib/auth/pending-signup', () => ({
  setPendingSignup: vi.fn(async (pending: PendingSignup) => {
    carrier.pending = pending;
  }),
  getPendingSignup: vi.fn(async () => carrier.pending),
  setInvitationAccepted: vi.fn(async () => {
    carrier.accepted = true;
  }),
  wasInvitationAccepted: vi.fn(async () => carrier.accepted),
  getRedeemedInvitation: vi.fn(async () => null),
}));

const seam = vi.hoisted(() => ({ resolver: null as SignupOrgResolver | null }));
vi.mock('@/lib/app/signup-org', () => ({
  get appSignupOrgResolver() {
    return seam.resolver;
  },
}));

import {
  userCreateBeforeHook,
  userCreateAfterHook,
  sessionCreateBeforeHook,
} from '@/lib/auth/config';
import { runInvitedSignup } from '@/lib/auth/signup-mode';

const NEW_ORG = 'cmorg00000000000000newws1';
const OTHER_ORG = 'cmorg000000000000000other';
const USER_ID = 'cmuser00000000000000user1';

function newUser(): UserCreateData {
  return {
    id: USER_ID,
    email: 'ada@example.com',
    name: 'Ada',
    emailVerified: false,
    role: 'USER',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function session(): SessionCreateData {
  return {
    userId: USER_ID,
    token: 'tok',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** One signup request, end to end: the row's data, the memberships written, the session's org. */
async function signUp(path: string, run: <T>(fn: () => Promise<T>) => Promise<T> = (fn) => fn()) {
  const { data } = await run(() => userCreateBeforeHook(newUser(), { path }));
  await run(() => userCreateAfterHook(data, { path }));
  const { data: sessionData } = await sessionCreateBeforeHook(session(), { path });
  const memberships = mockPrisma.orgMembership.upsert.mock.calls.map(([args]) => args.create);
  return { data, memberships, activeOrgId: sessionData.activeOrgId };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.TENANCY_MODE = 'multi';
  carrier.pending = null;
  carrier.accepted = false;
  seam.resolver = null;
  mockGetOAuthState.mockResolvedValue(null);
  // Humans exist and the bootstrap has run: not the first signup.
  mockPrisma.authBootstrap.findUnique.mockResolvedValue({ id: 'singleton' });
  mockPrisma.user.count.mockResolvedValue(3);
  mockPrisma.user.update.mockResolvedValue({});
  mockPrisma.user.findUnique.mockResolvedValue({ erasureRequestedAt: null });
  mockPrisma.org.findUnique.mockResolvedValue({ status: 'ACTIVE' });
  mockPrisma.orgMembership.upsert.mockResolvedValue({ id: 'm1' });
  // The resolved org is new: nobody is in it yet.
  mockPrisma.orgMembership.count.mockResolvedValue(0);
});

describe('with a signup-org resolver registered', () => {
  beforeEach(() => {
    seam.resolver = vi.fn(async () => NEW_ORG);
  });

  it.each([
    ['password', '/sign-up/email'],
    ['OAuth', '/callback/google'],
  ])(
    'an uninvited %s signup lands in the resolved org only, as OWNER, and its first session starts there',
    async (_label, path) => {
      const { data, memberships, activeOrgId } = await signUp(path);

      expect(seam.resolver).toHaveBeenCalledWith({ email: 'ada@example.com', name: 'Ada' });
      expect(data).toMatchObject({ signupOrgId: NEW_ORG, signupOrgRole: ORG_OWNER_ROLE });
      expect(memberships).toEqual([{ orgId: NEW_ORG, userId: USER_ID, role: ORG_OWNER_ROLE }]);
      expect(activeOrgId).toBe(NEW_ORG);
      expect(mockLogger.error).not.toHaveBeenCalled();
    }
  );

  it('an invited signup is unchanged: the invitation decides, and the resolver is never asked', async () => {
    mockPrisma.orgMembership.count.mockResolvedValue(2);
    const invitation = {
      name: 'Ada',
      role: 'USER',
      invitedBy: 'admin-id',
      invitedAt: new Date().toISOString(),
      orgId: OTHER_ORG,
    };

    const { memberships, activeOrgId } = await signUp('/sign-up/email', (fn) =>
      runInvitedSignup(fn, invitation)
    );

    expect(seam.resolver).not.toHaveBeenCalled();
    expect(memberships).toEqual([{ orgId: OTHER_ORG, userId: USER_ID, role: DEFAULT_ORG_ROLE }]);
    expect(activeOrgId).toBe(OTHER_ORG);
  });

  it('the first human on a fresh database is never asked, and owns the install org', async () => {
    mockPrisma.authBootstrap.findUnique.mockResolvedValue(null);
    mockPrisma.user.count.mockResolvedValue(0);

    const { memberships } = await signUp('/sign-up/email');

    expect(seam.resolver).not.toHaveBeenCalled();
    expect(memberships).toEqual([{ orgId: INSTALL_ORG_ID, userId: USER_ID, role: ORG_OWNER_ROLE }]);
  });

  it.each([
    ['throws', () => Promise.reject(new Error('org service down')), 'Signup org resolver failed'],
    ['answers nothing', () => null, 'Signup org resolver named no org'],
    ['names a missing org', () => 'cmorg0000000000000missing', 'does not exist'],
  ])(
    'a resolver that %s falls back to the install org, logged at error',
    async (_label, resolve, message) => {
      seam.resolver = resolve;
      mockPrisma.org.findUnique.mockResolvedValue(null);

      const { data, memberships, activeOrgId } = await signUp('/sign-up/email');

      expect(data).toMatchObject({ signupOrgId: INSTALL_ORG_ID, signupOrgRole: DEFAULT_ORG_ROLE });
      expect(memberships).toEqual([
        { orgId: INSTALL_ORG_ID, userId: USER_ID, role: DEFAULT_ORG_ROLE },
      ]);
      expect(activeOrgId).toBe(INSTALL_ORG_ID);
      const logged = mockLogger.error.mock.calls.find(([text]) => String(text).includes(message));
      expect(logged?.at(-1)).toMatchObject({ email: 'ada@example.com' });
    }
  );
});

describe('with no resolver registered (rest state)', () => {
  it.each(['single', 'multi'] as const)(
    'at %s an uninvited signup is decided exactly as before',
    async (mode) => {
      mockEnv.TENANCY_MODE = mode;

      const { data } = await userCreateBeforeHook(newUser(), { path: '/sign-up/email' });

      // The row as it was always written, field for field.
      expect(data).toEqual({
        ...newUser(),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        signupOrgId: INSTALL_ORG_ID,
        signupOrgRole: DEFAULT_ORG_ROLE,
      });
      expect(carrier.pending).toEqual({
        membership: { orgId: INSTALL_ORG_ID, role: DEFAULT_ORG_ROLE },
      });
      // Nothing extra was read or logged.
      expect(mockPrisma.org.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.orgMembership.count).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    }
  );
});

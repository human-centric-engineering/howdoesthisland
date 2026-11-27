/**
 * Tests: the tenant scope the signup hooks write memberships in (t-91).
 *
 * FORK NOTE (HowDoesThisLand, t-91): this pins a fork edit to a core file.
 * `lib/auth/config.ts` runs `writeNewUserMemberships` (user-create after hook)
 * and `activeOrgForSession` (session-create before hook) inside `runAsSystem`
 * at `multi`, because both carry raw SQL (`clearAwaitingFounder`, in
 * `lib/tenancy/membership.ts`) that the data layer refuses with no tenant
 * context, and an auth hook's stack enters no org. Without it every
 * self-serve signup's membership write failed. Ledger:
 * `.context/app/platform-divergences.md` row 36. If upstream takes the fix,
 * retire this file with the row.
 *
 * The REAL `@/lib/tenancy/context` runs here: each mocked membership function
 * records `getTenantContext()` at the moment it is called, so what is proven is
 * the scope the call really ran in, not that a spy was invoked. At `multi` it
 * must be the system scope; at `single` there must be no context at all.
 *
 * @see lib/auth/config.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserCreateData, SessionCreateData } from '@/lib/auth/config';
import type { PendingSignup } from '@/lib/auth/pending-signup';
import { getTenantContext, type TenantContext } from '@/lib/tenancy/context';
import { ORG_OWNER_ROLE } from '@/lib/tenancy/roles';

const NEW_ORG = 'cmorg00000000000000signup';

const carrier = vi.hoisted(() => ({ pending: null as PendingSignup | null }));
vi.mock('@/lib/auth/pending-signup', () => ({
  setPendingSignup: vi.fn(async (pending: PendingSignup) => {
    carrier.pending = pending;
  }),
  getPendingSignup: vi.fn(async () => carrier.pending),
  setInvitationAccepted: vi.fn(),
  wasInvitationAccepted: vi.fn(async () => false),
  getRedeemedInvitation: vi.fn(async () => null),
}));

const mockEnv = vi.hoisted(() => ({
  TENANCY_MODE: 'multi',
  REQUIRE_EMAIL_VERIFICATION: true,
  NODE_ENV: 'test',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

vi.mock('better-auth', () => ({ betterAuth: vi.fn(() => ({ api: {}, handler: vi.fn() })) }));
vi.mock('better-auth/adapters/prisma', () => ({ prismaAdapter: vi.fn(() => ({})) }));
vi.mock('better-auth/api', () => ({
  getOAuthState: vi.fn(async () => ({})),
  createAuthMiddleware: vi.fn((fn: unknown) => fn),
  APIError: class APIError extends Error {
    constructor(status: string, body: { message?: string } = {}) {
      super(body.message ?? status);
    }
  },
}));
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ validateEmailConfig: vi.fn() }));
vi.mock('@/lib/email/registry', () => ({ resolveEmailTemplate: vi.fn(() => null) }));
vi.mock('@/lib/waitlist/link', () => ({ linkWaitlistEntryToAccount: vi.fn() }));
vi.mock('@/lib/utils/invitation-token', () => ({
  validateInvitationToken: vi.fn(),
  consumeInvitation: vi.fn(),
  findInvitationByToken: vi.fn(),
}));

const db = vi.hoisted(() => ({
  user: {
    update: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(async (): Promise<Record<string, unknown>> => ({
      role: 'ADMIN',
      orgMemberships: [],
    })),
  },
  authBootstrap: { findUnique: vi.fn(), upsert: vi.fn() },
  org: { findUnique: vi.fn() },
  orgMembership: { upsert: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  $executeRaw: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({ prisma: db }));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({ logger: mockLogger }));

const mockCreateSignupOrg = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tenancy/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/lifecycle')>()),
  createSignupOrg: mockCreateSignupOrg,
  completeSignupOrg: vi.fn(async () => undefined),
  completeFoundedSignupOrgs: vi.fn(async () => undefined),
}));

/** The scope each membership function was called in, read at call time. */
const seen = vi.hoisted(() => ({
  write: [] as Array<TenantContext | null>,
  choose: [] as Array<TenantContext | null>,
}));
const membershipFns = vi.hoisted(() => ({
  write: vi.fn(),
  choose: vi.fn(),
}));
vi.mock('@/lib/tenancy/membership', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/membership')>()),
  writeNewUserMemberships: membershipFns.write,
  activeOrgForSession: membershipFns.choose,
}));

import {
  userCreateBeforeHook,
  userCreateAfterHook,
  sessionCreateBeforeHook,
} from '@/lib/auth/config';
import { __resetSignupOrgResolverForTests } from '@/lib/tenancy/signup-org';

const EMAIL_PATH = { path: '/sign-up/email' };

const user: UserCreateData = {
  id: 'cmuser0000000000000signup',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  emailVerified: false,
  role: 'USER',
  createdAt: new Date('2026-11-19'),
  updatedAt: new Date('2026-11-19'),
};

function session(userId: string): SessionCreateData {
  return {
    userId,
    token: 't',
    expiresAt: new Date('2026-12-19'),
    createdAt: new Date('2026-11-19'),
    updatedAt: new Date('2026-11-19'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  carrier.pending = null;
  seen.write.length = 0;
  seen.choose.length = 0;
  mockEnv.TENANCY_MODE = 'multi';
  __resetSignupOrgResolverForTests();
  db.authBootstrap.findUnique.mockResolvedValue({ id: 'singleton' });
  db.user.update.mockResolvedValue({});
  db.orgMembership.findMany.mockResolvedValue([]);
  mockCreateSignupOrg.mockResolvedValue({ id: NEW_ORG, slug: 'ada-1', name: 'x' });
  membershipFns.write.mockImplementation(async () => {
    seen.write.push(getTenantContext());
    return { founded: null };
  });
  membershipFns.choose.mockImplementation(async () => {
    seen.choose.push(getTenantContext());
    return { orgId: NEW_ORG, healed: false };
  });
});

/** The before hook decides the signup; the after hook then writes its memberships. */
async function runAfterHook(): Promise<void> {
  const { data: row } = await userCreateBeforeHook(user, EMAIL_PATH);
  await userCreateAfterHook(row, EMAIL_PATH);
}

describe('the new user’s memberships are written in the system scope at multi', () => {
  it('runs writeNewUserMemberships inside the system tenant scope', async () => {
    await runAfterHook();

    expect(membershipFns.write).toHaveBeenCalledTimes(1);
    expect(membershipFns.write).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({
        membership: expect.objectContaining({ orgId: NEW_ORG, role: ORG_OWNER_ROLE }),
      })
    );
    expect(seen.write).toEqual([{ orgId: null, source: 'system' }]);
    expect(mockLogger.info).toHaveBeenCalledWith('Entering system tenant scope', {
      reason: 'auth: write a new user’s memberships',
    });
  });

  it('does not leave the system scope behind once the write returns', async () => {
    await runAfterHook();

    expect(getTenantContext()).toBeNull();
  });

  it('at single, writes with no tenant context and enters no system scope', async () => {
    mockEnv.TENANCY_MODE = 'single';

    await runAfterHook();

    expect(membershipFns.write).toHaveBeenCalledTimes(1);
    expect(seen.write).toEqual([null]);
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      'Entering system tenant scope',
      expect.anything()
    );
  });
});

describe('a new session’s org is chosen in the system scope at multi', () => {
  it('runs activeOrgForSession inside the system tenant scope and uses its answer', async () => {
    const { data } = await sessionCreateBeforeHook(session(user.id), EMAIL_PATH);

    expect(membershipFns.choose).toHaveBeenCalledWith(user.id);
    expect(seen.choose).toEqual([{ orgId: null, source: 'system' }]);
    expect(data.activeOrgId).toBe(NEW_ORG);
    expect(mockLogger.info).toHaveBeenCalledWith('Entering system tenant scope', {
      reason: 'auth: choose a new session’s org',
    });
  });

  it('at single, chooses with no tenant context and enters no system scope', async () => {
    mockEnv.TENANCY_MODE = 'single';

    const { data } = await sessionCreateBeforeHook(session(user.id), EMAIL_PATH);

    expect(seen.choose).toEqual([null]);
    expect(data.activeOrgId).toBe(NEW_ORG);
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      'Entering system tenant scope',
      expect.anything()
    );
  });
});

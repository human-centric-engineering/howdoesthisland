/**
 * Tests: lib/app/authorization.ts — only a platform admin administers (t-64).
 *
 * Every signup owns a workspace, so at `TENANCY_MODE=multi` Sunrise's default
 * would let every customer administer their own org: the `/admin` area, the
 * org-tier orchestration routes, `/admin/members` and `/admin/waitlist`. These
 * tests read the REAL seam and drive the REAL guard and admin-page check, with
 * the membership read mocked at Prisma, so what they show is what a request
 * meets:
 *
 * - a workspace OWNER and ADMIN are refused, and a platform admin admitted,
 *   on an org-tier orchestration route, on `/api/v1/admin/waitlist`, and on
 *   the admin layout's page check for `/admin/members` and `/admin/waitlist`;
 * - the control: under Sunrise's default the same OWNER and ADMIN ARE
 *   admitted, so the refusals above are this policy's;
 * - the read face is untouched: `canRead` and `subjectScope` are the
 *   default's, so the app's own workspace surfaces (which use `withAuth` and
 *   core's org routes, e.g. the roster) keep working.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ORG_ADMIN_ROLE, ORG_OWNER_ROLE, DEFAULT_ORG_ROLE } from '@/lib/tenancy/roles';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';

// The seam under test is the real one, not tests/setup.ts's pin.
vi.mock('@/lib/app/authorization', (importOriginal) => importOriginal());

const mockEnv = vi.hoisted(() => ({ TENANCY_MODE: 'multi' }));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const mockMembership = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/client', () => ({
  prisma: { orgMembership: { findUnique: mockMembership }, org: { findMany: vi.fn() } },
}));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }));
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/lib/auth/api-keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/api-keys')>()),
  resolveApiKey: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/auth/utils', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth/session-principal', () => ({ sessionPrincipal: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { auth } from '@/lib/auth/config';
import { withAdminAuth } from '@/lib/auth/guards';
import {
  DEFAULT_AUTHORIZATION_POLICY,
  getAuthorizationPolicy,
  hasAppAuthorizationPolicy,
  __resetAuthorizationPolicyForTests,
  type AuthorizationPrincipal,
} from '@/lib/auth/authorization';
import { adminPageTierOf, reachesAdminPage } from '@/lib/auth/admin-tier';
import { namedTierAdminPages, orgTierAdminPages } from '@/lib/auth/org-tier-admin-pages';
import { requestAdminReach } from '@/lib/auth/admin-page-viewer';
import { getServerSession } from '@/lib/auth/utils';
import { sessionPrincipal } from '@/lib/auth/session-principal';
import { platformAdminOnlyPolicy } from '@/lib/app/authorization';
import { successResponse } from '@/lib/api/responses';
import { createMockAuthSession } from '@/tests/helpers/auth';

const WORKSPACE = 'cmorg00000000000workspace';

function session(role: 'USER' | 'ADMIN', activeOrgId: string | null = WORKSPACE) {
  const base = createMockAuthSession();
  return {
    session: { ...base.session, activeOrgId },
    user: { ...base.user, role },
  };
}

/** The guard's membership read for the entered workspace. */
function memberOf(role: string | null) {
  mockMembership.mockResolvedValue(role ? ({ role, org: { status: 'ACTIVE' } } as never) : null);
}

/** An org-tier admin route, declared as core's orchestration and waitlist routes are. */
function orgTierRoute() {
  const ran = vi.fn();
  const handler = withAdminAuth(
    () => {
      ran();
      return successResponse({ ok: true });
    },
    { tier: 'org', ownership: { decidedBy: 'nothing', because: 'test route' } }
  );
  return { handler, ran };
}

function request(path: string) {
  return new NextRequest(`http://localhost:3000${path}`);
}

function principal(overrides: Partial<AuthorizationPrincipal> = {}): AuthorizationPrincipal {
  return {
    userId: 'u1',
    role: 'USER',
    credential: 'session',
    orgId: WORKSPACE,
    orgRole: ORG_OWNER_ROLE,
    ...overrides,
  };
}

beforeEach(() => {
  mockEnv.TENANCY_MODE = 'multi';
  __resetAuthorizationPolicyForTests();
});

afterEach(() => {
  vi.clearAllMocks();
  __resetAuthorizationPolicyForTests();
});

describe('the registered policy', () => {
  it('is the app’s own, and keeps the default’s read faces', () => {
    const policy = getAuthorizationPolicy();

    expect(hasAppAuthorizationPolicy()).toBe(true);
    expect(policy.canAdminister).not.toBe(DEFAULT_AUTHORIZATION_POLICY.canAdminister);
    expect(policy.canRead).toBe(DEFAULT_AUTHORIZATION_POLICY.canRead);
    expect(policy.subjectScope).toBe(DEFAULT_AUTHORIZATION_POLICY.subjectScope);
  });
});

describe.each([
  ['/api/v1/admin/orchestration/agents', 'an org-tier orchestration route'],
  ['/api/v1/admin/waitlist', 'the waitlist route'],
])('withAdminAuth on %s (%s)', (path) => {
  it.each([ORG_OWNER_ROLE, ORG_ADMIN_ROLE])(
    'refuses a workspace %s with 403, running nothing',
    async (role) => {
      vi.mocked(auth.api.getSession).mockResolvedValue(session('USER'));
      memberOf(role);
      const { handler, ran } = orgTierRoute();

      expect((await handler(request(path))).status).toBe(403);
      expect(ran).not.toHaveBeenCalled();
    }
  );

  it('admits a platform admin', async () => {
    // From the install org: entering a customer workspace takes a support
    // grant, which is the guard's rule, not this policy's.
    vi.mocked(auth.api.getSession).mockResolvedValue(session('ADMIN', INSTALL_ORG_ID));
    memberOf(ORG_OWNER_ROLE);
    const { handler, ran } = orgTierRoute();

    expect((await handler(request(path))).status).toBe(200);
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it.each([ORG_OWNER_ROLE, ORG_ADMIN_ROLE])(
    'control: Sunrise’s default would admit the same workspace %s to an org-tier route',
    async (orgRole) => {
      await expect(
        DEFAULT_AUTHORIZATION_POLICY.canAdminister(principal({ orgRole }), null, {
          tier: 'org',
          org: WORKSPACE,
        })
      ).resolves.toBe(true);
    }
  );
});

describe.each(['/admin/members', '/admin/waitlist', '/admin/orchestration/agents'])(
  'the admin layout’s page check for %s',
  (page) => {
    // What `app/admin/layout.tsx` asks: the viewer's reach, from the real
    // policy, against the page's tier from the real page lists.
    async function reaches(viewer: AuthorizationPrincipal) {
      vi.mocked(getServerSession).mockResolvedValue(session('USER'));
      vi.mocked(sessionPrincipal).mockResolvedValue({
        principal: viewer,
        scope: { org: WORKSPACE },
      });
      const reach = await requestAdminReach();
      return reachesAdminPage(
        reach,
        page,
        adminPageTierOf(page, orgTierAdminPages(), namedTierAdminPages())
      );
    }

    it('is a page Sunrise opens to the org tier, so this policy is what closes it', () => {
      expect(adminPageTierOf(page, orgTierAdminPages(), namedTierAdminPages())).toBe('org');
    });

    it.each([ORG_OWNER_ROLE, ORG_ADMIN_ROLE])('refuses a workspace %s', async (orgRole) => {
      expect(await reaches(principal({ orgRole }))).toBe(false);
    });

    it('admits a platform admin', async () => {
      expect(await reaches(principal({ role: 'ADMIN', orgRole: null }))).toBe(true);
    });
  }
);

describe('platformAdminOnlyPolicy — narrows the default, never widens it', () => {
  const policy = () => platformAdminOnlyPolicy();

  it('refuses a workspace OWNER even on a row of their own workspace', async () => {
    await expect(
      policy().canAdminister(principal(), { kind: 'org', id: WORKSPACE, orgId: WORKSPACE }, {})
    ).resolves.toBe(false);
  });

  it('refuses a plain member with no org', async () => {
    await expect(
      policy().canAdminister(principal({ orgId: undefined, orgRole: undefined }), null, {})
    ).resolves.toBe(false);
  });

  it('keeps the default’s API-key rule: an admin-scoped key of a platform admin only (#746)', async () => {
    const key = { userId: 'k', credential: 'api-key' as const, scopes: ['admin'] };

    await expect(policy().canAdminister({ ...key, role: 'ADMIN' }, null, {})).resolves.toBe(true);
    await expect(policy().canAdminister({ ...key, role: 'USER' }, null, {})).resolves.toBe(false);
    await expect(
      policy().canAdminister({ ...key, role: 'ADMIN', scopes: ['chat'] }, null, {})
    ).resolves.toBe(false);
  });

  it('refuses a platform admin wherever the default does', async () => {
    const refusing = vi.fn(() => Promise.resolve(false));
    const spy = vi
      .spyOn(DEFAULT_AUTHORIZATION_POLICY, 'canAdminister')
      .mockImplementation(refusing);
    try {
      await expect(
        platformAdminOnlyPolicy().canAdminister(principal({ role: 'ADMIN' }), null, {})
      ).resolves.toBe(false);
      expect(refusing).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not ask a member’s default standing at all', async () => {
    const spy = vi.spyOn(DEFAULT_AUTHORIZATION_POLICY, 'canAdminister');
    try {
      await platformAdminOnlyPolicy().canAdminister(
        principal({ orgRole: DEFAULT_ORG_ROLE }),
        null,
        {}
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

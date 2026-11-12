/**
 * Tests: `uninvitedSignupAdmission` — the fork's signup-org resolver, guarded
 * (t-6).
 *
 * The resolver and the database are passed in, so each arm is driven
 * directly. The hooks that consume the answer are covered end to end in
 * tests/unit/lib/auth/config-signup-org.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: mockLogger }));
vi.mock('@/lib/db/client', () => ({ prisma: {} }));
// Mocked, not read: each case passes its resolver in, and a filled seam must
// not change what this file measures.
vi.mock('@/lib/app/signup-org', () => ({ appSignupOrgResolver: null }));

import {
  signupOrgResolverApplies,
  uninvitedSignupAdmission,
  type SignupOrgResolver,
} from '@/lib/tenancy/signup-org';

const ORG = 'cmorg00000000000000newws1';
const signup = { email: 'ada@example.com', name: 'Ada', role: 'USER' };

function db(found: { status: string } | null | Error = { status: 'ACTIVE' }) {
  const findUnique = vi.fn(() =>
    found instanceof Error ? Promise.reject(found) : Promise.resolve(found)
  );
  return { org: { findUnique } } as unknown as Parameters<typeof uninvitedSignupAdmission>[2] & {
    org: { findUnique: typeof findUnique };
  };
}

beforeEach(() => vi.clearAllMocks());

describe('uninvitedSignupAdmission', () => {
  it('with no resolver, answers null without reading anything', async () => {
    const database = db();

    await expect(uninvitedSignupAdmission(signup, null, database)).resolves.toBeNull();
    expect(database.org.findUnique).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('admits to the org the resolver names, once it is shown to exist', async () => {
    const resolver = vi.fn<SignupOrgResolver>(() => ORG);
    const database = db();

    await expect(uninvitedSignupAdmission(signup, resolver, database)).resolves.toEqual({
      orgId: ORG,
    });
    expect(resolver).toHaveBeenCalledWith({ email: 'ada@example.com', name: 'Ada' });
    expect(database.org.findUnique).toHaveBeenCalledWith({
      where: { id: ORG },
      select: { status: true },
    });
  });

  it('never asks for a platform admin, whose org is the install org', async () => {
    const resolver = vi.fn<SignupOrgResolver>(() => ORG);

    await expect(
      uninvitedSignupAdmission({ ...signup, role: 'ADMIN' }, resolver, db())
    ).resolves.toBeNull();
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each([
    ['throws', () => Promise.reject(new Error('down')), db(), 'resolver failed'],
    ['answers null', () => null, db(), 'named no org'],
    ['answers undefined', () => undefined, db(), 'named no org'],
    ['answers an empty string', () => '', db(), 'named no org'],
    ['answers a non-string', () => 42 as unknown as string, db(), 'named no org'],
    ['names a missing org', () => ORG, db(null), 'does not exist'],
    ['names a suspended org', () => ORG, db({ status: 'SUSPENDED' }), 'not active'],
    ['names an org that cannot be read', () => ORG, db(new Error('db')), 'Failed to read'],
  ])(
    'falls back to null, logged at error, when the resolver %s',
    async (_l, resolve, database, msg) => {
      await expect(
        uninvitedSignupAdmission(signup, resolve as SignupOrgResolver, database)
      ).resolves.toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      const [text, ...rest] = mockLogger.error.mock.calls[0];
      expect(String(text)).toContain(msg);
      expect(rest.at(-1)).toMatchObject({ email: 'ada@example.com' });
    }
  );
});

describe('signupOrgResolverApplies', () => {
  const resolver: SignupOrgResolver = () => ORG;

  it.each([
    ['a registered resolver and an ordinary signup', resolver, 'USER', true],
    ['no resolver', null, 'USER', false],
    ['a platform admin', resolver, 'ADMIN', false],
  ] as const)('answers %s for %s', (_l, registered, role, expected) => {
    expect(signupOrgResolverApplies({ ...signup, role }, registered)).toBe(expected);
  });
});

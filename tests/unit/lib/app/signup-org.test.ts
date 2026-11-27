/**
 * Tests: the app's signup-org resolver (t-7, D1; t-91) — every self-serve
 * signup gets a workspace of its own, under a name that is not the person's.
 *
 * FORK NOTE: this is HowDoesThisLand's own test of its own seam, so it reads
 * the real `lib/app/signup-org.ts` on purpose (`tests/setup.ts` pins it to
 * empty for every other file). The registry is mocked at its edge so the
 * resolver can be captured and run. That a resolver is registered at all is
 * pinned in `defaults.test.ts` (ledger row 2).
 *
 * @see lib/app/signup-org.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/app/signup-org', (importOriginal) => importOriginal());

const mockRegister = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tenancy/signup-org', () => ({ registerSignupOrgResolver: mockRegister }));

import { SIGNUP_WORKSPACE_NAME, initAppSignupOrgResolver } from '@/lib/app/signup-org';

type Resolver = (signup: Record<string, unknown>) => unknown;

function registeredResolver(): Resolver {
  initAppSignupOrgResolver();
  expect(mockRegister).toHaveBeenCalledTimes(1);
  return mockRegister.mock.calls[0][0] as Resolver;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('initAppSignupOrgResolver', () => {
  it('names the workspace neutrally', () => {
    expect(SIGNUP_WORKSPACE_NAME).toBe('My workspace');
  });

  it('answers an org of their own, under the neutral name', async () => {
    const answer = await registeredResolver()({
      email: 'ada@example.com',
      emailVerified: true,
      name: 'Ada Lovelace',
      signupMethod: 'email',
      waitlistEntryId: null,
    });

    expect(answer).toEqual({ kind: 'own', name: 'My workspace' });
  });

  it('never copies the person’s name or address into the org name', async () => {
    const answer = await registeredResolver()({
      email: 'grace.hopper@example.com',
      emailVerified: false,
      name: 'Grace Hopper',
      signupMethod: 'oauth',
      waitlistEntryId: null,
    });

    const { name } = answer as { name: string };
    expect(name).not.toMatch(/grace|hopper|example/i);
  });
});

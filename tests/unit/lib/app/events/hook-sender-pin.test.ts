/**
 * Tests: core's event-hook sender pins a customer org's delivery to a checked
 * address, and says nothing of where a refused name points (t-99, ledger
 * row 37, the FORK edit in `lib/orchestration/hooks/registry.ts` `postHook`).
 *
 * Until t-99 only platform admins chose a hook's URL. A workspace owner can
 * now, and the URL guards read the URL's text, not where it resolves, so a
 * name whose DNS answer is private reached the operator's network and
 * `lastError` reported what answered. The webhook dispatcher already pinned
 * (§111 t-811); this holds the hook sender to the same rule.
 *
 * **Behaviour-neutral at rest (B19):** the install org, and a `single`
 * install, send with no dispatcher and the failure text they had before.
 *
 * The dispatcher itself, and what it refuses, are core's and tested there
 * (`tests/unit/lib/security/safe-dispatcher.test.ts`); this pins the wiring.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  TENANCY_MODE: 'multi',
  BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-characters-long',
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    aiEventHook: {
      findMany: vi.fn(async () => [
        {
          id: 'hook-1',
          eventType: 'app.assessment.finished',
          action: { type: 'webhook', url: 'https://internal.attacker.example/hook' },
          filter: null,
          secret: 'a'.repeat(64),
        },
      ]),
    },
    aiEventHookDelivery: {
      create: vi.fn((args: { data: { nextRetryAt?: Date } }) =>
        Promise.resolve({ id: 'del-1', createdAt: new Date(), nextRetryAt: args.data.nextRetryAt })
      ),
      update: vi.fn().mockResolvedValue({ id: 'del-1' }),
      updateMany: mocks.update,
      findUnique: vi.fn().mockResolvedValue({
        id: 'del-1',
        attempts: 0,
        status: 'pending',
        destination: null,
        destinationFingerprint: null,
        previousDestinations: null,
      }),
      updateManyAndReturn: vi.fn().mockResolvedValue([{ id: 'del-1', createdAt: new Date() }]),
    },
  },
}));
vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.stubGlobal('fetch', mocks.fetch);

import { emitHookEventDurably, invalidateHookCache } from '@/lib/orchestration/hooks/registry';
import { UnsafeResolvedAddressError } from '@/lib/security/safe-dispatcher';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { runAsOrg } from '@/lib/tenancy/context';

const CUSTOMER = 'cmorg000000000000000team1';

async function sendAs(orgId: string): Promise<{ dispatcher?: unknown }> {
  await runAsOrg(orgId, () =>
    emitHookEventDurably('app.assessment.finished', { eventId: 'assessment:a1' })
  );
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
  return mocks.fetch.mock.calls[0]?.[1] as { dispatcher?: unknown };
}

/** The `lastError` the failed attempt recorded. */
async function lastError(): Promise<string> {
  await vi.waitFor(() =>
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastError: expect.any(String) }) })
    )
  );
  const call = mocks.update.mock.calls.find(
    (c: [{ data: { lastError?: string } }]) => typeof c[0].data.lastError === 'string'
  );
  return String(call?.[0].data.lastError);
}

const refused = () =>
  new TypeError('fetch failed', {
    cause: new UnsafeResolvedAddressError('internal.attacker.example', '10.0.0.5', 'private_ip'),
  });

beforeEach(() => {
  vi.clearAllMocks();
  invalidateHookCache();
  mockEnv.TENANCY_MODE = 'multi';
  mocks.fetch.mockResolvedValue({ ok: true, status: 200 });
  mocks.update.mockResolvedValue({ count: 1 });
});

describe('the hook sender, for a customer org', () => {
  it('sends through the checked-address dispatcher', async () => {
    const init = await sendAs(CUSTOMER);
    expect(init.dispatcher).toBeDefined();
  });

  it('records a refused address without naming it or where it points', async () => {
    mocks.fetch.mockRejectedValue(refused());
    await sendAs(CUSTOMER);
    const error = await lastError();
    expect(error).toBe(
      'Could not reach the destination: its host is not allowed or does not exist'
    );
    expect(error).not.toContain('10.0.0.5');
  });
});

describe('the hook sender at rest (behaviour-neutral)', () => {
  it('sends with no dispatcher for the install org', async () => {
    const init = await sendAs(INSTALL_ORG_ID);
    expect(init).not.toHaveProperty('dispatcher');
  });

  it('sends with no dispatcher on a single-tenant install', async () => {
    mockEnv.TENANCY_MODE = 'single';
    const init = await sendAs(CUSTOMER);
    expect(init).not.toHaveProperty('dispatcher');
  });

  it('keeps the fetch failure’s own detail for the install org', async () => {
    mocks.fetch.mockRejectedValue(
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      })
    );
    await sendAs(INSTALL_ORG_ID);
    expect(await lastError()).toContain('ECONNREFUSED');
  });
});

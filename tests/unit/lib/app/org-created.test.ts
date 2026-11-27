/**
 * Tests: the app's org-created hook (t-7, D1; t-91) — what it registers, and
 * that its body equips the org through `equipWorkspace`.
 *
 * FORK NOTE: this is HowDoesThisLand's own test of its own seam, so it reads
 * the real `lib/app/org-created.ts` on purpose (`tests/setup.ts` pins it to
 * empty for every other file). The registry is mocked at its edge so the hook
 * can be captured and run, and `equipWorkspace` is mocked: it has its own
 * tests in `workspaces/provision.test.ts`. The seam's key is pinned in
 * `defaults.test.ts` (ledger row 2).
 *
 * @see lib/app/org-created.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/app/org-created', (importOriginal) => importOriginal());

const mockRegister = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tenancy/org-created-hooks', () => ({ registerOrgCreatedHook: mockRegister }));

const mockEquip = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/workspaces/provision', () => ({ equipWorkspace: mockEquip }));

import { EQUIP_WORKSPACE_HOOK, initAppOrgCreatedHooks } from '@/lib/app/org-created';
import type { OrgCreatedHook } from '@/lib/tenancy/org-created-hooks';

const ORG_ID = 'cmorg00000000000000hook001';

/** Register, then hand back the one hook that was registered. */
function registeredHook(): OrgCreatedHook {
  initAppOrgCreatedHooks();
  expect(mockRegister).toHaveBeenCalledTimes(1);
  return mockRegister.mock.calls[0][1] as OrgCreatedHook;
}

/** The context Sunrise passes a hook; only the fields the hook reads matter. */
function ctx(retry: boolean): Parameters<OrgCreatedHook>[0] {
  return {
    orgId: ORG_ID,
    slug: 'my-workspace',
    name: 'My workspace',
    source: 'signup',
    ownerUserId: null,
    retry,
    signal: new AbortController().signal,
  } as unknown as Parameters<OrgCreatedHook>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEquip.mockResolvedValue({ granted: true, grantKept: false, budgetKept: false });
});

describe('initAppOrgCreatedHooks', () => {
  it('registers exactly one hook, under the stable key', () => {
    initAppOrgCreatedHooks();

    expect(EQUIP_WORKSPACE_HOOK).toBe('app:equip-workspace');
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledWith('app:equip-workspace', expect.any(Function));
  });

  it('equips the org on the first run without asking for a reconcile', async () => {
    await registeredHook()(ctx(false));

    expect(mockEquip).toHaveBeenCalledWith(ORG_ID, 'app:equip-workspace', {
      reconcile: false,
      signal: expect.any(AbortSignal),
    });
  });

  it('asks for a reconcile on a retry, when the agents are already placed', async () => {
    await registeredHook()(ctx(true));

    expect(mockEquip).toHaveBeenCalledWith(ORG_ID, 'app:equip-workspace', {
      reconcile: true,
      signal: expect.any(AbortSignal),
    });
  });

  it('lets an equip failure through, so the hook stays owed and is retried', async () => {
    mockEquip.mockRejectedValue(new Error('write failed'));

    await expect(registeredHook()(ctx(false))).rejects.toThrow('write failed');
  });
});

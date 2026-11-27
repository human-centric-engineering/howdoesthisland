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

const mockPastCap = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/workspaces/ownership', () => ({ isPastOwnershipCap: mockPastCap }));

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: mockLogger }));

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
function ctx(
  retry: boolean,
  over: { source?: string; ownerUserId?: string | null } = {}
): Parameters<OrgCreatedHook>[0] {
  return {
    orgId: ORG_ID,
    slug: 'my-workspace',
    name: 'My workspace',
    source: over.source ?? 'signup',
    ownerUserId: over.ownerUserId ?? null,
    retry,
    signal: new AbortController().signal,
  } as unknown as Parameters<OrgCreatedHook>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEquip.mockResolvedValue({ granted: true, grantKept: false, budgetKept: false });
  mockPastCap.mockResolvedValue(false);
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

  it('leaves a team workspace past its owner’s cap unequipped, and is done', async () => {
    mockPastCap.mockResolvedValue(true);

    await expect(
      registeredHook()(ctx(false, { source: 'app', ownerUserId: 'user-1' }))
    ).resolves.toBeUndefined();

    expect(mockPastCap).toHaveBeenCalledWith('user-1', ORG_ID);
    expect(mockEquip).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('past its owner’s cap'),
      expect.objectContaining({ orgId: ORG_ID, ownerUserId: 'user-1' })
    );
  });

  it('equips a team workspace within its owner’s cap', async () => {
    await registeredHook()(ctx(false, { source: 'app', ownerUserId: 'user-1' }));

    expect(mockPastCap).toHaveBeenCalledWith('user-1', ORG_ID);
    expect(mockEquip).toHaveBeenCalledTimes(1);
  });

  it.each(['admin', 'signup'])(
    'does not rank an org made by %s against the cap, and equips it',
    async (source) => {
      mockPastCap.mockResolvedValue(true);

      await registeredHook()(ctx(false, { source, ownerUserId: 'user-1' }));

      expect(mockPastCap).not.toHaveBeenCalled();
      expect(mockEquip).toHaveBeenCalledTimes(1);
    }
  );

  it('lets an equip failure through, so the hook stays owed and is retried', async () => {
    mockEquip.mockRejectedValue(new Error('write failed'));

    await expect(registeredHook()(ctx(false))).rejects.toThrow('write failed');
  });
});

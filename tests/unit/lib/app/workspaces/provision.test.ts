/**
 * Tests: `equipWorkspace`, the body of the org-created hook that gives every
 * new workspace its providers and its default budget (t-7, D1; on Sunrise's
 * seams since t-91), and `createWorkspaceOrg`, the org create it runs after.
 *
 * The database is a small stateful fake of `Org.settings` and the provider
 * table, so the grant and the budget are read back from what was stored
 * rather than from the calls made. The real settings writers run against it.
 * What only a real database can show (the membership, the agents' bindings) is
 * not covered here.
 *
 * The hook that calls it is tested in `org-created.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: mockLogger }));

/** One org's settings column, and the provider rows, as the fake stores them. */
const store = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  providers: new Map<string, string>(),
  failUpdate: false,
  /** Updates still to fail with a serializable clash before they succeed. */
  conflicts: 0,
  /** The error each conflicting update rejects with. */
  conflictError: new Error('unset'),
}));

const fakePrisma = vi.hoisted(() => {
  const org = {
    findUnique: vi.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        store.settings.has(where.id) ? { settings: store.settings.get(where.id) } : null
      )
    ),
    update: vi.fn(({ where, data }: { where: { id: string }; data: { settings: unknown } }) => {
      if (store.failUpdate) return Promise.reject(new Error('write failed'));
      if (store.conflicts > 0) {
        store.conflicts--;
        return Promise.reject(store.conflictError);
      }
      // A plain object is the column; anything else here is `Prisma.DbNull`.
      const value =
        typeof data.settings === 'object' &&
        data.settings !== null &&
        Object.getPrototypeOf(data.settings) === Object.prototype
          ? structuredClone(data.settings)
          : null;
      store.settings.set(where.id, value);
      return Promise.resolve({});
    }),
  };
  const client = {
    org,
    aiProviderConfig: {
      // Answers in the store's order, not the query's, as a database may.
      findMany: vi.fn(({ where }: { where: { slug: { in: string[] } } }) =>
        Promise.resolve(
          [...store.providers]
            .filter(([slug]) => where.slug.in.includes(slug))
            .map(([slug, id]) => ({ slug, id }))
        )
      ),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(client))),
  };
  return client;
});
vi.mock('@/lib/db/client', () => ({ prisma: fakePrisma }));

const events = vi.hoisted(() => [] as string[]);
const mockCreateOrg = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tenancy/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tenancy/lifecycle')>();
  return { ...actual, createOrg: mockCreateOrg };
});

const mockForgetPolicy = vi.hoisted(() => vi.fn(() => events.push('forget-policy')));
const mockForgetCap = vi.hoisted(() => vi.fn(() => events.push('forget-cap')));
const mockForgetRequestCap = vi.hoisted(() => vi.fn(() => events.push('forget-request-cap')));
vi.mock('@/lib/orchestration/llm/org-provider-policy', () => ({
  forgetOrgProviderPolicy: mockForgetPolicy,
}));
vi.mock('@/lib/orchestration/llm/spend-caps', () => ({ forgetOrgCap: mockForgetCap }));
vi.mock('@/lib/security/org-request-cap', () => ({ forgetOrgRequestCap: mockForgetRequestCap }));

/** Records the settings the reconcile would have seen, which is what matters. */
const reconciledWith = vi.hoisted(() => [] as unknown[]);
const mockReconcile = vi.hoisted(() =>
  vi.fn((orgId: string) => {
    events.push('reconcile');
    reconciledWith.push(store.settings.get(orgId));
    return Promise.resolve();
  })
);
vi.mock('@/lib/orchestration/agents/reconcile-platform-agents', () => ({
  tryReconcilePlatformAgents: mockReconcile,
}));

import { OrgLifecycleError } from '@/lib/tenancy/lifecycle';
import { createWorkspaceOrg, equipWorkspace, slugStem } from '@/lib/app/workspaces/provision';
import { readOrgProviderPolicy, readOrgQuotas } from '@/lib/tenancy/org-settings';

const OPENAI_ID = 'cmprov0000000000000openai';
const ANTHROPIC_ID = 'cmprov000000000anthropic';
/** The judges' provider first, then the embedder's. */
const BOTH = [ANTHROPIC_ID, OPENAI_ID];
const ORG_ID = 'cmorg00000000000000equip01';

/** createOrg as the lifecycle does it: a free slug gets a new org row. */
function createOrgAgainst(taken: Set<string>) {
  let n = 0;
  mockCreateOrg.mockImplementation(({ slug, name }: { slug: string; name: string }) => {
    if (taken.has(slug)) {
      return Promise.reject(
        new OrgLifecycleError('SLUG_TAKEN', 'An organisation with that slug already exists')
      );
    }
    taken.add(slug);
    const id = `cmorg${String(++n).padStart(20, '0')}`;
    store.settings.set(id, null);
    events.push('create');
    return Promise.resolve({ id, slug, name });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.settings.clear();
  store.providers.clear();
  store.providers.set('openai', OPENAI_ID);
  store.providers.set('anthropic', ANTHROPIC_ID);
  store.failUpdate = false;
  store.conflicts = 0;
  store.conflictError = new Prisma.PrismaClientKnownRequestError('clash', {
    code: 'P2034',
    clientVersion: 't',
  });
  events.length = 0;
  reconciledWith.length = 0;
  createOrgAgainst(new Set());
  store.settings.set(ORG_ID, null);
});

describe('slugStem', () => {
  it.each([
    ['Ada Lovelace', 'ada-lovelace'],
    ['  Zoë  O’Brien-Smith ', 'zoe-o-brien-smith'],
    ['李小龍', 'workspace'],
    ['a'.repeat(60), 'a'.repeat(40)],
  ])('derives the slug %j → %j', (name, slug) => {
    expect(slugStem(name)).toBe(slug);
    expect(slugStem(name)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

describe('equipWorkspace on a fresh org', () => {
  it('grants the judges’ provider then the embedder’s, and sets the $10 budget', async () => {
    const result = await equipWorkspace(ORG_ID, 'src');

    expect(result).toEqual({ granted: true, grantKept: false, budgetKept: false });
    const settings = store.settings.get(ORG_ID);
    expect(readOrgProviderPolicy(settings)).toEqual({ approved: BOTH });
    expect(readOrgQuotas(settings)).toEqual({ monthlyBudgetUsd: 10 });
  });

  it('forgets the three caches for the org', async () => {
    await equipWorkspace(ORG_ID, 'src');

    expect(mockForgetPolicy).toHaveBeenCalledWith(ORG_ID);
    expect(mockForgetCap).toHaveBeenCalledWith(ORG_ID);
    expect(mockForgetRequestCap).toHaveBeenCalledWith(ORG_ID);
  });

  it('does not reconcile the agents by default: Sunrise places them after the hooks', async () => {
    await equipWorkspace(ORG_ID, 'src');

    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('logs that the workspace was equipped, with what was kept', async () => {
    await equipWorkspace(ORG_ID, 'src');

    expect(mockLogger.info).toHaveBeenCalledWith('Workspace equipped', {
      orgId: ORG_ID,
      granted: true,
      grantKept: false,
      budgetKept: false,
    });
  });
});

describe('equipWorkspace on an org that already has values (a retry)', () => {
  it('keeps an existing provider policy and does not look the providers up', async () => {
    store.settings.set(ORG_ID, { providers: { approved: ['cmadminchoice0000000000001'] } });

    const result = await equipWorkspace(ORG_ID, 'src');

    expect(result).toEqual({ granted: false, grantKept: true, budgetKept: false });
    expect(readOrgProviderPolicy(store.settings.get(ORG_ID))).toEqual({
      approved: ['cmadminchoice0000000000001'],
    });
    expect(fakePrisma.aiProviderConfig.findMany).not.toHaveBeenCalled();
    // The budget was still missing, so it is still given.
    expect(readOrgQuotas(store.settings.get(ORG_ID))).toEqual({ monthlyBudgetUsd: 10 });
  });

  it('treats an admin’s deliberately empty grant as set, not as absent', async () => {
    store.settings.set(ORG_ID, { providers: { approved: [] } });

    const result = await equipWorkspace(ORG_ID, 'src');

    expect(result.grantKept).toBe(true);
    expect(readOrgProviderPolicy(store.settings.get(ORG_ID))).toEqual({ approved: [] });
  });

  it('keeps an existing monthly budget', async () => {
    store.settings.set(ORG_ID, { quotas: { monthlyBudgetUsd: 250 } });

    const result = await equipWorkspace(ORG_ID, 'src');

    expect(result).toEqual({ granted: true, grantKept: false, budgetKept: true });
    expect(readOrgQuotas(store.settings.get(ORG_ID))).toEqual({ monthlyBudgetUsd: 250 });
    expect(readOrgProviderPolicy(store.settings.get(ORG_ID))).toEqual({ approved: BOTH });
  });

  it('adds the budget beside another cap already set, without dropping it', async () => {
    store.settings.set(ORG_ID, { quotas: { requestsPerMinute: 30 } });

    const result = await equipWorkspace(ORG_ID, 'src');

    expect(result.budgetKept).toBe(false);
    expect(readOrgQuotas(store.settings.get(ORG_ID))).toEqual({
      requestsPerMinute: 30,
      monthlyBudgetUsd: 10,
    });
  });

  it('writes nothing when both are already set', async () => {
    store.settings.set(ORG_ID, {
      providers: { approved: [OPENAI_ID] },
      quotas: { monthlyBudgetUsd: 5 },
    });

    const result = await equipWorkspace(ORG_ID, 'src', { reconcile: true });

    expect(result).toEqual({ granted: false, grantKept: true, budgetKept: true });
    expect(fakePrisma.org.update).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
  });
});

describe('equipWorkspace reconcile', () => {
  it('gives the agents out again only after the grant is stored and the caches are forgotten', async () => {
    await equipWorkspace(ORG_ID, 'app:equip-workspace', { reconcile: true });

    expect(mockReconcile).toHaveBeenCalledWith(ORG_ID, 'app:equip-workspace');
    // What the reconcile saw was the granted policy, not the empty one.
    expect(readOrgProviderPolicy(reconciledWith[0])).toEqual({ approved: BOTH });
    expect(events.slice(0, 3).sort()).toEqual([
      'forget-cap',
      'forget-policy',
      'forget-request-cap',
    ]);
    expect(events[3]).toBe('reconcile');
  });

  it('does not reconcile when the grant was kept, however it is asked', async () => {
    store.settings.set(ORG_ID, { providers: { approved: [OPENAI_ID] } });

    await equipWorkspace(ORG_ID, 'src', { reconcile: true });

    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('does not reconcile when no provider row exists to grant', async () => {
    store.providers.clear();

    await equipWorkspace(ORG_ID, 'src', { reconcile: true });

    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it('reconciles when only the embedder’s provider was granted', async () => {
    store.providers.delete('anthropic');

    const result = await equipWorkspace(ORG_ID, 'src', { reconcile: true });

    expect(result.granted).toBe(false);
    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });
});

describe('equipWorkspace with a missing provider row', () => {
  it('without any row: grants nothing, still sets the budget, logs at error, does not throw', async () => {
    store.providers.clear();

    const result = await equipWorkspace(ORG_ID, 'src');

    expect(result).toEqual({ granted: false, grantKept: false, budgetKept: false });
    const settings = store.settings.get(ORG_ID);
    // No policy written at all: the org stays "never granted", so a later retry can still grant.
    expect(settings).not.toHaveProperty('providers');
    expect(readOrgQuotas(settings)).toEqual({ monthlyBudgetUsd: 10 });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'The judges’ provider does not exist; the new workspace’s judges have no model',
      expect.objectContaining({ orgId: ORG_ID, missing: ['anthropic', 'openai'] })
    );
  });

  it('without the judges’ row: grants the rest and says the judges have no model', async () => {
    store.providers.delete('anthropic');

    await equipWorkspace(ORG_ID, 'src');

    expect(readOrgProviderPolicy(store.settings.get(ORG_ID))).toEqual({ approved: [OPENAI_ID] });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'The judges’ provider does not exist; the new workspace’s judges have no model',
      expect.objectContaining({ orgId: ORG_ID, missing: ['anthropic'] })
    );
  });

  it('without the embedder’s row: grants the judges’ and says which is missing', async () => {
    store.providers.delete('openai');

    const result = await equipWorkspace(ORG_ID, 'src');

    expect(result.granted).toBe(true);
    expect(readOrgProviderPolicy(store.settings.get(ORG_ID))).toEqual({ approved: [ANTHROPIC_ID] });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'A workspace provider does not exist; the new workspace is not granted it',
      expect.objectContaining({ orgId: ORG_ID, missing: ['openai'] })
    );
  });
});

describe('equipWorkspace failures', () => {
  it('throws when the org does not exist, writing nothing', async () => {
    await expect(equipWorkspace('cmnoorg0000000000000000001', 'src')).rejects.toThrow(
      /no org cmnoorg0000000000000000001/
    );
    expect(fakePrisma.org.update).not.toHaveBeenCalled();
    expect(mockForgetPolicy).not.toHaveBeenCalled();
  });

  it('throws when the settings cannot be read, so the hook is retried', async () => {
    fakePrisma.org.findUnique.mockRejectedValueOnce(new Error('db down'));

    await expect(equipWorkspace(ORG_ID, 'src')).rejects.toThrow('db down');
  });

  it('throws when a write fails, and does not reconcile', async () => {
    store.failUpdate = true;

    await expect(equipWorkspace(ORG_ID, 'src', { reconcile: true })).rejects.toThrow(
      'write failed'
    );
    expect(mockReconcile).not.toHaveBeenCalled();
    // One attempt only: a failure that is not a clash is not retried here.
    expect(fakePrisma.org.update).toHaveBeenCalledTimes(1);
  });

  it('retries a clashing write, so both values still land', async () => {
    store.conflicts = 2; // the grant clashes twice, then lands on its third try

    await equipWorkspace(ORG_ID, 'src');

    const settings = store.settings.get(ORG_ID);
    expect(readOrgProviderPolicy(settings)).toEqual({ approved: BOTH });
    expect(readOrgQuotas(settings)).toEqual({ monthlyBudgetUsd: 10 });
    expect(fakePrisma.org.update).toHaveBeenCalledTimes(4);
  });

  it('gives up on a write after three clashes and throws the last', async () => {
    store.conflicts = 3;

    await expect(equipWorkspace(ORG_ID, 'src')).rejects.toBe(store.conflictError);
    expect(fakePrisma.org.update).toHaveBeenCalledTimes(3);
    expect(store.settings.get(ORG_ID)).toBeNull();
  });
});

describe('createWorkspaceOrg', () => {
  it('forwards the owner to createOrg, so the founding OWNER is written with the org', async () => {
    createOrgAgainst(new Set());

    await createWorkspaceOrg('Design Team', 'design-team', 'cmuser00000000000000000001');

    expect(mockCreateOrg).toHaveBeenCalledWith({
      slug: 'design-team',
      name: 'Design Team',
      ownerUserId: 'cmuser00000000000000000001',
    });
  });

  it('omits ownerUserId entirely when there is none', async () => {
    createOrgAgainst(new Set());

    await createWorkspaceOrg('Ada', 'ada');

    const arg = mockCreateOrg.mock.calls[0][0];
    expect(arg).toEqual({ slug: 'ada', name: 'Ada' });
    expect(arg).not.toHaveProperty('ownerUserId');
  });

  it('keeps the owner across a slug retry', async () => {
    createOrgAgainst(new Set(['design-team']));

    await createWorkspaceOrg('Design Team', 'design-team', 'cmuser00000000000000000001');

    expect(mockCreateOrg).toHaveBeenCalledTimes(2);
    expect(mockCreateOrg.mock.calls[1][0]).toMatchObject({
      ownerUserId: 'cmuser00000000000000000001',
    });
  });
});

/**
 * Tests: `provisionSignupWorkspace` — the workspace an uninvited signup gets
 * (t-7), and the resolver that hands it to the signup-org seam.
 *
 * The database is a small stateful fake of `Org.settings` and the provider
 * table, so the grant, the budget and the marker are read back from what was
 * stored rather than from the calls made. The real settings writers run
 * against it. What only a real database can show (the membership, the active
 * org, the agents' bindings) is the smoke script's:
 * `scripts/app/smoke-signup-workspace.ts`.
 *
 * FORK NOTE: the last block reads the real `lib/app/signup-org.ts` on purpose:
 * it pins that this app's filled seam hands signups to
 * `provisionSignupWorkspace`. Changing the resolver should fail it.
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
      findUnique: vi.fn(({ where }: { where: { slug: string } }) =>
        Promise.resolve(
          store.providers.has(where.slug) ? { id: store.providers.get(where.slug) } : null
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

/** Records the grant the reconcile would have seen, which is what matters. */
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
import {
  provisionSignupWorkspace,
  slugStem,
  workspaceName,
  writeSignupWorkspaceMarker,
} from '@/lib/app/workspaces/provision';
import { readOrgProviderPolicy, readOrgQuotas } from '@/lib/tenancy/org-settings';
import { appSignupOrgResolver } from '@/lib/app/signup-org';

const OPENAI_ID = 'cmprov0000000000000openai';
const ada = { name: 'Ada Lovelace', email: 'ada@example.com' };

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
  store.failUpdate = false;
  store.conflicts = 0;
  store.conflictError = new Prisma.PrismaClientKnownRequestError('clash', {
    code: 'P2034',
    clientVersion: 't',
  });
  events.length = 0;
  reconciledWith.length = 0;
  createOrgAgainst(new Set());
});

describe('workspace naming', () => {
  it('names the workspace for the person', () => {
    expect(workspaceName(ada)).toBe('Ada Lovelace’s workspace');
  });

  it('falls back to the address when no name was given', () => {
    expect(workspaceName({ name: '  ', email: 'grace@example.com' })).toBe('grace’s workspace');
  });

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

describe('provisionSignupWorkspace', () => {
  it('creates the workspace, grants OpenAI and a $10 budget, and marks it', async () => {
    const orgId = await provisionSignupWorkspace(ada);

    expect(mockCreateOrg).toHaveBeenCalledWith({
      slug: 'ada-lovelace',
      name: 'Ada Lovelace’s workspace',
    });
    const settings = store.settings.get(orgId);
    expect(readOrgProviderPolicy(settings)).toEqual({ approved: [OPENAI_ID] });
    expect(readOrgQuotas(settings)).toEqual({ monthlyBudgetUsd: 10 });
    expect(settings).toMatchObject({ app: { signupWorkspace: true } });
  });

  it('gives out the agents again only after the grant is stored and the caches are forgotten', async () => {
    const orgId = await provisionSignupWorkspace(ada);

    expect(mockReconcile).toHaveBeenCalledWith(orgId, 'app.signup-workspace');
    // What the reconcile saw was the granted policy, not the empty one.
    expect(readOrgProviderPolicy(reconciledWith[0])).toEqual({ approved: [OPENAI_ID] });
    expect(events.indexOf('reconcile')).toBeGreaterThan(events.indexOf('forget-policy'));
    expect(mockForgetPolicy).toHaveBeenCalledWith(orgId);
    expect(mockForgetCap).toHaveBeenCalledWith(orgId);
    expect(mockForgetRequestCap).toHaveBeenCalledWith(orgId);
  });

  it('retries a taken slug with a suffix', async () => {
    createOrgAgainst(new Set(['ada-lovelace']));

    await provisionSignupWorkspace(ada);

    expect(mockCreateOrg).toHaveBeenCalledTimes(2);
    expect(mockCreateOrg.mock.calls[1][0].slug).toMatch(/^ada-lovelace-[0-9a-f]{6}$/);
  });

  it('gives up after four taken slugs, so the seam falls back', async () => {
    mockCreateOrg.mockRejectedValue(new OrgLifecycleError('SLUG_TAKEN', 'taken'));

    await expect(provisionSignupWorkspace(ada)).rejects.toThrow(/No free workspace slug/);
    expect(mockCreateOrg).toHaveBeenCalledTimes(4);
  });

  it('lets any other create failure through, so the seam falls back', async () => {
    mockCreateOrg.mockRejectedValue(new Error('db down'));

    await expect(provisionSignupWorkspace(ada)).rejects.toThrow('db down');
  });

  it('without an OpenAI provider row, still returns the workspace, with no grant and no reconcile', async () => {
    store.providers.clear();

    const orgId = await provisionSignupWorkspace(ada);

    expect(readOrgProviderPolicy(store.settings.get(orgId))).toEqual({ approved: [] });
    expect(readOrgQuotas(store.settings.get(orgId))).toEqual({ monthlyBudgetUsd: 10 });
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'No provider to grant the new workspace; it can call no model',
      expect.objectContaining({ orgId, providerSlug: 'openai' })
    );
  });

  it('when the settings writes fail, still returns the workspace and logs each step', async () => {
    store.failUpdate = true;

    const orgId = await provisionSignupWorkspace(ada);

    expect(orgId).toMatch(/^cmorg/);
    const steps = mockLogger.error.mock.calls
      .filter(([message]) => message === 'New workspace not fully set up')
      .map(([, , context]) => (context as { step: string }).step);
    expect(steps).toEqual(['mark', 'grant', 'budget']);
    expect(mockReconcile).not.toHaveBeenCalled();
  });
});

describe('provisionSignupWorkspace on a write clash', () => {
  it('retries a clashing settings write, so the workspace is still marked', async () => {
    store.conflicts = 2; // the mark clashes twice, then lands on its third try

    const orgId = await provisionSignupWorkspace(ada);

    const settings = store.settings.get(orgId);
    expect(settings).toMatchObject({ app: { signupWorkspace: true } });
    expect(readOrgProviderPolicy(settings)).toEqual({ approved: [OPENAI_ID] });
    expect(readOrgQuotas(settings)).toEqual({ monthlyBudgetUsd: 10 });
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('gives up on a write after three clashes, logs that step, and carries on', async () => {
    store.conflicts = 3;

    const orgId = await provisionSignupWorkspace(ada);

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'New workspace not fully set up',
      store.conflictError,
      { orgId, step: 'mark' }
    );
    const settings = store.settings.get(orgId);
    expect(settings).not.toMatchObject({ app: { signupWorkspace: true } });
    expect(readOrgQuotas(settings)).toEqual({ monthlyBudgetUsd: 10 });
  });

  it('does not retry a write that failed for another reason', async () => {
    store.failUpdate = true;

    await provisionSignupWorkspace(ada);

    // One attempt each at the mark, the grant and the budget.
    expect(fakePrisma.org.update).toHaveBeenCalledTimes(3);
  });
});

describe('writeSignupWorkspaceMarker', () => {
  it('clearing it keeps every other key, and drops an emptied app key', async () => {
    store.settings.set('o1', { quotas: { monthlyBudgetUsd: 10 }, app: { signupWorkspace: true } });

    await writeSignupWorkspaceMarker('o1', false);

    expect(store.settings.get('o1')).toEqual({ quotas: { monthlyBudgetUsd: 10 } });
  });

  it('keeps the rest of the app key', async () => {
    store.settings.set('o1', { app: { signupWorkspace: true, retention: 30 } });

    await writeSignupWorkspaceMarker('o1', false);

    expect(store.settings.get('o1')).toEqual({ app: { retention: 30 } });
  });
});

describe('appSignupOrgResolver', () => {
  it('answers the id of a new workspace for the person signing up', async () => {
    expect(appSignupOrgResolver).not.toBeNull();

    const orgId = await appSignupOrgResolver?.({ ...ada, emailVerified: false });

    expect(mockCreateOrg).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ada Lovelace’s workspace' })
    );
    expect(store.settings.has(orgId as string)).toBe(true);
  });
});

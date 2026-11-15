/**
 * Tests: the one writer of `Org.settings.app` (t-26), and the two that write
 * through it: the retention window and the signup-workspace marker.
 *
 * The database is a small stateful fake of one org's `settings` column, so
 * what survives a write is read back from what was stored rather than from
 * the calls made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const store = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  /** Updates still to fail with the error below before they succeed. */
  failures: 0,
  failWith: new Error('unset'),
}));

const fakePrisma = vi.hoisted(() => {
  const org = {
    findUnique: vi.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(
        store.settings.has(where.id)
          ? { settings: structuredClone(store.settings.get(where.id)) }
          : null
      )
    ),
    update: vi.fn(({ where, data }: { where: { id: string }; data: { settings: unknown } }) => {
      if (store.failures > 0) {
        store.failures--;
        return Promise.reject(store.failWith);
      }
      store.settings.set(where.id, structuredClone(data.settings));
      return Promise.resolve({});
    }),
  };
  const client = {
    org,
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(client))),
  };
  return client;
});
vi.mock('@/lib/db/client', () => ({ prisma: fakePrisma }));

import { readAppSettings, writeAppSettings } from '@/lib/app/workspaces/app-settings';
import { readWorkspaceSettings, writeWorkspaceSettings } from '@/lib/app/retention/settings';
import { writeSignupWorkspaceMarker } from '@/lib/app/workspaces/provision';

const ORG = 'cmorg000000000000000team1';

/** Every key core keeps in `settings`, as a workspace carries them. */
const CORE_SLICES = {
  retention: { executionRetentionDays: 90, costLogRetentionDays: 120 },
  quotas: { monthlyBudgetUsd: 10 },
  providers: { approved: ['cmprov0000000000000openai'] },
  platformAgents: { version: 'abc', reconciledAt: '2026-11-01T00:00:00.000Z' },
};

function serializableClash(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.settings.clear();
  store.failures = 0;
});

describe('writeWorkspaceSettings', () => {
  it('sets the window under `app`, leaving every core slice and the signup marker as they were', async () => {
    store.settings.set(ORG, { ...CORE_SLICES, app: { signupWorkspace: true } });

    const written = await writeWorkspaceSettings(ORG, { retention: { days: 30 } });

    expect(written).toEqual({ retention: { days: 30 }, judgeReplyRetention: { days: 30 } });
    expect(store.settings.get(ORG)).toEqual({
      ...CORE_SLICES,
      app: { signupWorkspace: true, retention: { days: 30 } },
    });
    expect(fakePrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('clears the window, leaving every core slice and the marker', async () => {
    store.settings.set(ORG, {
      ...CORE_SLICES,
      app: { signupWorkspace: true, retention: { days: 30 } },
    });

    const written = await writeWorkspaceSettings(ORG, { retention: null });

    expect(written).toEqual({ retention: null, judgeReplyRetention: { days: 30 } });
    expect(store.settings.get(ORG)).toEqual({ ...CORE_SLICES, app: { signupWorkspace: true } });
  });

  it('drops an emptied `app` key, leaving `{}`, which reads as nothing set', async () => {
    store.settings.set(ORG, { app: { retention: { days: 7 } } });

    await writeWorkspaceSettings(ORG, { retention: null });

    expect(store.settings.get(ORG)).toEqual({});
    expect(readAppSettings(store.settings.get(ORG))).toEqual({});
  });

  it('writes into a column that was NULL', async () => {
    store.settings.set(ORG, null);

    await writeWorkspaceSettings(ORG, { retention: { days: 365 } });

    expect(store.settings.get(ORG)).toEqual({ app: { retention: { days: 365 } } });
  });

  it('answers null, writing nothing, for an org that does not exist', async () => {
    expect(
      await writeWorkspaceSettings('cmorg0000000000000missing', { retention: { days: 30 } })
    ).toBeNull();
    expect(fakePrisma.org.update).not.toHaveBeenCalled();
  });
});

describe('the judge reply window', () => {
  it('sets it beside the content window, leaving that and every core slice', async () => {
    store.settings.set(ORG, { ...CORE_SLICES, app: { retention: { days: 90 } } });

    const written = await writeWorkspaceSettings(ORG, { judgeReplyRetention: { days: 7 } });

    expect(written).toEqual({ retention: { days: 90 }, judgeReplyRetention: { days: 7 } });
    expect(store.settings.get(ORG)).toEqual({
      ...CORE_SLICES,
      app: { retention: { days: 90 }, judgeReplyRetention: { days: 7 } },
    });
  });

  it('null returns it to the default, 30 days', async () => {
    store.settings.set(ORG, { app: { judgeReplyRetention: { days: 7 } } });

    const written = await writeWorkspaceSettings(ORG, { judgeReplyRetention: null });

    expect(written).toEqual({ retention: null, judgeReplyRetention: { days: 30 } });
    expect(store.settings.get(ORG)).toEqual({});
  });

  it('a key left out of the patch is left as stored', async () => {
    store.settings.set(ORG, { app: { retention: { days: 90 }, judgeReplyRetention: { days: 7 } } });

    await writeWorkspaceSettings(ORG, { retention: { days: 120 } });

    expect(store.settings.get(ORG)).toEqual({
      app: { retention: { days: 120 }, judgeReplyRetention: { days: 7 } },
    });
  });
});

describe('the signup marker goes through the same writer', () => {
  it('setting and clearing it keeps the retention window and every core slice', async () => {
    store.settings.set(ORG, { ...CORE_SLICES, app: { retention: { days: 30 } } });

    await writeSignupWorkspaceMarker(ORG, true);
    expect(store.settings.get(ORG)).toEqual({
      ...CORE_SLICES,
      app: { retention: { days: 30 }, signupWorkspace: true },
    });

    await writeSignupWorkspaceMarker(ORG, false);
    expect(store.settings.get(ORG)).toEqual({ ...CORE_SLICES, app: { retention: { days: 30 } } });
  });

  it('retries a serializable clash on a fresh read, as the window does', async () => {
    store.settings.set(ORG, { app: {} });
    store.failures = 2;
    store.failWith = serializableClash();

    await writeSignupWorkspaceMarker(ORG, true);

    expect(fakePrisma.org.update).toHaveBeenCalledTimes(3);
    expect(store.settings.get(ORG)).toEqual({ app: { signupWorkspace: true } });
  });
});

describe('writeAppSettings', () => {
  it('gives up after three clashes, rethrowing the last', async () => {
    store.settings.set(ORG, {});
    store.failures = 3;
    store.failWith = serializableClash();

    await expect(writeAppSettings(ORG, (app) => (app.x = 1))).rejects.toMatchObject({
      code: 'P2034',
    });
    expect(fakePrisma.org.update).toHaveBeenCalledTimes(3);
  });

  it('does not retry an error that is not a clash', async () => {
    store.settings.set(ORG, {});
    store.failures = 1;
    store.failWith = new Error('connection lost');

    await expect(writeAppSettings(ORG, (app) => (app.x = 1))).rejects.toThrow('connection lost');
    expect(fakePrisma.org.update).toHaveBeenCalledTimes(1);
  });
});

describe('reading', () => {
  it('readAppSettings answers {} for a column with no object `app` key', () => {
    expect(readAppSettings(null)).toEqual({});
    expect(readAppSettings({ quotas: {} })).toEqual({});
    expect(readAppSettings({ app: 'nope' })).toEqual({});
    expect(readAppSettings({ app: { a: 1 } })).toEqual({ a: 1 });
  });

  it('readWorkspaceSettings reads stored windows, filling in the reply default', () => {
    expect(
      readWorkspaceSettings({ app: { retention: { days: 30 }, judgeReplyRetention: { days: 7 } } })
    ).toEqual({ retention: { days: 30 }, judgeReplyRetention: { days: 7 } });
    expect(readWorkspaceSettings(null)).toEqual({
      retention: null,
      judgeReplyRetention: { days: 30 },
    });
  });

  it.each([
    ['zero days', { days: 0 }],
    ['a bare number', 30],
    ['a fraction of a day', { days: 1.5 }],
  ])('reads %s as unset: no content window, the default reply window', (_l, stored) => {
    // Unreadable means never purge on a guess.
    expect(
      readWorkspaceSettings({ app: { retention: stored, judgeReplyRetention: stored } })
    ).toEqual({ retention: null, judgeReplyRetention: { days: 30 } });
  });
});

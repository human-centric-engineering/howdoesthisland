/**
 * Getting existing workspaces ready for the judges' provider (t-39): the
 * provider added to each org's approved list with the rest of its policy and
 * settings kept, read and written in one serializable transaction, the
 * install org skipped and an approved org left alone; no reconcile; and a
 * workspace's choice of a model no longer approved handed back to the
 * platform.
 */
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ANTHROPIC_ID = 'prov-anthropic';
const OPENAI_ID = 'prov-openai';

const db = vi.hoisted(() => {
  const org = { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() };
  return {
    org,
    aiProviderConfig: { findUnique: vi.fn() },
    aiAgent: { findMany: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
});
const reconcile = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db/client', () => ({ prisma: db }));
vi.mock('@/lib/tenancy/context', () => ({
  runAsSystem: (_reason: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@/lib/orchestration/agents/reconcile-platform-agents', () => ({
  tryReconcilePlatformAgents: reconcile,
}));
vi.mock('@/lib/logging', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  grantJudgeProviderToAllOrgs,
  grantProviderToOrg,
  releaseUnapprovedBindings,
} from '@/lib/app/workspaces/judge-provider-grant';

let settingsOf: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  settingsOf = {
    'ws-openai': { providers: { approved: [OPENAI_ID] }, app: { kept: true } },
    'ws-eu': { providers: { approved: [OPENAI_ID], jurisdictions: ['EU'] } },
    'ws-done': { providers: { approved: [OPENAI_ID, ANTHROPIC_ID] } },
  };
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  db.aiProviderConfig.findUnique.mockResolvedValue({ id: ANTHROPIC_ID });
  db.org.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id in settingsOf ? { settings: settingsOf[where.id] } : null
  );
  db.org.update.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: { settings: unknown } }) => {
      settingsOf[where.id] = data.settings;
      return {};
    }
  );
  db.org.findMany.mockResolvedValue([{ id: 'ws-openai' }, { id: 'ws-eu' }, { id: 'ws-done' }]);
});

describe('grantJudgeProviderToAllOrgs()', () => {
  it('adds the judges’ provider to every org but the install org, keeping the rest', async () => {
    const summary = await grantJudgeProviderToAllOrgs();

    expect(db.aiProviderConfig.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'anthropic' } })
    );
    expect(db.org.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { not: 'install' } } })
    );
    // Other settings slices survive, and so does a jurisdiction restriction.
    expect(settingsOf['ws-openai']).toEqual({
      providers: { approved: [OPENAI_ID, ANTHROPIC_ID] },
      app: { kept: true },
    });
    expect(settingsOf['ws-eu']).toEqual({
      providers: { approved: [OPENAI_ID, ANTHROPIC_ID], jurisdictions: ['EU'] },
    });
    expect(summary).toEqual({
      providerSlug: 'anthropic',
      granted: ['ws-openai', 'ws-eu'],
      already: ['ws-done'],
    });
  });

  it('reads and writes each org in one serializable transaction, and reconciles nothing', async () => {
    await grantJudgeProviderToAllOrgs();

    for (const call of db.$transaction.mock.calls) {
      expect(call[1]).toEqual({ isolationLevel: 'Serializable' });
    }
    expect(db.$transaction).toHaveBeenCalledTimes(3);
    // The running build may not approve the new default yet.
    expect(reconcile).not.toHaveBeenCalled();
    expect(db.org.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ws-done' } })
    );
  });

  it('grants nothing when the judges’ provider has no row', async () => {
    db.aiProviderConfig.findUnique.mockResolvedValue(null);

    await expect(grantJudgeProviderToAllOrgs()).resolves.toEqual({
      providerSlug: null,
      granted: [],
      already: [],
    });
    expect(db.org.findMany).not.toHaveBeenCalled();
    expect(db.org.update).not.toHaveBeenCalled();
  });
});

describe('grantProviderToOrg()', () => {
  it('answers missing for an org that does not exist, writing nothing', async () => {
    await expect(grantProviderToOrg('gone', ANTHROPIC_ID)).resolves.toBe('missing');
    expect(db.org.update).not.toHaveBeenCalled();
  });

  it('starts an org with no policy from an empty list', async () => {
    settingsOf['ws-new'] = null;
    await expect(grantProviderToOrg('ws-new', ANTHROPIC_ID)).resolves.toBe('granted');
    expect(settingsOf['ws-new']).toEqual({ providers: { approved: [ANTHROPIC_ID] } });
  });

  it('retries a transaction that clashed with another, on a fresh read', async () => {
    db.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('clash', { code: 'P2034', clientVersion: 'x' })
    );
    await expect(grantProviderToOrg('ws-openai', ANTHROPIC_ID)).resolves.toBe('granted');
    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });
});

describe('releaseUnapprovedBindings()', () => {
  it('hands back to the platform only the choices no longer on their role’s list', async () => {
    db.aiAgent.findMany.mockResolvedValue([
      // Removed in t-39: handed back.
      { id: 'a1', slug: 'hdtl-judge-ethos', provider: 'anthropic', model: 'claude-sonnet-4' },
      { id: 'a2', slug: 'hdtl-editor', provider: 'anthropic', model: 'claude-haiku-5-5' },
      // Still approved: kept.
      { id: 'a3', slug: 'hdtl-judge-influence', provider: 'openai', model: 'gpt-4.1' },
      { id: 'a4', slug: 'hdtl-editor', provider: 'anthropic', model: 'claude-opus-5-5' },
    ]);

    await expect(releaseUnapprovedBindings()).resolves.toEqual(['a1', 'a2']);
    expect(db.aiAgent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ bindingOwner: 'org' }),
      })
    );
    expect(db.aiAgent.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'a2'] }, bindingOwner: 'org' },
      data: { bindingOwner: 'platform' },
    });
  });

  it('writes nothing when every choice is still approved', async () => {
    db.aiAgent.findMany.mockResolvedValue([
      { id: 'a3', slug: 'hdtl-judge-ethos', provider: 'openai', model: 'gpt-4o' },
    ]);
    await expect(releaseUnapprovedBindings()).resolves.toEqual([]);
    expect(db.aiAgent.updateMany).not.toHaveBeenCalled();
  });
});

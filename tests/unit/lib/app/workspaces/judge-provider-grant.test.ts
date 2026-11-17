/**
 * Approving existing workspaces for the judges' provider (t-39): added to
 * each org's approved list with the rest of its policy kept, the install org
 * skipped, an approved org left alone, and each granted org's cached policy
 * cleared and its agents reconciled.
 */
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ANTHROPIC_ID = 'prov-anthropic';
const OPENAI_ID = 'prov-openai';

const db = vi.hoisted(() => ({
  org: { findUnique: vi.fn(), findMany: vi.fn() },
  aiProviderConfig: { findUnique: vi.fn() },
}));
const write = vi.hoisted(() => vi.fn());
const reconcile = vi.hoisted(() => vi.fn());
const forget = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db/client', () => ({ prisma: db }));
vi.mock('@/lib/tenancy/context', () => ({
  runAsSystem: (_reason: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@/lib/tenancy/org-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/org-settings')>()),
  writeOrgProviderPolicy: write,
}));
vi.mock('@/lib/orchestration/llm/org-provider-policy', () => ({
  forgetOrgProviderPolicy: forget,
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
} from '@/lib/app/workspaces/judge-provider-grant';

const settingsOf: Record<string, unknown> = {
  'ws-openai': { providers: { approved: [OPENAI_ID] }, app: { kept: true } },
  'ws-eu': { providers: { approved: [OPENAI_ID], jurisdictions: ['EU'] } },
  'ws-done': { providers: { approved: [OPENAI_ID, ANTHROPIC_ID] } },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.aiProviderConfig.findUnique.mockResolvedValue({ id: ANTHROPIC_ID });
  db.org.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    where.id in settingsOf ? { settings: settingsOf[where.id] } : null
  );
  db.org.findMany.mockResolvedValue([{ id: 'ws-openai' }, { id: 'ws-eu' }, { id: 'ws-done' }]);
  write.mockImplementation(async () => ({ previous: {}, stored: {} }));
  reconcile.mockResolvedValue(undefined);
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
    expect(write).toHaveBeenCalledWith('ws-openai', { approved: [OPENAI_ID, ANTHROPIC_ID] });
    // A jurisdiction restriction survives the grant.
    expect(write).toHaveBeenCalledWith('ws-eu', {
      approved: [OPENAI_ID, ANTHROPIC_ID],
      jurisdictions: ['EU'],
    });
    expect(summary).toEqual({
      providerSlug: 'anthropic',
      granted: ['ws-openai', 'ws-eu'],
      already: ['ws-done'],
    });
  });

  it('clears each granted org’s cached policy and reconciles it, and leaves an approved org alone', async () => {
    await grantJudgeProviderToAllOrgs();

    expect(forget.mock.calls).toEqual([['ws-openai'], ['ws-eu']]);
    expect(reconcile.mock.calls).toEqual([
      ['ws-openai', 'app: judge provider grant'],
      ['ws-eu', 'app: judge provider grant'],
    ]);
    expect(write).not.toHaveBeenCalledWith('ws-done', expect.anything());
  });

  it('grants nothing when the judges’ provider has no row', async () => {
    db.aiProviderConfig.findUnique.mockResolvedValue(null);

    await expect(grantJudgeProviderToAllOrgs()).resolves.toEqual({
      providerSlug: null,
      granted: [],
      already: [],
    });
    expect(db.org.findMany).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});

describe('grantProviderToOrg()', () => {
  it('answers missing for an org that does not exist, writing nothing', async () => {
    await expect(grantProviderToOrg('gone', ANTHROPIC_ID)).resolves.toBe('missing');
    expect(write).not.toHaveBeenCalled();
  });

  it('starts an org with no policy from an empty list', async () => {
    db.org.findUnique.mockResolvedValue({ settings: {} });
    await expect(grantProviderToOrg('ws-new', ANTHROPIC_ID)).resolves.toBe('granted');
    expect(write).toHaveBeenCalledWith('ws-new', { approved: [ANTHROPIC_ID] });
  });

  it('retries a write that clashed with another, on a fresh read', async () => {
    write
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('clash', { code: 'P2034', clientVersion: 'x' })
      )
      .mockResolvedValueOnce({ previous: {}, stored: {} });
    await expect(grantProviderToOrg('ws-openai', ANTHROPIC_ID)).resolves.toBe('granted');
    expect(db.org.findUnique).toHaveBeenCalledTimes(2);
  });
});

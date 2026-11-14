/**
 * Tests: a workspace choosing its judges' and editor's models (j4, D8).
 *
 * What is offered is the role's approved list intersected with an
 * availability input, which these tests hand in directly: the same seam
 * Sunrise's tenancy layer will fill. Mocked: the agent rows and writes, the
 * audit log and the reconcile.
 *
 * @see lib/app/judges/model-choice.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  versionFindFirst: vi.fn(),
  versionCreate: vi.fn(),
}));

vi.mock('@/lib/db/client', () => {
  const mock = {
    aiAgent: { findMany: db.findMany, findFirst: db.findFirst, update: db.update },
    aiAgentVersion: { findFirst: db.versionFindFirst, create: db.versionCreate },
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation((fn: (tx: typeof mock) => Promise<unknown>) => fn(mock));
  return { prisma: mock };
});
const mockAudit = vi.hoisted(() => vi.fn());
vi.mock('@/lib/orchestration/audit/admin-audit-logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/orchestration/audit/admin-audit-logger')>()),
  logAdminAction: mockAudit,
}));
const mockReconcile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/orchestration/agents/reconcile-platform-agents', () => ({
  tryReconcilePlatformAgents: mockReconcile,
}));

import { ValidationError, NotFoundError } from '@/lib/api/errors';
import { judgeAgentSlug, EDITOR_AGENT_SLUG } from '@/lib/app/judges/agents';
import type { AvailableModel } from '@/lib/app/judges/availability';
import { CHOOSABLE_AGENTS, chooseJudgeModel, listJudgeModels } from '@/lib/app/judges/model-choice';

const ORG = 'cmorg000000000000000team1';
const ETHOS = judgeAgentSlug('judge_ethos');
const INFLUENCE = judgeAgentSlug('judge_influence');

const OPENAI: AvailableModel[] = ['gpt-4.1', 'gpt-5', 'gpt-4o', 'gpt-4o-mini', 'o3-mini'].map(
  (model) => ({ provider: 'openai', model })
);
const availableOpenAi = () => Promise.resolve(OPENAI);

/** Every agent's row, ethos overridden. */
function rows(over: Partial<Record<string, Record<string, unknown>>> = {}) {
  return CHOOSABLE_AGENTS.map((a) => ({
    slug: a.slug,
    name: a.key,
    provider: 'openai',
    model: a.role === 'editor' ? 'gpt-5' : 'gpt-4.1',
    bindingOwner: 'platform',
    ...over[a.slug],
  }));
}

function agentRow(over: Record<string, unknown> = {}) {
  return {
    id: 'agent-ethos',
    orgId: ORG,
    slug: ETHOS,
    name: 'Ethos Judge',
    provider: 'openai',
    model: 'gpt-4.1',
    providerConfig: null,
    bindingOwner: 'platform',
    isSystem: true,
    grantedTags: [],
    grantedDocuments: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.findMany.mockResolvedValue(rows());
  db.findFirst.mockResolvedValue(agentRow());
  db.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...agentRow(), ...data })
  );
  db.versionFindFirst.mockResolvedValue({ version: 3 });
  db.versionCreate.mockResolvedValue({});
});

describe('listJudgeModels', () => {
  it('offers the role’s approved list intersected with what the workspace has', async () => {
    const list = await listJudgeModels(ORG, availableOpenAi);

    expect(list.map((c) => c.key)).toEqual(CHOOSABLE_AGENTS.map((a) => a.key));
    const ethos = list.find((c) => c.key === 'judge_ethos');
    // Anthropic's are approved but not available; gpt-4o-mini is available but not approved.
    expect(ethos?.options.map((o) => o.model)).toEqual(['gpt-4.1', 'gpt-5', 'gpt-4o']);
    expect(ethos?.options.find((o) => o.isDefault)?.model).toBe('gpt-4.1');
    const editor = list.find((c) => c.key === 'editor');
    expect(editor?.options.map((o) => o.model)).toEqual(['gpt-5', 'gpt-4.1']);
    expect(editor?.options.find((o) => o.isDefault)?.model).toBe('gpt-5');
  });

  it('follows the availability input, so another source can replace it', async () => {
    const list = await listJudgeModels(ORG, () =>
      Promise.resolve([{ provider: 'anthropic', model: 'claude-haiku-4.5' }])
    );
    expect(list.find((c) => c.key === 'judge_ethos')?.options.map((o) => o.model)).toEqual([
      'claude-haiku-4.5',
    ]);
    // Approved for a judge, not for the influence judge.
    expect(list.find((c) => c.key === 'judge_influence')?.options).toEqual([]);
  });

  it('shows names and a trade-off only: no token, temperature or effort fields', async () => {
    const [ethos] = await listJudgeModels(ORG, availableOpenAi);
    for (const option of ethos.options) {
      expect(Object.keys(option).sort()).toEqual(['isDefault', 'label', 'model', 'tradeoff']);
    }
    expect(JSON.stringify(ethos)).not.toMatch(/maxTokens|temperature|reasoningEffort|timeout/);
  });

  it('reads only this workspace’s platform agents, leaving out deleted ones', async () => {
    await listJudgeModels(ORG, availableOpenAi);
    expect(db.findMany.mock.calls[0][0].where).toMatchObject({
      orgId: ORG,
      isSystem: true,
      deletedAt: null,
    });
  });

  it('marks a binding off the list as not approved, and whether the default is followed', async () => {
    db.findMany.mockResolvedValue(rows({ [ETHOS]: { model: 'gpt-4o-mini', bindingOwner: 'org' } }));
    const ethos = (await listJudgeModels(ORG, availableOpenAi)).find(
      (c) => c.key === 'judge_ethos'
    );
    expect(ethos).toMatchObject({
      current: { model: 'gpt-4o-mini', label: 'gpt-4o-mini', approved: false },
      followsDefault: false,
    });
  });

  it('leaves out an agent the workspace does not have', async () => {
    db.findMany.mockResolvedValue(rows().filter((r) => r.slug !== EDITOR_AGENT_SLUG));
    const list = await listJudgeModels(ORG, availableOpenAi);
    expect(list.some((c) => c.key === 'editor')).toBe(false);
  });
});

describe('chooseJudgeModel refuses', () => {
  const choose = (model: string | null, key = 'judge_ethos') =>
    chooseJudgeModel({ orgId: ORG, key, model, userId: 'user-1', availability: availableOpenAi });

  it('a model off the role’s approved list, writing nothing', async () => {
    await expect(choose('gpt-4o-mini')).rejects.toThrow(ValidationError);
    await expect(choose('gpt-4o-mini')).rejects.toThrow('not one of the models approved');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('an approved model the workspace does not have available', async () => {
    await expect(choose('claude-sonnet-4')).rejects.toThrow('not available in this workspace');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('a model approved for another role only', async () => {
    db.findFirst.mockResolvedValue(agentRow({ slug: EDITOR_AGENT_SLUG }));
    await expect(choose('gpt-4o', 'editor')).rejects.toThrow('not one of the models approved');
  });

  it('an unknown key, or an agent the workspace does not have', async () => {
    await expect(choose('gpt-5', 'judge_nobody')).rejects.toThrow(NotFoundError);
    db.findFirst.mockResolvedValue(null);
    await expect(choose('gpt-5')).rejects.toThrow(NotFoundError);
  });
});

describe('chooseJudgeModel on an approved, available model', () => {
  const choose = (model: string | null, key = 'judge_ethos') =>
    chooseJudgeModel({
      orgId: ORG,
      key,
      model,
      userId: 'user-1',
      clientIp: '127.0.0.1',
      availability: availableOpenAi,
    });

  it('binds it, makes the binding the workspace’s, snapshots a version and audits', async () => {
    await choose('gpt-5');

    expect(db.findFirst.mock.calls[0][0].where).toMatchObject({
      orgId: ORG,
      slug: ETHOS,
      isSystem: true,
    });
    expect(db.update).toHaveBeenCalledWith({
      where: { id: 'agent-ethos' },
      data: { provider: 'openai', model: 'gpt-5', bindingOwner: 'org' },
    });
    expect(db.versionCreate).toHaveBeenCalledTimes(1);
    expect(db.versionCreate.mock.calls[0][0].data).toMatchObject({
      agentId: 'agent-ethos',
      version: 4,
      createdBy: 'user-1',
    });
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'agent.update',
        entityId: 'agent-ethos',
        changes: {
          model: { from: 'gpt-4.1', to: 'gpt-5' },
          bindingOwner: { from: 'platform', to: 'org' },
        },
      })
    );
  });

  it('backfills the original version first on an agent with none', async () => {
    db.versionFindFirst.mockResolvedValue(null);
    await choose('gpt-5');
    expect(db.versionCreate.mock.calls.map((c) => c[0].data.version)).toEqual([1, 2]);
  });

  it('takes the binding as it stands when the default is chosen by name, without a version', async () => {
    await choose('gpt-4.1');
    expect(db.update).toHaveBeenCalledWith({
      where: { id: 'agent-ethos' },
      data: { provider: 'openai', model: 'gpt-4.1', bindingOwner: 'org' },
    });
    expect(db.versionCreate).not.toHaveBeenCalled();
  });

  it('writes nothing when the workspace already chose that model', async () => {
    db.findFirst.mockResolvedValue(agentRow({ model: 'gpt-5', bindingOwner: 'org' }));
    await choose('gpt-5');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('on a new provider, drops the new primary from the fallbacks', async () => {
    db.findFirst.mockResolvedValue(
      agentRow({
        providerConfig: { organization: 'org-x' },
        fallbackProviders: ['anthropic', 'groq'],
      })
    );
    const both = () =>
      Promise.resolve([...OPENAI, { provider: 'anthropic', model: 'claude-sonnet-4' }]);
    await chooseJudgeModel({
      orgId: ORG,
      key: 'judge_ethos',
      model: 'claude-sonnet-4',
      userId: 'user-1',
      availability: both,
    });

    expect(db.update.mock.calls[0][0].data).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      bindingOwner: 'org',
      fallbackProviders: ['groq'],
    });
    expect(db.versionCreate.mock.calls[0][0].data.changeSummary).toMatch(/Fallback/i);
  });

  it('keeps the fallbacks when the provider stays the same', async () => {
    db.findFirst.mockResolvedValue(
      agentRow({ providerConfig: { organization: 'org-x' }, fallbackProviders: ['anthropic'] })
    );
    await choose('gpt-5');
    expect(db.update.mock.calls[0][0].data).toEqual({
      provider: 'openai',
      model: 'gpt-5',
      bindingOwner: 'org',
    });
  });

  it('asks the availability source once, and reads no other agent, per choice', async () => {
    const availability = vi.fn(availableOpenAi);
    await chooseJudgeModel({
      orgId: ORG,
      key: 'judge_ethos',
      model: 'gpt-5',
      userId: 'user-1',
      availability,
    });
    expect(availability).toHaveBeenCalledTimes(1);
    expect(db.findMany).not.toHaveBeenCalled();
  });

  it('on the influence judge, offers and binds the 16,384-token model', async () => {
    db.findFirst.mockResolvedValue(agentRow({ id: 'agent-influence', slug: INFLUENCE }));
    await choose('gpt-4o', 'judge_influence');
    expect(db.update.mock.calls[0][0].data).toMatchObject({ model: 'gpt-4o' });
  });
});

describe('chooseJudgeModel(null): back to the default', () => {
  it('hands the binding back to the platform and reconciles now', async () => {
    db.findFirst.mockResolvedValue(agentRow({ model: 'gpt-5', bindingOwner: 'org' }));
    await chooseJudgeModel({
      orgId: ORG,
      key: 'judge_ethos',
      model: null,
      userId: 'user-1',
      availability: availableOpenAi,
    });
    expect(db.update).toHaveBeenCalledWith({
      where: { id: 'agent-ethos' },
      data: { bindingOwner: 'platform' },
    });
    expect(mockReconcile).toHaveBeenCalledWith(ORG, 'agent.bindingOwner');
    expect(mockAudit).toHaveBeenCalledTimes(1);
  });

  it('does nothing when it already follows the default', async () => {
    await chooseJudgeModel({
      orgId: ORG,
      key: 'judge_ethos',
      model: null,
      userId: 'user-1',
      availability: availableOpenAi,
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
  });
});

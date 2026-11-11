/**
 * Tests: scripts/app/dev-tenancy-steps.ts — the multi-tenant dev setup (t-5).
 *
 * What matters is that a database already in shape is left alone (a second run
 * writes nothing and runs no create), that each gap is filled by the right
 * step, that a state the script must not overwrite (an inactive provider, a
 * different embedding model) fails rather than being changed, and that an
 * environment pointing the app at the owner, or at the shared default role,
 * is refused before anything runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EMBEDDING_MODEL_SLUG,
  SetupError,
  ensureAppRole,
  ensureEmbeddingModel,
  ensureOpenAiProvider,
  enablePolicies,
  parseEnv,
  runDevTenancySetup,
  runDriftCheck,
  type AppRoleProbe,
  type SetupDb,
} from '@/scripts/app/dev-tenancy-steps';

const GOOD_ENV = {
  TENANCY_MODE: 'multi',
  TENANCY_APP_ROLE: 'howdoesthisland_app',
  TENANCY_APP_ROLE_PASSWORD: 'pw',
  DATABASE_URL: 'postgresql://howdoesthisland_app:pw@localhost:5432/hdtl',
  MIGRATE_DATABASE_URL: 'postgresql://owner:pw@localhost:5432/hdtl',
};

const MODEL = {
  id: 'model-1',
  isActive: true,
  dimensions: 1536,
  capabilities: ['embedding'],
};

function makeDb() {
  const db = {
    aiProviderConfig: { findUnique: vi.fn(), create: vi.fn() },
    aiProviderModel: { findUnique: vi.fn() },
    aiOrchestrationSettings: { findUnique: vi.fn(), upsert: vi.fn() },
  };
  // The steps use three delegates; the mock implements only the calls they make.
  return { db, client: db as unknown as SetupDb };
}

function errorOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

describe('parseEnv', () => {
  it('accepts the multi shape with a project-specific role', () => {
    expect(parseEnv(GOOD_ENV).TENANCY_APP_ROLE).toBe('howdoesthisland_app');
  });

  it.each([
    ['TENANCY_MODE single', { TENANCY_MODE: 'single' }, 'TENANCY_MODE'],
    ['the shared default role', { TENANCY_APP_ROLE: 'sunrise_app' }, 'project-specific'],
    ['no password', { TENANCY_APP_ROLE_PASSWORD: '' }, 'TENANCY_APP_ROLE_PASSWORD'],
    [
      'the app pointed at the owner',
      { DATABASE_URL: 'postgresql://owner:pw@localhost:5432/hdtl' },
      'DATABASE_URL must connect as TENANCY_APP_ROLE',
    ],
    [
      'the owner DSN on the app role',
      { MIGRATE_DATABASE_URL: GOOD_ENV.DATABASE_URL },
      'MIGRATE_DATABASE_URL must connect as the owner',
    ],
    ['a DSN that is not postgres', { MIGRATE_DATABASE_URL: 'mysql://a:b@h/db' }, 'postgresql://'],
    ['a missing DSN', { MIGRATE_DATABASE_URL: undefined }, 'MIGRATE_DATABASE_URL'],
  ])('refuses %s', (_label, override, message) => {
    const err = errorOf(() => parseEnv({ ...GOOD_ENV, ...override }));
    expect(err).toBeInstanceOf(SetupError);
    expect((err as Error).message).toContain(message);
  });
});

describe('ensureAppRole', () => {
  const ready: AppRoleProbe = { connected: true, usable: true };

  it('leaves a working role alone and runs no create', async () => {
    const runNpm = vi.fn();
    const result = await ensureAppRole(vi.fn().mockResolvedValue(ready), runNpm);
    expect(result.outcome).toBe('unchanged');
    expect(runNpm).not.toHaveBeenCalled();
  });

  it('creates a role that cannot log in, then re-probes', async () => {
    const probe = vi
      .fn()
      .mockResolvedValueOnce({ connected: false, usable: false })
      .mockResolvedValueOnce(ready);
    const runNpm = vi.fn().mockReturnValue(0);
    const result = await ensureAppRole(probe, runNpm);
    expect(runNpm).toHaveBeenCalledWith('db:tenancy:role', ['--create']);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(result.outcome).toBe('created');
  });

  it('re-grants a role that logs in but has lost its grants (after db:reset)', async () => {
    const probe = vi
      .fn()
      .mockResolvedValueOnce({ connected: true, usable: false })
      .mockResolvedValueOnce(ready);
    const result = await ensureAppRole(probe, vi.fn().mockReturnValue(0));
    expect(result.outcome).toBe('updated');
  });

  it('fails when the role script fails', async () => {
    const probe = vi.fn().mockResolvedValue({ connected: false, usable: false });
    await expect(ensureAppRole(probe, vi.fn().mockReturnValue(2))).rejects.toThrow(
      'db:tenancy:role --create exited 2'
    );
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('fails when the role still cannot be used after the create', async () => {
    const probe = vi.fn().mockResolvedValue({ connected: true, usable: false });
    await expect(ensureAppRole(probe, vi.fn().mockReturnValue(0))).rejects.toThrow(SetupError);
  });
});

describe('enablePolicies and runDriftCheck', () => {
  it('run their npm scripts and pass on exit 0', () => {
    const runNpm = vi.fn().mockReturnValue(0);
    expect(enablePolicies(runNpm).step).toBe('policies');
    expect(runDriftCheck(runNpm).step).toBe('drift check');
    expect(runNpm.mock.calls).toEqual([['db:tenancy:enable'], ['db:drift-check']]);
  });

  it('fail on a non-zero exit', () => {
    const runNpm = vi.fn().mockReturnValue(1);
    expect(() => enablePolicies(runNpm)).toThrow('db:tenancy:enable exited 1');
    expect(() => runDriftCheck(runNpm)).toThrow('db:drift-check exited 1');
  });
});

describe('ensureOpenAiProvider', () => {
  let mocks: ReturnType<typeof makeDb>;
  beforeEach(() => {
    mocks = makeDb();
  });

  it('creates the row from the known OpenAI provider when missing', async () => {
    mocks.db.aiProviderConfig.findUnique.mockResolvedValue(null);
    const result = await ensureOpenAiProvider(mocks.client);
    expect(result.outcome).toBe('created');
    expect(mocks.db.aiProviderConfig.create).toHaveBeenCalledWith({
      data: {
        name: 'OpenAI',
        slug: 'openai',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnvVar: 'OPENAI_API_KEY',
        isLocal: false,
        isActive: true,
      },
    });
  });

  it('leaves an active row alone', async () => {
    mocks.db.aiProviderConfig.findUnique.mockResolvedValue({
      isActive: true,
      apiKeyEnvVar: 'OPENAI_API_KEY',
    });
    const result = await ensureOpenAiProvider(mocks.client);
    expect(result.outcome).toBe('unchanged');
    expect(mocks.db.aiProviderConfig.create).not.toHaveBeenCalled();
  });

  it('fails on an inactive row rather than reactivating it', async () => {
    mocks.db.aiProviderConfig.findUnique.mockResolvedValue({
      isActive: false,
      apiKeyEnvVar: 'OPENAI_API_KEY',
    });
    await expect(ensureOpenAiProvider(mocks.client)).rejects.toThrow('inactive');
    expect(mocks.db.aiProviderConfig.create).not.toHaveBeenCalled();
  });
});

describe('ensureEmbeddingModel', () => {
  let mocks: ReturnType<typeof makeDb>;
  beforeEach(() => {
    mocks = makeDb();
    mocks.db.aiProviderModel.findUnique.mockResolvedValue(MODEL);
  });

  it('sets the model on an existing settings row with none set', async () => {
    mocks.db.aiOrchestrationSettings.findUnique.mockResolvedValue({ activeEmbeddingModelId: null });
    const result = await ensureEmbeddingModel(mocks.client);
    expect(result.outcome).toBe('updated');
    expect(mocks.db.aiOrchestrationSettings.upsert).toHaveBeenCalledWith({
      where: { slug: 'global' },
      create: { slug: 'global', defaultModels: {}, activeEmbeddingModelId: 'model-1' },
      update: { activeEmbeddingModelId: 'model-1' },
    });
  });

  it('creates the settings row when the app has never run', async () => {
    mocks.db.aiOrchestrationSettings.findUnique.mockResolvedValue(null);
    const result = await ensureEmbeddingModel(mocks.client);
    expect(result.outcome).toBe('created');
    expect(mocks.db.aiOrchestrationSettings.upsert).toHaveBeenCalledTimes(1);
  });

  it('leaves the model alone when it is already active', async () => {
    mocks.db.aiOrchestrationSettings.findUnique.mockResolvedValue({
      activeEmbeddingModelId: 'model-1',
    });
    const result = await ensureEmbeddingModel(mocks.client);
    expect(result).toEqual({
      step: 'embedding model',
      outcome: 'unchanged',
      detail: EMBEDDING_MODEL_SLUG,
    });
    expect(mocks.db.aiOrchestrationSettings.upsert).not.toHaveBeenCalled();
  });

  it('fails rather than switching away from a different active model', async () => {
    mocks.db.aiOrchestrationSettings.findUnique.mockResolvedValue({
      activeEmbeddingModelId: 'other-model',
    });
    await expect(ensureEmbeddingModel(mocks.client)).rejects.toThrow('re-embedding');
    expect(mocks.db.aiOrchestrationSettings.upsert).not.toHaveBeenCalled();
  });

  it('fails when the seed has not created the model', async () => {
    mocks.db.aiProviderModel.findUnique.mockResolvedValue(null);
    await expect(ensureEmbeddingModel(mocks.client)).rejects.toThrow('db:seed');
  });

  it.each([
    ['inactive', { isActive: false }],
    ['not embedding-capable', { capabilities: ['chat'] }],
    ['the wrong size for the vector columns', { dimensions: 3072 }],
  ])('fails when the model is %s', async (_label, override) => {
    mocks.db.aiProviderModel.findUnique.mockResolvedValue({ ...MODEL, ...override });
    await expect(ensureEmbeddingModel(mocks.client)).rejects.toThrow('1536-dimensional');
    expect(mocks.db.aiOrchestrationSettings.findUnique).not.toHaveBeenCalled();
  });
});

describe('runDevTenancySetup', () => {
  it('runs every step in order and reports a second run as unchanged', async () => {
    const mocks = makeDb();
    mocks.db.aiProviderConfig.findUnique.mockResolvedValue({
      isActive: true,
      apiKeyEnvVar: 'OPENAI_API_KEY',
    });
    mocks.db.aiProviderModel.findUnique.mockResolvedValue(MODEL);
    mocks.db.aiOrchestrationSettings.findUnique.mockResolvedValue({
      activeEmbeddingModelId: 'model-1',
    });
    const runNpm = vi.fn().mockReturnValue(0);

    const results = await runDevTenancySetup({
      env: GOOD_ENV,
      probeAppRole: vi.fn().mockResolvedValue({ connected: true, usable: true }),
      runNpm,
      db: () => mocks.client,
    });

    expect(results.map((r) => [r.step, r.outcome])).toEqual([
      ['app role', 'unchanged'],
      ['policies', 'unchanged'],
      ['OpenAI provider', 'unchanged'],
      ['embedding model', 'unchanged'],
      ['drift check', 'unchanged'],
    ]);
    expect(runNpm.mock.calls).toEqual([['db:tenancy:enable'], ['db:drift-check']]);
    expect(mocks.db.aiProviderConfig.create).not.toHaveBeenCalled();
    expect(mocks.db.aiOrchestrationSettings.upsert).not.toHaveBeenCalled();
  });

  it('refuses a bad environment before probing, running or opening anything', async () => {
    const probe = vi.fn();
    const runNpm = vi.fn();
    const db = vi.fn();
    await expect(
      runDevTenancySetup({
        env: { ...GOOD_ENV, TENANCY_MODE: 'single' },
        probeAppRole: probe,
        runNpm,
        db,
      })
    ).rejects.toThrow(SetupError);
    expect(probe).not.toHaveBeenCalled();
    expect(runNpm).not.toHaveBeenCalled();
    expect(db).not.toHaveBeenCalled();
  });
});

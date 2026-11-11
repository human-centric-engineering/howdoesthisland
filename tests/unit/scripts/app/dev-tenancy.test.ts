/**
 * Tests: scripts/app/dev-tenancy.ts — the CLI entry for the dev setup (t-5).
 *
 * The steps are tested in `dev-tenancy-steps.test.ts`. This pins what the
 * entry adds: how it asks Postgres whether the app role works (a refused login
 * means "create it", any other connection failure means "could not run"), how
 * it runs the npm scripts (always at `multi`), its exit codes, and that it
 * closes what it opened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SetupDeps, StepResult } from '@/scripts/app/dev-tenancy-steps';

const mockRun = vi.hoisted(() => vi.fn());
vi.mock('@/scripts/app/dev-tenancy-steps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/scripts/app/dev-tenancy-steps')>();
  return { ...actual, runDevTenancySetup: mockRun };
});

const mockQuery = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn());
const mockClientEnd = vi.hoisted(() => vi.fn());
const mockPoolEnd = vi.hoisted(() => vi.fn());
vi.mock('pg', () => ({
  Client: vi.fn(function (this: Record<string, unknown>) {
    this.query = mockQuery;
    this.connect = mockConnect;
    this.end = mockClientEnd;
  }),
  Pool: vi.fn(function (this: Record<string, unknown>) {
    this.end = mockPoolEnd;
  }),
}));

const mockDisconnect = vi.hoisted(() => vi.fn());
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function (this: Record<string, unknown>) {
    this.$disconnect = mockDisconnect;
  }),
}));
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: vi.fn() }));

const mockSpawnSync = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawnSync: mockSpawnSync }));

const mockInfo = vi.hoisted(() => vi.fn());
const mockError = vi.hoisted(() => vi.fn());
const mockWarn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logging', () => ({
  logger: { info: mockInfo, error: mockError, warn: mockWarn, debug: vi.fn() },
}));

function pgError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe('scripts/app/dev-tenancy', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const env = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://howdoesthisland_app:pw@localhost:5432/db';
    process.env.MIGRATE_DATABASE_URL = 'postgresql://owner:pw@localhost:5432/db';
    process.env.OPENAI_API_KEY = 'sk-test';
    mockConnect.mockResolvedValue(undefined);
    mockClientEnd.mockResolvedValue(undefined);
    mockPoolEnd.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    process.env = { ...env };
    exitSpy.mockRestore();
  });

  /** Import the script (its main() runs on import) and wait for it to exit. */
  async function runScript(): Promise<void> {
    await import('@/scripts/app/dev-tenancy');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled());
  }

  /** Run the script with a setup that hands back its deps, then exits 0. */
  async function captureDeps(): Promise<SetupDeps> {
    let captured: SetupDeps | undefined;
    mockRun.mockImplementation((deps: SetupDeps) => {
      captured = deps;
      return Promise.resolve([]);
    });
    await runScript();
    if (!captured) throw new Error('runDevTenancySetup was not called');
    return captured;
  }

  describe('exit codes', () => {
    it('exits 0 and logs each step when the setup passes', async () => {
      const results: StepResult[] = [{ step: 'app role', outcome: 'unchanged', detail: 'ok' }];
      mockRun.mockResolvedValue(results);
      await runScript();
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(mockInfo).toHaveBeenCalledWith('app role: unchanged (ok)');
    });

    it('exits 1 when a step fails', async () => {
      const { SetupError } = await import('@/scripts/app/dev-tenancy-steps');
      mockRun.mockRejectedValue(new SetupError('db:drift-check exited 1'));
      await runScript();
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockError).toHaveBeenCalledWith('Dev tenancy setup failed: db:drift-check exited 1');
    });

    it('exits 2 when it could not run', async () => {
      mockRun.mockRejectedValue(new Error('connect ECONNREFUSED'));
      await runScript();
      expect(exitSpy).toHaveBeenCalledWith(2);
    });

    it('warns when there is no OpenAI key, and still runs', async () => {
      delete process.env.OPENAI_API_KEY;
      mockRun.mockResolvedValue([]);
      await runScript();
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('OPENAI_API_KEY'));
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  describe('closing what it opened', () => {
    it('disconnects the client the setup opened, and ends the pool', async () => {
      mockRun.mockImplementation((deps: SetupDeps) => {
        deps.db();
        return Promise.resolve([]);
      });
      await runScript();
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
    });

    it('ends the pool without a disconnect when no client was opened', async () => {
      mockRun.mockRejectedValue(new Error('boom'));
      await runScript();
      expect(mockDisconnect).not.toHaveBeenCalled();
      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('probeAppRole', () => {
    it('reports a refused login as not connected, so the role is created', async () => {
      const deps = await captureDeps();
      for (const code of ['28P01', '28000']) {
        mockConnect.mockRejectedValueOnce(pgError(code));
        await expect(deps.probeAppRole()).resolves.toEqual({ connected: false, usable: false });
      }
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('rethrows any other connection failure', async () => {
      const deps = await captureDeps();
      mockConnect.mockRejectedValueOnce(pgError('ECONNREFUSED'));
      await expect(deps.probeAppRole()).rejects.toThrow('ECONNREFUSED');
    });

    it('asks Postgres, as the app role, whether it can use the schema', async () => {
      const deps = await captureDeps();
      mockQuery.mockResolvedValueOnce({ rows: [{ usable: true }] });
      await expect(deps.probeAppRole()).resolves.toEqual({ connected: true, usable: true });
      expect(mockQuery.mock.calls[0]?.[0]).toContain(
        "has_schema_privilege(current_schema(), 'USAGE')"
      );
      expect(mockClientEnd).toHaveBeenCalled();
    });

    it('reports missing grants as connected but unusable', async () => {
      const deps = await captureDeps();
      mockQuery.mockResolvedValueOnce({ rows: [{ usable: false }] });
      await expect(deps.probeAppRole()).resolves.toEqual({ connected: true, usable: false });
      mockQuery.mockRejectedValueOnce(pgError('42501'));
      await expect(deps.probeAppRole()).resolves.toEqual({ connected: true, usable: false });
    });

    it('reports a schema without USAGE (after db:reset) as connected but unusable', async () => {
      const deps = await captureDeps();
      // No USAGE drops the schema from the search path, so "user" does not resolve.
      mockQuery.mockRejectedValueOnce(pgError('42P01'));
      await expect(deps.probeAppRole()).resolves.toEqual({ connected: true, usable: false });
    });

    it('rethrows an unexpected query error and still closes the client', async () => {
      const deps = await captureDeps();
      mockClientEnd.mockClear();
      mockQuery.mockRejectedValueOnce(pgError('57P01'));
      await expect(deps.probeAppRole()).rejects.toThrow('57P01');
      expect(mockClientEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('runNpm', () => {
    it('runs the npm script at multi, passing args after --', async () => {
      const deps = await captureDeps();
      mockSpawnSync.mockReturnValue({ status: 0 });
      expect(deps.runNpm('db:tenancy:role', ['--create'])).toBe(0);
      const [cmd, args, opts] = mockSpawnSync.mock.calls[0] ?? [];
      expect(cmd).toBe('npm');
      expect(args).toEqual(['run', '--silent', 'db:tenancy:role', '--', '--create']);
      expect(opts).toMatchObject({ stdio: 'inherit', env: { TENANCY_MODE: 'multi' } });
    });

    it('passes no -- without args, and treats a killed child as a failure', async () => {
      const deps = await captureDeps();
      mockSpawnSync.mockReturnValue({ status: null });
      expect(deps.runNpm('db:drift-check')).toBe(1);
      expect(mockSpawnSync.mock.calls[0]?.[1]).toEqual(['run', '--silent', 'db:drift-check']);
    });
  });
});

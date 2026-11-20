/**
 * Tests: the demo-usage seed (t-48) — when it runs, and what it writes.
 *
 * Mocked: the client the runner hands it (recording each write), the org
 * lifecycle and quota writers, and `runAsOrg` (a pass-through). Real: the
 * seed's own logic, and the usage service's month boundary (`utcMonthStart`).
 *
 * @see prisma/seeds/app-howdoesthisland/002-demo-usage.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createOrg: vi.fn(),
  writeOrgQuotas: vi.fn(),
}));
vi.mock('@/lib/tenancy/lifecycle', () => ({ createOrg: mocks.createOrg }));
vi.mock('@/lib/tenancy/org-settings', () => ({ writeOrgQuotas: mocks.writeOrgQuotas }));
vi.mock('@/lib/tenancy/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/context')>()),
  runAsOrg: vi.fn((_orgId: string, fn: () => Promise<unknown>) => fn()),
}));

import unit from '@/prisma/seeds/app-howdoesthisland/002-demo-usage';
import type { SeedContext } from '@/prisma/runner';

const NOW = new Date('2026-11-20T12:00:00Z');
const ORG = 'org-demo';

interface CostRow {
  orgId: string;
  totalCostUsd: number;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

function makeDb(opts: { version?: boolean; existing?: boolean; admins?: number } = {}) {
  const costs: CostRow[] = [];
  let assessments = 0;
  const db = {
    frameworkVersion: {
      findFirst: vi.fn(async () =>
        opts.version === false ? null : { id: 'fv1', version: '1.0.0', framework: { slug: 'hdtl' } }
      ),
    },
    org: { findUnique: vi.fn(async () => (opts.existing ? { id: ORG } : null)) },
    user: {
      findMany: vi.fn(async () =>
        Array.from({ length: opts.admins ?? 1 }, (_, i) => ({ id: `admin-${i}` }))
      ),
    },
    orgMembership: { upsert: vi.fn(async () => ({})) },
    assessment: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => ({ id: `a${++assessments}` })),
    },
    content: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => ({ id: `c${assessments + 1}` })),
    },
    aiCostLog: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async ({ data }: { data: CostRow[] }) => {
        costs.push(...data);
        return { count: data.length };
      }),
      create: vi.fn(async ({ data }: { data: CostRow }) => {
        costs.push(data);
        return data;
      }),
    },
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  // The seed reads only the members above; the runner's type is the whole client.
  const ctx = { prisma: db, logger } as unknown as SeedContext;
  return { db, logger, ctx, costs };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mocks.createOrg.mockResolvedValue({ id: ORG });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('002-demo-usage', () => {
  it('writes nothing in production unless SEED_DEMO_USAGE is true', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { ctx, db, logger } = makeDb();

    await unit.run(ctx);

    expect(db.frameworkVersion.findFirst).not.toHaveBeenCalled();
    expect(mocks.createOrg).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Demo usage skipped'));
  });

  it('runs in production when asked to', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SEED_DEMO_USAGE', 'true');
    const { ctx, costs } = makeDb();

    await unit.run(ctx);

    expect(costs.length).toBeGreaterThan(0);
  });

  it('skips when no framework version is published to review against', async () => {
    const { ctx, db, logger } = makeDb({ version: false });

    await unit.run(ctx);

    expect(db.org.findUnique).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no published framework'));
  });

  it("creates the demo workspace with the default budget through the seed's own client", async () => {
    const { ctx, db } = makeDb();

    await unit.run(ctx);

    expect(mocks.createOrg).toHaveBeenCalledWith({ slug: 'usage-demo', name: 'Usage demo' }, db);
    expect(mocks.writeOrgQuotas).toHaveBeenCalledWith(ORG, { monthlyBudgetUsd: 10 }, db);
  });

  it('reuses an existing demo workspace, clearing its old usage before writing again', async () => {
    const { ctx, db } = makeDb({ existing: true, admins: 2 });

    await unit.run(ctx);

    expect(mocks.createOrg).not.toHaveBeenCalled();
    expect(db.orgMembership.upsert).toHaveBeenCalledTimes(2);
    for (const model of [db.assessment, db.content, db.aiCostLog]) {
      expect(model.deleteMany).toHaveBeenCalledWith({ where: { orgId: ORG } });
    }
  });

  it('writes about $5.82 this month: 12 stored reviews, 2 kept nowhere, and one non-review row', async () => {
    const { ctx, db, costs } = makeDb();

    await unit.run(ctx);

    expect(db.assessment.create).toHaveBeenCalledTimes(12);
    const total = costs.reduce((sum, r) => sum + r.totalCostUsd, 0);
    expect(total).toBeCloseTo(5.82, 6);
    expect(costs.every((r) => r.orgId === ORG)).toBe(true);
    const monthStart = new Date('2026-11-01T00:00:00Z');
    expect(costs.every((r) => r.createdAt >= monthStart && r.createdAt <= NOW)).toBe(true);
    const runs = new Set(
      costs.flatMap((r) => (r.metadata.ephemeral ? [r.metadata.ephemeralRun] : []))
    );
    expect(runs).toEqual(new Set(['demo-ephemeral-1', 'demo-ephemeral-2']));
    expect(
      costs.filter((r) => r.metadata.assessmentId === undefined && !r.metadata.ephemeral)
    ).toHaveLength(1);
  });

  it('warns that the workspace has no members when no human platform admin exists yet', async () => {
    const { ctx, logger } = makeDb({ admins: 0 });

    await unit.run(ctx);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no members'));
  });
});

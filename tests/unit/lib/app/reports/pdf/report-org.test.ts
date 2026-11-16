/**
 * Tests: entering a report's org from a render token (t-31), at
 * `TENANCY_MODE=multi`.
 *
 * Real: the token, the tenant context (`runAsCredentialLookup`, `runAsOrg`)
 * and `resolveCredentialOrg`. Replaced: the one Prisma read, which records
 * the context it ran in, so a test can see the lookup ran as the system scope
 * and the callback ran inside the assessment's org.
 *
 * @see lib/app/reports/pdf/report-org.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: {
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    BETTER_AUTH_URL: 'https://app.example.com',
    TENANCY_MODE: 'multi',
  },
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Row = { orgId: string | null; org: { status: string } | null };
const rows = vi.hoisted(() => new Map<string, Row>());
const lookups = vi.hoisted(() => [] as unknown[]);
vi.mock('@/lib/db/client', async () => {
  const { getTenantContext } = await import('@/lib/tenancy/context');
  return {
    prisma: {
      assessment: {
        findUnique: vi.fn(({ where }: { where: { id: string } }) => {
          lookups.push(getTenantContext());
          return Promise.resolve(rows.get(where.id) ?? null);
        }),
      },
    },
  };
});

import { runAsReportOrg } from '@/lib/app/reports/pdf/report-org';
import { mintRenderToken } from '@/lib/app/reports/pdf/render-token';
import { getTenantContext } from '@/lib/tenancy/context';

const ID = 'cmassess000000000000000001';
const ORG_A = 'cmorg000000000000000team1';
const ORG_B = 'cmorg0000000000000000org2';

const inside = () => Promise.resolve(getTenantContext());

beforeEach(() => {
  rows.clear();
  lookups.length = 0;
  rows.set(ID, { orgId: ORG_A, org: { status: 'ACTIVE' } });
});

describe('runAsReportOrg at multi', () => {
  it("runs the callback in the assessment's org, after a system-scope lookup", async () => {
    const result = await runAsReportOrg(mintRenderToken(ID, ORG_A), ID, inside);

    expect(result).toEqual({
      ok: true,
      value: { orgId: ORG_A, source: 'approval-token', role: null },
    });
    // The read that learned the org ran as the system scope, and only that read.
    expect(lookups).toEqual([{ orgId: null, source: 'system' }]);
  });

  it('refuses a token minted in another org, entering nothing', async () => {
    const fn = vi.fn(inside);
    const result = await runAsReportOrg(mintRenderToken(ID, ORG_B), ID, fn);
    expect(result).toEqual({ ok: false, refused: 'wrong-org' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses a token for another assessment without reading anything', async () => {
    const fn = vi.fn(inside);
    const result = await runAsReportOrg(mintRenderToken('cmother', ORG_A), ID, fn);
    expect(result).toEqual({ ok: false, refused: 'token', reason: 'wrong-assessment' });
    expect(lookups).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses an expired token', async () => {
    const minted = new Date(Date.now() - 120_000);
    const result = await runAsReportOrg(mintRenderToken(ID, ORG_A, minted), ID, inside);
    expect(result).toEqual({ ok: false, refused: 'token', reason: 'expired' });
  });

  it('refuses no token at all', async () => {
    expect(await runAsReportOrg(null, ID, inside)).toEqual({
      ok: false,
      refused: 'token',
      reason: 'malformed',
    });
  });

  it('refuses an assessment that is gone', async () => {
    rows.clear();
    expect(await runAsReportOrg(mintRenderToken(ID, ORG_A), ID, inside)).toEqual({
      ok: false,
      refused: 'missing',
    });
  });

  it("refuses a suspended workspace's report, as its members' sessions are", async () => {
    rows.set(ID, { orgId: ORG_A, org: { status: 'SUSPENDED' } });
    expect(await runAsReportOrg(mintRenderToken(ID, ORG_A), ID, inside)).toEqual({
      ok: false,
      refused: 'org',
    });
  });

  it('refuses a row with no org at multi, where there is no install-org fallback', async () => {
    rows.set(ID, { orgId: null, org: null });
    expect(await runAsReportOrg(mintRenderToken(ID, ORG_A), ID, inside)).toEqual({
      ok: false,
      refused: 'org',
    });
  });

  it('leaves no context behind once the callback returns', async () => {
    await runAsReportOrg(mintRenderToken(ID, ORG_A), ID, inside);
    expect(getTenantContext()).toBeNull();
  });
});

/**
 * Tests: entering a share link's org from its token (t-32), at
 * `TENANCY_MODE=multi`.
 *
 * Real: the token hashing, the tenant context (`runAsCredentialLookup`,
 * `runAsOrg`) and `resolveCredentialOrg`. Replaced: the one Prisma read,
 * which records the context it ran in and the hash it was asked for.
 *
 * @see lib/app/reports/share/share-org.ts
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

type Row = {
  id: string;
  orgId: string | null;
  assessmentId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  org: { status: string } | null;
};
const rows = vi.hoisted(() => new Map<string, Row>());
const lookups = vi.hoisted(() => [] as unknown[]);
vi.mock('@/lib/db/client', async () => {
  const { getTenantContext } = await import('@/lib/tenancy/context');
  return {
    prisma: {
      reportShare: {
        findUnique: vi.fn(({ where }: { where: { tokenHash: string } }) => {
          lookups.push({ context: getTenantContext(), tokenHash: where.tokenHash });
          return Promise.resolve(rows.get(where.tokenHash) ?? null);
        }),
      },
    },
  };
});

import { runAsShareOrg, type ShareTarget } from '@/lib/app/reports/share/share-org';
import { hashShareToken, mintShareToken } from '@/lib/app/reports/share/token';
import { getTenantContext } from '@/lib/tenancy/context';

const ORG = 'cmorg000000000000000team1';
const SHARE = 'cmshare00000000000000001';

const ASSESSMENT = 'cmassess000000000000000001';
const EXPIRES = new Date('2026-12-16T09:00:00.000Z');

const inside = (share: ShareTarget) => Promise.resolve({ share, context: getTenantContext() });

const liveRow = (): Row => ({
  id: SHARE,
  orgId: ORG,
  assessmentId: ASSESSMENT,
  expiresAt: EXPIRES,
  revokedAt: null,
  org: { status: 'ACTIVE' },
});

let token: string;

beforeEach(() => {
  rows.clear();
  lookups.length = 0;
  const minted = mintShareToken();
  token = minted.token;
  rows.set(minted.tokenHash, liveRow());
});

describe('runAsShareOrg at multi', () => {
  it("runs the callback in the share's org, after a system-scope lookup by the token's hash", async () => {
    const result = await runAsShareOrg(token, inside);

    expect(result).toEqual({
      ok: true,
      value: {
        // The row as the lookup read it, so the caller needs no second read.
        share: { id: SHARE, assessmentId: ASSESSMENT, expiresAt: EXPIRES, revokedAt: null },
        context: { orgId: ORG, source: 'approval-token', role: null },
      },
    });
    // The one read ran as the system scope, and asked for the hash, never the token.
    expect(lookups).toEqual([
      { context: { orgId: null, source: 'system' }, tokenHash: hashShareToken(token) },
    ]);
  });

  it('refuses a token nobody made', async () => {
    const fn = vi.fn(inside);
    const result = await runAsShareOrg(mintShareToken().token, fn);
    expect(result).toEqual({ ok: false, refused: 'missing' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses a string that is not a token without reading anything', async () => {
    for (const bad of ['', 'abc', `${token}x`, token.slice(0, 42) + '!', '../../etc']) {
      expect(await runAsShareOrg(bad, inside)).toEqual({ ok: false, refused: 'malformed' });
    }
    expect(lookups).toEqual([]);
  });

  it("refuses a suspended workspace's link, as its members' sessions are", async () => {
    rows.set(hashShareToken(token), { ...liveRow(), org: { status: 'SUSPENDED' } });
    const fn = vi.fn(inside);
    expect(await runAsShareOrg(token, fn)).toEqual({ ok: false, refused: 'org' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses a row with no org at multi, where there is no install-org fallback', async () => {
    rows.set(hashShareToken(token), { ...liveRow(), orgId: null, org: null });
    expect(await runAsShareOrg(token, inside)).toEqual({ ok: false, refused: 'org' });
  });

  it('leaves no context behind once the callback returns', async () => {
    await runAsShareOrg(token, inside);
    expect(getTenantContext()).toBeNull();
  });
});

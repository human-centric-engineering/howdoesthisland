/**
 * The free review code service (t-59) against a mocked Prisma client: a mint
 * records its maker and batch, a repeated idempotency key answers with the
 * first mint's codes or is refused for a different request, a race on one key
 * reads back the winner's codes, a taken code is drawn again, the list's
 * status and what is left follow the code's redemption rows (t-60: counted,
 * never stored on the code), and a revoke keeps its first time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type ReviewCode } from '@prisma/client';

vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }));
vi.mock('@/lib/tenancy/context', () => ({
  runAsSystem: vi.fn((_reason: string, fn: () => unknown) => fn()),
}));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    reviewCode: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      createManyAndReturn: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import {
  codeStatus,
  type CountedReviewCode,
  issueCodes,
  listCodes,
  redeemLink,
  REVIEW_CODE_UNIQUE,
  revokeCode,
} from '@/lib/app/credits/codes/service';
import type { IssueCodes } from '@/lib/app/credits/codes/wire';

const db = vi.mocked(prisma.reviewCode);
const EXPIRES = '2027-02-19T23:59:59.999Z';
const INPUT: IssueCodes = {
  count: 2,
  creditsPerRedemption: 300,
  maxRedemptions: 1,
  expiresAt: EXPIRES,
  campaign: 'Lead test',
  idempotencyKey: 'lead-42',
};

/** A code as the service reads it, with `used` redemption rows. */
function row(overrides: Partial<ReviewCode> = {}, used = 0): CountedReviewCode {
  return {
    id: 'c1',
    code: 'ABCDEFGHJKMN',
    creditsPerRedemption: 300,
    maxRedemptions: 1,
    expiresAt: new Date(EXPIRES),
    campaign: 'Lead test',
    createdByUserId: 'admin-1',
    revokedAt: null,
    idempotencyKey: 'lead-42',
    batchIndex: 0,
    createdAt: new Date('2026-11-21T09:00:00.000Z'),
    ...overrides,
    _count: { redemptions: used },
  };
}

function uniqueViolation(index: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { modelName: 'ReviewCode', driverAdapterError: { cause: { constraint: { index } } } },
  });
}

/** What the insert was asked to write. */
function inserted() {
  const call = db.createManyAndReturn.mock.calls.at(-1)?.[0];
  return (call?.data ?? []) as Array<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.findMany.mockResolvedValue([]);
  db.createManyAndReturn.mockImplementation((async (args: { data: Array<Partial<ReviewCode>> }) =>
    args.data.map((d, i) => row({ ...d, id: `c${i}` }))) as never);
});

describe('issueCodes', () => {
  it('mints distinct codes alike, recording the maker, the key and each place in the batch', async () => {
    const result = await issueCodes(INPUT, 'admin-1');

    const data = inserted();
    expect(data).toHaveLength(2);
    expect(new Set(data.map((d) => d.code)).size).toBe(2);
    expect(data.map((d) => d.batchIndex)).toEqual([0, 1]);
    for (const d of data) {
      expect(d).toMatchObject({
        creditsPerRedemption: 300,
        maxRedemptions: 1,
        expiresAt: new Date(EXPIRES),
        campaign: 'Lead test',
        createdByUserId: 'admin-1',
        idempotencyKey: 'lead-42',
      });
    }
    expect(result.replayed).toBe(false);
    expect(result.codes.map((c) => c.code)).toEqual(data.map((d) => d.code));
    expect(result.codes[0]?.link).toBe(`https://app.test/redeem?code=${String(data[0]?.code)}`);
  });

  it('answers a repeated key with the first mint’s codes and makes none', async () => {
    db.findMany.mockResolvedValue([row(), row({ id: 'c2', code: 'PQRSTVWXYZ23', batchIndex: 1 })]);

    const result = await issueCodes(INPUT, 'admin-1');

    expect(result.replayed).toBe(true);
    expect(result.codes.map((c) => c.code)).toEqual(['ABCDEFGHJKMN', 'PQRSTVWXYZ23']);
    expect(db.createManyAndReturn).not.toHaveBeenCalled();
  });

  it.each([
    ['a different count', { count: 1 }],
    ['different credits', { creditsPerRedemption: 301 }],
    ['different redemptions', { maxRedemptions: 2 }],
    ['a different campaign', { campaign: 'Other' }],
    ['a different expiry', { expiresAt: '2027-02-20T23:59:59.999Z' }],
  ])('refuses a repeated key with %s, and makes none', async (_name, change) => {
    db.findMany.mockResolvedValue([row(), row({ id: 'c2', code: 'PQRSTVWXYZ23', batchIndex: 1 })]);
    await expect(issueCodes({ ...INPUT, ...change }, 'admin-1')).rejects.toBeInstanceOf(
      ConflictError
    );
    expect(db.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('reads back the winner’s codes when a call with the same key got there first', async () => {
    const winner = [row(), row({ id: 'c2', code: 'PQRSTVWXYZ23', batchIndex: 1 })];
    db.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(winner);
    db.createManyAndReturn.mockRejectedValue(uniqueViolation(REVIEW_CODE_UNIQUE.batch.index));

    const result = await issueCodes(INPUT, 'admin-1');

    expect(result).toEqual({
      replayed: true,
      codes: expect.arrayContaining([expect.objectContaining({ code: 'PQRSTVWXYZ23' })]),
    });
  });

  it('draws again when a drawn code is taken, and gives up after three tries', async () => {
    db.createManyAndReturn.mockRejectedValueOnce(uniqueViolation(REVIEW_CODE_UNIQUE.code.index));
    await expect(
      issueCodes({ ...INPUT, idempotencyKey: undefined }, 'admin-1')
    ).resolves.toMatchObject({ replayed: false });
    expect(db.createManyAndReturn).toHaveBeenCalledTimes(2);

    db.createManyAndReturn.mockReset();
    db.createManyAndReturn.mockRejectedValue(uniqueViolation(REVIEW_CODE_UNIQUE.code.index));
    await expect(issueCodes({ ...INPUT, idempotencyKey: undefined }, 'admin-1')).rejects.toThrow(
      'Unique constraint failed'
    );
    expect(db.createManyAndReturn).toHaveBeenCalledTimes(3);
  });

  it('mints without a key without looking one up', async () => {
    await issueCodes({ ...INPUT, idempotencyKey: undefined }, 'admin-1');
    expect(db.findMany).not.toHaveBeenCalled();
    expect(inserted().every((d) => d.idempotencyKey === null)).toBe(true);
  });
});

describe('codeStatus', () => {
  const now = new Date('2026-12-01T00:00:00.000Z');
  it.each([
    ['active', row(), 0, 'active'],
    ['used up', row(), 1, 'used-up'],
    ['expired', row({ expiresAt: now }), 0, 'expired'],
    [
      'revoked, even once used up and expired',
      row({ revokedAt: now, expiresAt: now }),
      1,
      'revoked',
    ],
    ['expired before used up', row({ expiresAt: now }), 1, 'expired'],
  ])('%s', (_name, r, used, status) => {
    expect(codeStatus(r, used, now)).toBe(status);
  });
});

describe('listCodes', () => {
  it('shows what is used and left of each code, newest first', async () => {
    db.findMany.mockResolvedValue([row({ maxRedemptions: 25 }, 7)]);
    const { codes, truncated } = await listCodes();
    expect(codes[0]).toMatchObject({ redemptionsUsed: 7, redemptionsLeft: 18, status: 'active' });
    expect(truncated).toBe(false);
    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        include: { _count: { select: { redemptions: true } } },
        orderBy: expect.arrayContaining([{ createdAt: 'desc' }]),
      })
    );
  });

  it('matches a campaign, or a code typed with its dashes, with LIKE wildcards taken literally', async () => {
    await listCodes('abcd-efgh');
    expect(db.findMany.mock.calls[0]?.[0]?.where).toEqual({
      OR: [
        { campaign: { contains: 'abcd-efgh', mode: 'insensitive' } },
        { code: { contains: 'ABCDEFGH' } },
      ],
    });

    await listCodes('50%_off');
    expect(db.findMany.mock.calls[1]?.[0]?.where).toMatchObject({
      OR: [{ campaign: { contains: '50\\%\\_off' } }, { code: { contains: '50\\%\\_OFF' } }],
    });
  });

  it('says when more match than the list holds', async () => {
    db.findMany.mockResolvedValue(Array.from({ length: 201 }, (_, i) => row({ id: `c${i}` })));
    const { codes, truncated } = await listCodes();
    expect(codes).toHaveLength(200);
    expect(truncated).toBe(true);
  });
});

describe('revokeCode', () => {
  it('revokes only a code not yet revoked, so its first time stands', async () => {
    const first = new Date('2026-11-20T00:00:00.000Z');
    db.findUnique.mockResolvedValue(row({ revokedAt: first }));

    const view = await revokeCode('c1');

    expect(db.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(view).toMatchObject({ status: 'revoked', revokedAt: first.toISOString() });
  });

  it('throws NotFoundError for a code that does not exist', async () => {
    db.findUnique.mockResolvedValue(null);
    await expect(revokeCode('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('redeemLink', () => {
  it('is the redeem page on the app’s own URL', () => {
    expect(redeemLink('ABCDEFGHJKMN')).toBe('https://app.test/redeem?code=ABCDEFGHJKMN');
  });
});

describe('REVIEW_CODE_UNIQUE', () => {
  it('names the indexes the migration made, so a renamed index fails here rather than as a 500', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(
      'prisma/migrations/20261121100000_app_review_code/migration.sql',
      'utf8'
    );
    for (const constraint of Object.values(REVIEW_CODE_UNIQUE)) {
      expect(sql).toContain(`CREATE UNIQUE INDEX "${constraint.index}"`);
    }
  });
});

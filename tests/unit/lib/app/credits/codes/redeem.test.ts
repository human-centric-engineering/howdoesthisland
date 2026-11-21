/**
 * Checking and redeeming a free review code (t-60) against a mocked Prisma
 * client, its transactions forwarded to the same mock.
 *
 * What it shows: a check says which state a real code is in and calls
 * anything else `unknown`, malformed without a lookup; a redemption takes the
 * code's next slot, credits the workspace with a `REDEEM` entry referencing
 * it and answers with the balance; it never writes the shared code row; it
 * refuses a code that is not active, a person who has redeemed it already
 * (seen first, or lost on the index), and a workspace that is not active; a
 * slot lost to another redemption is tried again in a new transaction, for
 * as many as the code has uses (a crowd is never turned away while uses are
 * left), and losing more than that fails loudly.
 *
 * That the indexes really hold under concurrent transactions is the smoke
 * script's to show, against the database: `npm run smoke:redeem-codes`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, type ReviewCode } from '@prisma/client';

vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.test' } }));
vi.mock('@/lib/tenancy/context', () => ({
  runAsSystem: vi.fn((_reason: string, fn: () => unknown) => fn()),
}));

const db = vi.hoisted(() => {
  const client = {
    reviewCode: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    reviewCodeRedemption: { count: vi.fn(), create: vi.fn() },
    org: { findUnique: vi.fn() },
    creditEntry: { create: vi.fn(), aggregate: vi.fn() },
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((fn: (tx: typeof client) => unknown) => fn(client));
  return client;
});
vi.mock('@/lib/db/client', () => ({ prisma: db }));

import { APIError, NotFoundError } from '@/lib/api/errors';
import {
  checkCode,
  CodeRefusedError,
  redeemCode,
  REDEMPTION_UNIQUE,
  redemptionReference,
} from '@/lib/app/credits/codes/redeem';

const NOW = Date.now();
const EXPIRES = new Date(NOW + 30 * 24 * 60 * 60 * 1000);
const WHO = { orgId: 'org-a', userId: 'user-1' };

function code(overrides: Partial<ReviewCode> = {}, used = 0) {
  return {
    id: 'code-1',
    code: 'ABCDEFGHJKMN',
    creditsPerRedemption: 500,
    maxRedemptions: 3,
    expiresAt: EXPIRES,
    campaign: 'Card run',
    createdByUserId: 'admin-1',
    revokedAt: null,
    idempotencyKey: null,
    batchIndex: 0,
    createdAt: new Date(NOW - 1000),
    ...overrides,
    _count: { redemptions: used },
  };
}

function uniqueViolation(index: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: {
      modelName: 'ReviewCodeRedemption',
      driverAdapterError: { cause: { constraint: { index } } },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db));
  db.reviewCode.findUnique.mockResolvedValue(code());
  db.reviewCodeRedemption.count.mockResolvedValue(0);
  db.reviewCodeRedemption.create.mockImplementation(async ({ data }: { data: object }) => ({
    id: 'redemption-1',
    ...data,
  }));
  db.org.findUnique.mockResolvedValue({ id: 'org-a', name: 'Acme', status: 'ACTIVE' });
  db.creditEntry.create.mockImplementation(async ({ data }: { data: object }) => ({
    id: 'entry-1',
    ...data,
  }));
  db.creditEntry.aggregate.mockResolvedValue({ _sum: { amount: 750 } });
});

describe('checkCode', () => {
  it('says what an active code gives, read in any case and with spaces', async () => {
    db.reviewCode.findUnique.mockResolvedValue(code({}, 1));

    const result = await checkCode('abcd efgh-jkmn');

    expect(db.reviewCode.findUnique).toHaveBeenCalledWith({
      where: { code: 'ABCDEFGHJKMN' },
      include: { _count: { select: { redemptions: true } } },
    });
    expect(result).toEqual({
      status: 'active',
      code: 'ABCD-EFGH-JKMN',
      credits: 500,
      expiresAt: EXPIRES.toISOString(),
      alreadyRedeemed: false,
    });
    // Without a person it does not look for one.
    expect(db.reviewCodeRedemption.count).not.toHaveBeenCalled();
  });

  it('calls a malformed code unknown without looking it up', async () => {
    for (const typed of ['', 'short', 'ABCDEFGHJKM0', 'ABCDEFGHJKMNP']) {
      expect(await checkCode(typed)).toEqual({ status: 'unknown', alreadyRedeemed: false });
    }
    expect(db.reviewCode.findUnique).not.toHaveBeenCalled();
  });

  it('calls a code not found unknown, as it does a malformed one', async () => {
    db.reviewCode.findUnique.mockResolvedValue(null);
    expect(await checkCode('ABCD-EFGH-JKMN')).toEqual({
      status: 'unknown',
      alreadyRedeemed: false,
    });
  });

  it.each([
    ['expired', code({ expiresAt: new Date(NOW - 1000) }), { expiresAt: expect.any(String) }],
    ['used-up', code({}, 3), {}],
    ['revoked', code({ revokedAt: new Date(NOW - 1000) }), {}],
  ])('says a real code is %s, and nothing it would give', async (status, row, extra) => {
    db.reviewCode.findUnique.mockResolvedValue(row);

    const result = await checkCode('ABCDEFGHJKMN');

    expect(result).toEqual({ status, code: 'ABCD-EFGH-JKMN', alreadyRedeemed: false, ...extra });
    expect(result).not.toHaveProperty('credits');
  });

  it('says whether the person has redeemed it, when asked for one', async () => {
    db.reviewCodeRedemption.count.mockResolvedValue(1);

    const result = await checkCode('ABCDEFGHJKMN', 'user-1');

    expect(db.reviewCodeRedemption.count).toHaveBeenCalledWith({
      where: { codeId: 'code-1', userId: 'user-1' },
    });
    expect(result.alreadyRedeemed).toBe(true);
  });
});

describe('redeemCode', () => {
  it('takes the next slot, credits the workspace and answers with the balance', async () => {
    db.reviewCode.findUnique.mockResolvedValue(code({}, 2));

    const result = await redeemCode('abcd-efgh-jkmn', WHO);

    expect(db.reviewCodeRedemption.create).toHaveBeenCalledWith({
      data: { codeId: 'code-1', slot: 2, orgId: 'org-a', userId: 'user-1', credits: 500 },
    });
    expect(db.creditEntry.create).toHaveBeenCalledWith({
      data: {
        orgId: 'org-a',
        amount: 500,
        kind: 'REDEEM',
        reason: null,
        actorUserId: 'user-1',
        reference: 'redemption:redemption-1',
      },
    });
    expect(result).toEqual({
      redemptionId: 'redemption-1',
      code: 'ABCD-EFGH-JKMN',
      credits: 500,
      balance: 750,
      workspace: { id: 'org-a', name: 'Acme' },
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('never writes the shared code row', async () => {
    await redeemCode('ABCDEFGHJKMN', WHO);
    expect(db.reviewCode.update).not.toHaveBeenCalled();
    expect(db.reviewCode.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a malformed code as unknown without a transaction', async () => {
    await expect(redeemCode('nope', WHO)).rejects.toMatchObject({
      code: 'CODE_UNKNOWN',
      status: 404,
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', null, 404, 'CODE_UNKNOWN'],
    ['expired', code({ expiresAt: new Date(NOW - 1000) }), 410, 'CODE_EXPIRED'],
    ['used up', code({}, 3), 410, 'CODE_USED_UP'],
    ['revoked', code({ revokedAt: new Date(NOW - 1000) }), 410, 'CODE_REVOKED'],
  ])('refuses a code that is %s, writing nothing', async (_name, row, status, errorCode) => {
    db.reviewCode.findUnique.mockResolvedValue(row);

    const err = await redeemCode('ABCDEFGHJKMN', WHO).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CodeRefusedError);
    expect(err).toMatchObject({ status, code: errorCode });
    expect(db.reviewCodeRedemption.create).not.toHaveBeenCalled();
    expect(db.creditEntry.create).not.toHaveBeenCalled();
  });

  it('tells someone who took the last redemption they have it, not that it is used up', async () => {
    db.reviewCode.findUnique.mockResolvedValue(code({}, 3));
    db.reviewCodeRedemption.count.mockResolvedValue(1);

    await expect(redeemCode('ABCDEFGHJKMN', WHO)).rejects.toMatchObject({
      status: 409,
      code: 'CODE_ALREADY_REDEEMED',
    });
    expect(db.reviewCodeRedemption.create).not.toHaveBeenCalled();
  });

  it('refuses a second redemption the index caught, without trying again', async () => {
    db.reviewCodeRedemption.create.mockRejectedValue(
      uniqueViolation(REDEMPTION_UNIQUE.person.index)
    );

    await expect(redeemCode('ABCDEFGHJKMN', WHO)).rejects.toMatchObject({
      status: 409,
      code: 'CODE_ALREADY_REDEEMED',
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('refuses a workspace that is not active, writing nothing', async () => {
    db.org.findUnique.mockResolvedValue({ id: 'org-a', name: 'Acme', status: 'SUSPENDED' });

    await expect(redeemCode('ABCDEFGHJKMN', WHO)).rejects.toBeInstanceOf(NotFoundError);
    expect(db.reviewCodeRedemption.create).not.toHaveBeenCalled();
  });

  it('tries the next slot in a new transaction when another redemption took this one', async () => {
    db.reviewCode.findUnique.mockResolvedValueOnce(code({}, 1)).mockResolvedValueOnce(code({}, 2));
    db.reviewCodeRedemption.create.mockRejectedValueOnce(
      uniqueViolation(REDEMPTION_UNIQUE.slot.index)
    );

    const result = await redeemCode('ABCDEFGHJKMN', WHO);

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.reviewCodeRedemption.create.mock.calls.map(([a]) => a.data.slot)).toEqual([1, 2]);
    expect(result.credits).toBe(500);
  });

  it('finds the code used up when the slot it lost was the last', async () => {
    db.reviewCode.findUnique.mockResolvedValueOnce(code({}, 2)).mockResolvedValueOnce(code({}, 3));
    db.reviewCodeRedemption.create.mockRejectedValueOnce(
      uniqueViolation(REDEMPTION_UNIQUE.slot.index)
    );

    await expect(redeemCode('ABCDEFGHJKMN', WHO)).rejects.toMatchObject({ code: 'CODE_USED_UP' });
    expect(db.reviewCodeRedemption.create).toHaveBeenCalledTimes(1);
  });

  it('keeps trying through a crowd while uses are left, however many it loses to', async () => {
    // A 100-use card: 30 others commit first, one at a time.
    let used = 0;
    db.reviewCode.findUnique.mockImplementation(async () => code({ maxRedemptions: 100 }, used));
    db.reviewCodeRedemption.create.mockImplementation(async ({ data }: { data: object }) => {
      if (used < 30) {
        used++;
        throw uniqueViolation(REDEMPTION_UNIQUE.slot.index);
      }
      return { id: 'redemption-1', ...data };
    });

    const result = await redeemCode('ABCDEFGHJKMN', WHO);

    expect(result.credits).toBe(500);
    expect(db.$transaction).toHaveBeenCalledTimes(31);
    expect(db.reviewCodeRedemption.create.mock.calls.at(-1)?.[0].data.slot).toBe(30);
  });

  it('fails loudly if it loses more slots than the code has uses', async () => {
    // Impossible while slots are dense: each loss is a commit, so the code
    // would be found used up first.
    db.reviewCode.findUnique.mockResolvedValue(code({ maxRedemptions: 3 }, 0));
    db.reviewCodeRedemption.create.mockRejectedValue(uniqueViolation(REDEMPTION_UNIQUE.slot.index));

    const err = await redeemCode('ABCDEFGHJKMN', WHO).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(APIError);
    expect(String(err)).toContain('review code code-1 lost its slot 4 times, more than its 3 uses');
    // The code is a bearer credential: never in a message that reaches the logs.
    expect(String(err)).not.toContain('ABCD');
    expect(db.$transaction).toHaveBeenCalledTimes(4);
  });

  it('lets any other failure through untried again', async () => {
    db.creditEntry.create.mockRejectedValue(new Error('connection lost'));

    await expect(redeemCode('ABCDEFGHJKMN', WHO)).rejects.toThrow('connection lost');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('redemptionReference', () => {
  it('is the ledger’s reference for a redemption', () => {
    expect(redemptionReference('r1')).toBe('redemption:r1');
  });
});

describe('REDEMPTION_UNIQUE', () => {
  it('names the indexes the migration made, so a renamed index fails here rather than as a 500', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(
      'prisma/migrations/20261121140000_app_review_code_redemption/migration.sql',
      'utf8'
    );
    for (const constraint of Object.values(REDEMPTION_UNIQUE)) {
      expect(sql).toContain(`CREATE UNIQUE INDEX "${constraint.index}"`);
    }
  });
});

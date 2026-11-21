/**
 * Checking and redeeming a free review code (t-60). Design:
 * .context/app/credits.md.
 *
 * **The shared code row is never written here.** A code is install-level
 * config (`globalConfig`), which only platform admins change. What is used of
 * it is the count of its `ReviewCodeRedemption` rows, which are the
 * workspace's: so a customer redeeming writes only their own rows.
 *
 * **Never more than the maximum, however many redeem at once.** A redemption
 * takes the next `slot`, the number of rows the code has, and only while that
 * is below `maxRedemptions`. `(codeId, slot)` is unique, so of several
 * transactions that read the same count one inserts and the rest fail on the
 * index; each of those tries again in a new transaction, reads the new count,
 * and either takes the next slot or finds the code used up. Distinct slots
 * each below the maximum cannot number more than it. Slots stay dense because
 * no redemption row is ever deleted (its workspace and person are SET NULL).
 *
 * **No one is turned away while uses are left.** A try loses its slot only
 * when another redemption of the code commits, so a redeemer can lose at most
 * `maxRedemptions` times before the next try finds the code used up. The
 * retries are bounded by that, not by a fixed number that a crowd redeeming a
 * QR card together could exhaust (t-60 review). Losing more would mean the
 * slots are not what this says, and fails loudly.
 *
 * **One per person per code.** `(codeId, userId)` is unique, so a second
 * redemption by the same person fails on that index whatever the timing, and
 * rolls its transaction back with nothing written.
 *
 * **Credited where it is counted.** The redemption row and its `REDEEM`
 * credit entry (`redemption:<id>`) are written in one transaction.
 *
 * Reads and writes run in the system scope: the count spans every workspace
 * that redeemed the code. The workspace credited is the one the caller's
 * guard entered, named explicitly, as the admin credit change names its org.
 */
import type { Prisma } from '@prisma/client';
import { APIError, NotFoundError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { isUniqueViolationOn, type UniqueConstraint } from '@/lib/db/unique-violation';
import { runAsSystem } from '@/lib/tenancy/context';
import { getCreditBalance, recordCreditEntry } from '@/lib/app/credits/ledger';
import { formatCode, normaliseCode } from '@/lib/app/credits/codes/generate';
import { codeStatus, WITH_REDEMPTION_COUNT } from '@/lib/app/credits/codes/service';
import { REDEEM_REFUSALS, type CodeCheck, type Redemption } from '@/lib/app/credits/codes/wire';

/** The unique indexes a redemption can collide on (20261121140000_app_review_code_redemption). */
export const REDEMPTION_UNIQUE = {
  slot: {
    index: 'app_review_code_redemption_codeId_slot_key',
    model: 'ReviewCodeRedemption',
    fields: ['codeId', 'slot'],
  },
  person: {
    index: 'app_review_code_redemption_codeId_userId_key',
    model: 'ReviewCodeRedemption',
    fields: ['codeId', 'userId'],
  },
} as const satisfies Record<string, UniqueConstraint>;

/** The reference a redemption's credit entry carries. */
export function redemptionReference(redemptionId: string): string {
  return `redemption:${redemptionId}`;
}

/** Who is redeeming, into which workspace. */
export interface Redeemer {
  orgId: string;
  userId: string;
}

/** What a code would give, or why it cannot; `alreadyRedeemed` when `userId` has redeemed it. */
export type CodeCheckFor = CodeCheck & { alreadyRedeemed: boolean };

/**
 * What `typed` would give, or why it cannot. With `userId`, also whether that
 * person has already redeemed it, for the page; the public check passes none.
 */
export async function checkCode(typed: string, userId?: string): Promise<CodeCheckFor> {
  const canonical = normaliseCode(typed);
  if (!canonical) return { status: 'unknown', alreadyRedeemed: false };
  return runAsSystem('app.codes: check', async () => {
    const row = await prisma.reviewCode.findUnique({
      where: { code: canonical },
      include: WITH_REDEMPTION_COUNT,
    });
    if (!row) return { status: 'unknown', alreadyRedeemed: false };
    const alreadyRedeemed = userId
      ? (await prisma.reviewCodeRedemption.count({ where: { codeId: row.id, userId } })) > 0
      : false;
    const code = formatCode(row.code);
    const status = codeStatus(row, row._count.redemptions);
    switch (status) {
      case 'active':
        return {
          status,
          code,
          credits: row.creditsPerRedemption,
          expiresAt: row.expiresAt.toISOString(),
          alreadyRedeemed,
        };
      case 'expired':
        return { status, code, expiresAt: row.expiresAt.toISOString(), alreadyRedeemed };
      case 'used-up':
      case 'revoked':
        return { status, code, alreadyRedeemed };
    }
  });
}

const REFUSAL_MESSAGES = {
  unknown: 'We don’t recognise this code. Check it against your card or email.',
  expired: 'This code has expired.',
  'used-up': 'This code has been used as many times as it allows.',
  revoked: 'This code has been withdrawn.',
} as const;

/** A code that cannot be redeemed: 404 for one not found, 410 for one that is no longer good. */
export class CodeRefusedError extends APIError {
  constructor(public readonly reason: keyof typeof REFUSAL_MESSAGES) {
    super(REFUSAL_MESSAGES[reason], REDEEM_REFUSALS[reason], reason === 'unknown' ? 404 : 410);
    this.name = 'CodeRefusedError';
  }
}

function alreadyRedeemed(): APIError {
  return new APIError('You have already redeemed this code.', REDEEM_REFUSALS.alreadyRedeemed, 409);
}

/** A try that lost its slot to another redemption, with the code's maximum. */
interface SlotTaken {
  slotTaken: true;
  maxRedemptions: number;
}

/** One try at the next slot, in its own transaction. */
async function redeemOnce(
  canonical: string,
  who: Redeemer
): Promise<Omit<Redemption, 'code'> | SlotTaken> {
  // Read in the transaction, kept for the answer when its insert loses the slot.
  let maxRedemptions = 0;
  try {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const row = await tx.reviewCode.findUnique({
        where: { code: canonical },
        include: WITH_REDEMPTION_COUNT,
      });
      if (!row) throw new CodeRefusedError('unknown');
      // Said before the code's own state, so someone who used the last
      // redemption is told they have it, not that it is used up. The index
      // below is what holds it; this only picks the message.
      const mine = await tx.reviewCodeRedemption.count({
        where: { codeId: row.id, userId: who.userId },
      });
      if (mine > 0) throw alreadyRedeemed();
      maxRedemptions = row.maxRedemptions;
      const used = row._count.redemptions;
      const status = codeStatus(row, used);
      if (status !== 'active') throw new CodeRefusedError(status);

      // Read in the transaction, so a workspace suspended or deleted meanwhile
      // is not credited.
      const org = await tx.org.findUnique({
        where: { id: who.orgId },
        select: { id: true, name: true, status: true },
      });
      if (!org || org.status !== 'ACTIVE') throw new NotFoundError('Workspace not found');

      const redemption = await tx.reviewCodeRedemption.create({
        data: {
          codeId: row.id,
          slot: used,
          orgId: who.orgId,
          userId: who.userId,
          credits: row.creditsPerRedemption,
        },
      });
      await recordCreditEntry(
        {
          orgId: who.orgId,
          amount: row.creditsPerRedemption,
          kind: 'REDEEM',
          actorUserId: who.userId,
          reference: redemptionReference(redemption.id),
        },
        tx
      );
      return {
        redemptionId: redemption.id,
        credits: row.creditsPerRedemption,
        balance: await getCreditBalance(who.orgId, tx),
        workspace: { id: org.id, name: org.name },
      };
    });
  } catch (err) {
    if (isUniqueViolationOn(err, REDEMPTION_UNIQUE.person)) throw alreadyRedeemed();
    if (isUniqueViolationOn(err, REDEMPTION_UNIQUE.slot))
      return { slotTaken: true, maxRedemptions };
    throw err;
  }
}

/**
 * Redeem `typed` into `who.orgId`, crediting the workspace with what the code
 * gives. Throws {@link CodeRefusedError} for a code not found or no longer
 * good, and 409 `CODE_ALREADY_REDEEMED` for a second redemption by the same
 * person. A slot lost to another redemption is tried again until the code is
 * redeemed or used up.
 */
export async function redeemCode(typed: string, who: Redeemer): Promise<Redemption> {
  const canonical = normaliseCode(typed);
  if (!canonical) throw new CodeRefusedError('unknown');
  return runAsSystem('app.codes: redeem', async () => {
    for (let lost = 0; ; lost++) {
      const result = await redeemOnce(canonical, who);
      if (!('slotTaken' in result)) return { ...result, code: formatCode(canonical) };
      // Each loss is another redemption committed, so after `maxRedemptions`
      // of them the next try must find the code used up.
      if (lost >= result.maxRedemptions) {
        throw new Error(
          `Redeeming ${formatCode(canonical)} lost its slot ${lost + 1} times, more than its ${result.maxRedemptions} uses`
        );
      }
    }
  });
}

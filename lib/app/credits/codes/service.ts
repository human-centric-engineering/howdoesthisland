/**
 * Free review codes for platform admins (t-59): minting them, listing them
 * with what is left of each, and revoking one. Redeeming is t-60. Design:
 * .context/app/credits.md.
 *
 * **Install-level.** A code is shared config (`globalConfig`), not any
 * workspace's: it is made here and redeemed into whichever workspace redeems
 * it. Reads and writes run in the system scope, as the admin credit change
 * does, and the write routes declare `writesSharedSettings`.
 *
 * **Minted once per idempotency key.** The issuing API is shaped for a caller
 * that retries (ConQuest, later, minting a code for a qualified lead): the same
 * key with the same body answers with the codes it minted the first time,
 * `replayed: true`. Two calls racing with one key both try to insert; the
 * unique `(idempotencyKey, batchIndex)` lets one through, and the other reads
 * back what it made.
 */
import type { ReviewCode } from '@prisma/client';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { isUniqueViolationOn, type UniqueConstraint } from '@/lib/db/unique-violation';
import { env } from '@/lib/env';
import { runAsSystem } from '@/lib/tenancy/context';
import { likeLiteral } from '@/lib/app/credits/admin';
import { generateCode } from '@/lib/app/credits/codes/generate';
import {
  ADMIN_CODES_LIST_LIMIT,
  REDEEM_PATH,
  type AdminCodesList,
  type CodeStatus,
  type IssueCodes,
  type IssuedCodes,
  type ReviewCodeView,
} from '@/lib/app/credits/codes/wire';

/** The unique indexes a mint can collide on (20261121100000_app_review_code). */
export const REVIEW_CODE_UNIQUE = {
  code: { index: 'app_review_code_code_key', model: 'ReviewCode', fields: ['code'] },
  batch: {
    index: 'app_review_code_idempotencyKey_batchIndex_key',
    model: 'ReviewCode',
    fields: ['idempotencyKey', 'batchIndex'],
  },
} as const satisfies Record<string, UniqueConstraint>;

/** Tries at a batch whose freshly drawn code is already taken: at 59 bits, one is plenty. */
const MINT_ATTEMPTS = 3;

/** The redeem link a code's QR encodes. */
export function redeemLink(code: string): string {
  const url = new URL(REDEEM_PATH, env.NEXT_PUBLIC_APP_URL);
  url.searchParams.set('code', code);
  return url.toString();
}

/** Why a code can no longer be redeemed, or `active`. */
export function codeStatus(row: ReviewCode, now: Date = new Date()): CodeStatus {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt <= now) return 'expired';
  if (row.redemptionCount >= row.maxRedemptions) return 'used-up';
  return 'active';
}

export function toCodeView(row: ReviewCode, now: Date = new Date()): ReviewCodeView {
  return {
    id: row.id,
    code: row.code,
    link: redeemLink(row.code),
    campaign: row.campaign,
    creditsPerRedemption: row.creditsPerRedemption,
    maxRedemptions: row.maxRedemptions,
    redemptionsUsed: row.redemptionCount,
    redemptionsLeft: Math.max(0, row.maxRedemptions - row.redemptionCount),
    status: codeStatus(row, now),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** `count` distinct fresh codes. */
function drawCodes(count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateCode());
  return [...codes];
}

function findBatch(idempotencyKey: string): Promise<ReviewCode[]> {
  return prisma.reviewCode.findMany({ where: { idempotencyKey }, orderBy: { batchIndex: 'asc' } });
}

/**
 * The codes a key already minted, when the call asks for the same thing.
 * A key reused for a different request is refused rather than answered with
 * codes the caller did not ask for.
 */
function replay(batch: ReviewCode[], input: IssueCodes): IssuedCodes {
  const first = batch[0];
  const same =
    batch.length === input.count &&
    batch.every(
      (row) =>
        row.creditsPerRedemption === input.creditsPerRedemption &&
        row.maxRedemptions === input.maxRedemptions &&
        row.campaign === input.campaign &&
        row.expiresAt.getTime() === Date.parse(input.expiresAt)
    );
  if (!first || !same) {
    throw new ConflictError('This idempotency key was already used for a different request', {
      idempotencyKey: input.idempotencyKey,
    });
  }
  return { codes: batch.map((row) => toCodeView(row)), replayed: true };
}

/**
 * Mint `input.count` codes alike, recording who made them. With an
 * idempotency key, a repeat answers with the first call's codes.
 */
export async function issueCodes(input: IssueCodes, actorUserId: string): Promise<IssuedCodes> {
  return runAsSystem('app.codes: issue', async () => {
    const key = input.idempotencyKey ?? null;
    if (key) {
      const existing = await findBatch(key);
      if (existing.length > 0) return replay(existing, input);
    }

    for (let attempt = 1; ; attempt++) {
      try {
        const rows = await prisma.reviewCode.createManyAndReturn({
          data: drawCodes(input.count).map((code, batchIndex) => ({
            code,
            creditsPerRedemption: input.creditsPerRedemption,
            maxRedemptions: input.maxRedemptions,
            expiresAt: new Date(input.expiresAt),
            campaign: input.campaign,
            createdByUserId: actorUserId,
            idempotencyKey: key,
            batchIndex,
          })),
        });
        rows.sort((a, b) => a.batchIndex - b.batchIndex);
        return { codes: rows.map((row) => toCodeView(row)), replayed: false };
      } catch (err) {
        // Another call with this key got there first: answer with what it made.
        if (key && isUniqueViolationOn(err, REVIEW_CODE_UNIQUE.batch)) {
          return replay(await findBatch(key), input);
        }
        // A drawn code is taken. One insert is all or nothing, so draw again.
        if (isUniqueViolationOn(err, REVIEW_CODE_UNIQUE.code) && attempt < MINT_ATTEMPTS) continue;
        throw err;
      }
    }
  });
}

/**
 * Codes, newest first, with what is left of each. `q` narrows by campaign or
 * code (a code matches typed with or without its dashes). At most
 * {@link ADMIN_CODES_LIST_LIMIT}; `truncated` says more matched.
 */
export async function listCodes(q?: string): Promise<AdminCodesList> {
  const campaign = q ? likeLiteral(q) : undefined;
  const code = q ? likeLiteral(q.toUpperCase().replace(/[\s-]+/g, '')) : undefined;
  return runAsSystem('app.codes: admin list', async () => {
    const rows = await prisma.reviewCode.findMany({
      where:
        campaign !== undefined
          ? {
              OR: [
                { campaign: { contains: campaign, mode: 'insensitive' } },
                ...(code ? [{ code: { contains: code } }] : []),
              ],
            }
          : {},
      orderBy: [{ createdAt: 'desc' }, { batchIndex: 'asc' }, { id: 'asc' }],
      take: ADMIN_CODES_LIST_LIMIT + 1,
    });
    const now = new Date();
    return {
      codes: rows.slice(0, ADMIN_CODES_LIST_LIMIT).map((row) => toCodeView(row, now)),
      truncated: rows.length > ADMIN_CODES_LIST_LIMIT,
    };
  });
}

/**
 * Revoke a code: it can no longer be redeemed, and what it already gave
 * stays given. The row is kept, so the list still shows what it was. Revoking
 * a revoked code changes nothing and answers with it as it is.
 */
export async function revokeCode(id: string): Promise<ReviewCodeView> {
  return runAsSystem('app.codes: revoke', async () => {
    // Only a code not yet revoked is written, so its first revocation time stands.
    await prisma.reviewCode.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const row = await prisma.reviewCode.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Code not found');
    return toCodeView(row);
  });
}

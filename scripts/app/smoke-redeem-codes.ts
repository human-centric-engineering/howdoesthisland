/**
 * Smoke: redeeming a free review code holds its limits when redemptions race,
 * against the real database (t-60). Free: no AI call is made.
 *
 *   npm run smoke:redeem-codes
 *
 * What the unit tests cannot show, because their fake runs one transaction
 * at a time: that the unique `(codeId, slot)` index lets no more than a
 * code's `maxRedemptions` of many redemptions started together through, the
 * rest told the code is used up; that `(codeId, userId)` lets one person
 * through once however many times they press at once; that a crowd larger
 * than any fixed retry count all get through while uses are left; and that a
 * code's uses do not come back when the workspace or the person is erased.
 * Under `TENANCY_MODE=multi`, as the restricted app role.
 *
 * In a fresh workspace with fresh people: a code good for 3 redemptions,
 * redeemed by 24 people at once; a second code redeemed by one person 6 times
 * at once; a third, good for 30, redeemed by all 24 at once. Then the people
 * and the workspace are erased and the rows are checked again. Self-cleaning: the codes and their rows are deleted in
 * `finally` (nothing else ever deletes them).
 *
 * Exit 0 passed, 1 a check failed.
 */
import { getCreditBalance } from '@/lib/app/credits/ledger';
import { issueCodes } from '@/lib/app/credits/codes/service';
import { redeemCode } from '@/lib/app/credits/codes/redeem';
import { createWorkspaceOrg } from '@/lib/app/workspaces/provision';
import { prisma } from '@/lib/db/client';
import { eraseOrg } from '@/lib/privacy/erase-org';
import { requestUserErasure } from '@/lib/privacy/erasure-requests';
import { isMultiTenant, runAsOrg, runAsSystem } from '@/lib/tenancy/context';

const PEOPLE = 24;
const CROWD_LIMIT = 30;
const LIMIT = 3;
const PRESSES = 6;
const CREDITS = 40;
let failures = 0;

function check(ok: boolean, what: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
}

const system = <T>(fn: () => Promise<T>) => runAsSystem('smoke: redeem codes', fn);

/** How each attempt ended: `ok`, or the error code it was refused with. */
async function outcomes(attempts: Array<Promise<unknown>>): Promise<string[]> {
  const settled = await Promise.allSettled(attempts);
  return settled.map((s) => {
    if (s.status === 'fulfilled') return 'ok';
    const reason: unknown = s.reason;
    const code =
      reason && typeof reason === 'object' && 'code' in reason ? String(reason.code) : 'error';
    return code;
  });
}

function tally(results: string[]): string {
  const counts = new Map<string, number>();
  for (const r of results) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${k}×${n}`).join(', ');
}

async function main(): Promise<number> {
  check(isMultiTenant(), 'TENANCY_MODE is multi');
  if (failures > 0) return 1;

  const stamp = Date.now();
  const org = await system(() => createWorkspaceOrg('Smoke redeem codes', `smoke-redeem-${stamp}`));
  const userIds: string[] = [];
  const codeIds: string[] = [];
  let orgErased = false;
  try {
    for (let i = 0; i < PEOPLE; i++) {
      const user = await system(() =>
        prisma.user.create({
          data: { name: `Smoke ${i}`, email: `smoke-redeem-${stamp}-${i}@example.test` },
        })
      );
      userIds.push(user.id);
    }
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const issue = (maxRedemptions: number) =>
      issueCodes(
        { count: 1, creditsPerRedemption: CREDITS, maxRedemptions, expiresAt, campaign: 'smoke' },
        userIds[0] ?? ''
      ).then((r) => r.codes[0]);
    const card = await issue(LIMIT);
    const personal = await issue(PRESSES);
    const crowdCard = await issue(CROWD_LIMIT);
    if (!card || !personal || !crowdCard) throw new Error('could not mint the smoke codes');
    codeIds.push(card.id, personal.id, crowdCard.id);

    // Redeemed as the guard would call it: inside the workspace's scope.
    const asOrg = <T>(fn: () => Promise<T>) => runAsOrg(org.id, fn);

    const race = await outcomes(
      userIds.map((userId) => asOrg(() => redeemCode(card.code, { orgId: org.id, userId })))
    );
    check(
      race.filter((r) => r === 'ok').length === LIMIT &&
        race.filter((r) => r !== 'ok').every((r) => r === 'CODE_USED_UP'),
      `of ${PEOPLE} people redeeming a ${LIMIT}-use code at once, ${LIMIT} got it and the rest were told it is used up (${tally(race)})`
    );

    const presses = await outcomes(
      Array.from({ length: PRESSES }, () =>
        asOrg(() => redeemCode(personal.code, { orgId: org.id, userId: userIds[1] ?? '' }))
      )
    );
    check(
      presses.filter((r) => r === 'ok').length === 1 &&
        presses.filter((r) => r !== 'ok').every((r) => r === 'CODE_ALREADY_REDEEMED'),
      `one person pressing ${PRESSES} times at once redeemed once (${tally(presses)})`
    );

    // More people than any fixed retry count, on a code with uses for all.
    const crowd = await outcomes(
      userIds.map((userId) => asOrg(() => redeemCode(crowdCard.code, { orgId: org.id, userId })))
    );
    check(
      crowd.every((r) => r === 'ok'),
      `${PEOPLE} people redeeming a ${CROWD_LIMIT}-use code at once all got it (${tally(crowd)})`
    );
    const total = LIMIT + 1 + PEOPLE;

    await system(async () => {
      const rows = await prisma.reviewCodeRedemption.findMany({
        where: { codeId: card.id },
        orderBy: { slot: 'asc' },
      });
      check(
        JSON.stringify(rows.map((r) => r.slot)) === JSON.stringify([0, 1, 2]),
        `the card's redemptions hold slots 0, 1 and 2 (${rows.map((r) => r.slot).join(', ')})`
      );
      const entries = await prisma.creditEntry.findMany({
        where: { orgId: org.id, kind: 'REDEEM' },
        select: { amount: true, reference: true },
      });
      const references = new Set(entries.map((e) => e.reference));
      const allReferenced = (
        await prisma.reviewCodeRedemption.findMany({ where: { codeId: { in: codeIds } } })
      ).every((r) => references.has(`redemption:${r.id}`));
      check(
        entries.length === total && entries.every((e) => e.amount === CREDITS) && allReferenced,
        `the ledger holds one REDEEM entry of ${CREDITS} per redemption, each referencing it (${entries.length})`
      );
      const balance = await getCreditBalance(org.id);
      check(balance === CREDITS * total, `the balance is ${CREDITS * total} (${balance})`);
      const crowdSlots = (
        await prisma.reviewCodeRedemption.findMany({
          where: { codeId: crowdCard.id },
          orderBy: { slot: 'asc' },
        })
      ).map((r) => r.slot);
      check(
        JSON.stringify(crowdSlots) === JSON.stringify(Array.from({ length: PEOPLE }, (_, i) => i)),
        `the crowd took slots 0 to ${PEOPLE - 1}, one each`
      );
    });

    // Erasing the people and the workspace keeps the uses, anonymous.
    for (const userId of userIds.slice(1)) {
      await requestUserErasure({ userId, actorUserId: userId, reason: 'self_service' });
    }
    await system(() => eraseOrg({ orgId: org.id, actorUserId: 'smoke' }));
    orgErased = true;
    await system(async () => {
      const left = await prisma.reviewCodeRedemption.findMany({
        where: { codeId: { in: codeIds } },
      });
      check(
        left.length === total && left.every((r) => r.orgId === null),
        `after the workspace is erased its ${total} redemptions remain, with no workspace (${left.length})`
      );
      check(
        left.filter((r) => r.userId !== null).every((r) => r.userId === userIds[0]),
        'after the people are erased their redemptions name no one'
      );
    });
    const again = await outcomes([
      redeemCode(card.code, { orgId: org.id, userId: userIds[0] ?? '' }),
    ]);
    check(
      again[0] === 'CODE_USED_UP' || again[0] === 'CODE_ALREADY_REDEEMED',
      `the card is still used up once its workspace is gone (${again[0] ?? 'none'})`
    );
  } finally {
    await system(async () => {
      await prisma.reviewCodeRedemption.deleteMany({ where: { codeId: { in: codeIds } } });
      await prisma.reviewCode.deleteMany({ where: { id: { in: codeIds } } });
      if (!orgErased) await eraseOrg({ orgId: org.id, actorUserId: 'smoke' });
    }).catch((err: unknown) => {
      console.error('  ✗ could not clean up the smoke codes or workspace:', err);
      failures++;
    });
    for (const userId of userIds) {
      const exists = await system(() => prisma.user.findUnique({ where: { id: userId } }));
      if (!exists) continue;
      await requestUserErasure({ userId, actorUserId: userId, reason: 'self_service' }).catch(
        (err: unknown) => {
          console.error(`  ✗ could not erase the smoke user ${userId}:`, err);
          failures++;
        }
      );
    }
  }

  console.log(failures === 0 ? 'Redeem codes smoke passed' : `${failures} check(s) failed`);
  return failures === 0 ? 0 : 1;
}

void main()
  .catch((err: unknown) => {
    console.error(err);
    return 1;
  })
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  });

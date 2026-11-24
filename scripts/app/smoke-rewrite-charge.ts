/**
 * Smoke: a rewrite's budget hold, its recovery and its charge, against the
 * real database (t-81). Free: no AI call is made.
 *
 *   npm run smoke:rewrite-charge
 *
 * What the unit tests cannot show, because their fakes stand in for Prisma:
 * that the rewrite row is written inside the budget check's transaction
 * under its advisory lock, that a running rewrite's `heldUsd` is read back by
 * the next check, that the `rewriteId` JSON-path filter finds a rewrite's
 * cost rows and no others, that the recovery write and its charge stand
 * together, and that deleting the review takes its rewrites (the FK
 * cascade); under `TENANCY_MODE=multi`, as the restricted app role, inside
 * the workspace's scope.
 *
 * In a fresh workspace: a finished review of a few words, a completed rewrite
 * at $0.50 (the estimate's history), 80 credits, then two rewrites asked for.
 * Self-cleaning: the cost rows are deleted and the workspace (and with it its
 * rows and ledger) erased in `finally`.
 *
 * Exit 0 passed, 1 a check failed.
 */
import type { Prisma } from '@prisma/client';
import { APIError } from '@/lib/api/errors';
import { chargeRewrite } from '@/lib/app/credits/charge';
import { getCreditBalance, recordCreditEntry } from '@/lib/app/credits/ledger';
import { recoverRewrites } from '@/lib/app/rewrites/recover';
import { reserveRewriteBudget } from '@/lib/app/usage/budget';
import { createWorkspaceOrg } from '@/lib/app/workspaces/provision';
import { prisma } from '@/lib/db/client';
import { eraseOrg } from '@/lib/privacy/erase-org';
import { isMultiTenant, runAsOrg, runAsSystem } from '@/lib/tenancy/context';

let failures = 0;

function check(ok: boolean, what: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
}

const system = <T>(fn: () => Promise<T>) => runAsSystem('smoke: rewrite charge', fn);

/** A cost row as `streamAgent` writes one. */
function costRow(orgId: string, totalCostUsd: number, metadata: Prisma.InputJsonObject) {
  return {
    orgId,
    model: 'smoke-model',
    provider: 'smoke',
    inputTokens: 100,
    outputTokens: 20,
    inputCostUsd: totalCostUsd / 2,
    outputCostUsd: totalCostUsd / 2,
    totalCostUsd,
    operation: 'chat',
    metadata,
  };
}

async function main(): Promise<number> {
  check(isMultiTenant(), 'TENANCY_MODE is multi');
  if (failures > 0) return 1;
  // Any published version: the review is never scored, only rewritten from.
  const version = await system(() =>
    prisma.frameworkVersion.findFirst({ where: { status: 'PUBLISHED' }, select: { id: true } })
  );
  if (!version) {
    console.log('  ✗ no published framework version; run smoke-framework-store');
    return 1;
  }

  const stamp = Date.now();
  const org = await system(() =>
    createWorkspaceOrg('Smoke rewrite charge', `smoke-rewrite-${stamp}`)
  );
  try {
    await runAsOrg(org.id, async () => {
      await recordCreditEntry({ orgId: org.id, amount: 80, kind: 'GRANT', reason: 'smoke' });
      const content = await prisma.content.create({
        data: {
          orgId: org.id,
          sourceKind: 'TEXT',
          text: 'Smoke.',
          textSha256: 'smoke',
          wordCount: 1,
        },
      });
      const review = await prisma.assessment.create({
        data: {
          orgId: org.id,
          contentId: content.id,
          frameworkVersionId: version.id,
          profile: 'quick',
          judges: [],
          context: {},
          status: 'COMPLETED',
          result: {},
          requestedVia: 'API',
        },
      });
      // The estimate's history: one completed rewrite at $0.50.
      await prisma.rewrite.create({
        data: {
          orgId: org.id,
          assessmentId: review.id,
          focus: 'balanced',
          status: 'COMPLETED',
          costUsd: 0.5,
        },
      });

      const ask = () =>
        reserveRewriteBudget(org.id, (tx, estimate) =>
          tx.rewrite.create({
            data: {
              orgId: org.id,
              assessmentId: review.id,
              focus: 'balanced',
              heldUsd: estimate.estimateUsd,
              leaseExpiresAt: new Date(Date.now() + 90_000),
            },
          })
        );

      const first = await ask();
      check(first.heldUsd === 0.5, `the first rewrite holds its $0.50 estimate (${first.heldUsd})`);

      // 80 credits is $0.80: with $0.50 held, a second $0.50 does not fit.
      const refused = await ask().then(
        () => null,
        (err: unknown) => err
      );
      check(
        refused instanceof APIError && refused.code === 'INSUFFICIENT_CREDITS',
        `the second is refused while the first holds its estimate (${refused instanceof APIError ? refused.code : String(refused)})`
      );
      const running = await prisma.rewrite.count({
        where: { orgId: org.id, status: 'RUNNING' },
      });
      check(running === 1, `the refused one wrote no row (${running} running)`);

      // Its call was billed $0.0301, then its process died.
      const since = first.createdAt;
      await prisma.aiCostLog.createMany({
        data: [
          costRow(org.id, 0.0301, { editor: 'rewrite', rewriteId: first.id }),
          costRow(org.id, 0.09, { editor: 'rewrite', rewriteId: 'someone-else' }),
        ],
      });
      const recovered = await recoverRewrites(new Date(Date.now() + 120_000));
      check(recovered.failed === 1, `recovery failed the lost rewrite (${recovered.failed})`);
      const lost = await prisma.rewrite.findUnique({ where: { id: first.id } });
      check(
        lost?.status === 'FAILED' && lost.errorCode === 'lost' && lost.costUsd === 0.0301,
        `it is failed, 'lost', at what its own rows record (${lost?.status}, ${lost?.errorCode}, ${lost?.costUsd})`
      );
      const charges = await prisma.creditEntry.findMany({
        where: { orgId: org.id, kind: 'CHARGE' },
        select: { amount: true, reference: true },
      });
      check(
        JSON.stringify(charges) ===
          JSON.stringify([{ amount: -4, reference: `rewrite:${first.id}` }]),
        `it is charged 4 credits, once: ${JSON.stringify(charges)}`
      );
      const again = await prisma.$transaction((tx) => chargeRewrite(tx, org.id, first.id, since));
      check(again.credits === 0, 'charging it again takes nothing');
      check((await getCreditBalance(org.id)) === 76, 'the balance is 76');

      // Ended, it holds nothing: a rewrite fits again.
      const third = await ask();
      check(third.heldUsd === 0.5, 'with the lost one ended, the next rewrite fits');

      await prisma.assessment.delete({ where: { id: review.id } });
      const left = await prisma.rewrite.count({ where: { orgId: org.id } });
      check(left === 0, `deleting the review took its rewrites (${left} left)`);
    });
  } finally {
    await system(async () => {
      await prisma.aiCostLog.deleteMany({ where: { orgId: org.id } });
      await eraseOrg({ orgId: org.id, actorUserId: 'smoke' });
    }).catch((err: unknown) => {
      console.error(`  ✗ could not clean up the smoke workspace ${org.id}:`, err);
      failures++;
    });
  }

  console.log(failures === 0 ? 'Rewrite charge smoke passed' : `${failures} check(s) failed`);
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

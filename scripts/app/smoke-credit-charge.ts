/**
 * Smoke: a review's CopyCredits charge happens once when finishers race,
 * against the real database (t-58). Free: no AI call is made.
 *
 *   npm run smoke:credit-charge
 *
 * What the unit tests cannot show, because their fake runs one insert at a
 * time: that `(kind, reference)`'s unique index, with `skipDuplicates` (ON
 * CONFLICT DO NOTHING), lets exactly one of several transactions that charge
 * the same review at the same moment write the entry, and that the others
 * neither fail nor abort their transaction; under `TENANCY_MODE=multi`, as
 * the restricted app role, inside the workspace's scope.
 *
 * In a fresh workspace: cost rows for a stored review and a `store: false`
 * run, as `run-judge.ts` writes them; then eight transactions charging each,
 * started together, each reading the rows and inserting the charge before it
 * commits, as `finish()` does. Self-cleaning: the cost rows are deleted and
 * the workspace (and with it its ledger) erased in `finally`.
 *
 * Exit 0 passed, 1 a check failed.
 */
import type { Prisma } from '@prisma/client';
import { chargeEphemeralRun, chargeStoredReview } from '@/lib/app/credits/charge';
import { getCreditBalance } from '@/lib/app/credits/ledger';
import { createWorkspaceOrg } from '@/lib/app/workspaces/provision';
import { prisma } from '@/lib/db/client';
import { eraseOrg } from '@/lib/privacy/erase-org';
import { isMultiTenant, runAsOrg, runAsSystem } from '@/lib/tenancy/context';

const FINISHERS = 8;
let failures = 0;

function check(ok: boolean, what: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
}

const system = <T>(fn: () => Promise<T>) => runAsSystem('smoke: credit charge', fn);

/** A cost row as `run-judge.ts` writes one. */
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

  const stamp = Date.now();
  const org = await system(() =>
    createWorkspaceOrg('Smoke credit charge', `smoke-credit-${stamp}`)
  );
  const assessmentId = `smoke-assessment-${stamp}`;
  const runId = `smoke-run-${stamp}`;
  const since = new Date(Date.now() - 1_000);
  try {
    await runAsOrg(org.id, async () => {
      // $0.0246 for the stored review (3 credits), $0.0301 for the run (4 credits).
      await prisma.aiCostLog.createMany({
        data: [
          costRow(org.id, 0.0123, { assessmentId, judge: 'judge_a' }),
          costRow(org.id, 0.0123, { assessmentId, judge: 'judge_b' }),
          costRow(org.id, 0.0301, { ephemeral: true, ephemeralRun: runId, judge: 'judge_a' }),
        ],
      });

      const stored = await Promise.all(
        Array.from({ length: FINISHERS }, () =>
          prisma.$transaction((tx) => chargeStoredReview(tx, org.id, assessmentId, since))
        )
      );
      const storedTaken = stored.filter((r) => r.credits > 0);
      check(
        storedTaken.length === 1 && storedTaken[0]?.credits === 3,
        `of ${FINISHERS} finishers charging a stored review together, one took 3 credits (${stored.map((r) => r.credits).join(', ')})`
      );

      const ephemeral = await Promise.all(
        Array.from({ length: FINISHERS }, () =>
          prisma.$transaction((tx) => chargeEphemeralRun(org.id, runId, since, tx))
        )
      );
      const ephemeralTaken = ephemeral.filter((r) => r.credits > 0);
      check(
        ephemeralTaken.length === 1 && ephemeralTaken[0]?.credits === 4,
        `of ${FINISHERS} charging a store: false run together, one took 4 credits (${ephemeral.map((r) => r.credits).join(', ')})`
      );

      const entries = await prisma.creditEntry.findMany({
        where: { orgId: org.id },
        select: { amount: true, kind: true, reference: true },
        orderBy: { amount: 'asc' },
      });
      check(
        JSON.stringify(entries) ===
          JSON.stringify([
            { amount: -4, kind: 'CHARGE', reference: `ephemeral-run:${runId}` },
            { amount: -3, kind: 'CHARGE', reference: `assessment:${assessmentId}` },
          ]),
        `the ledger holds one charge each: ${JSON.stringify(entries)}`
      );
      const balance = await getCreditBalance(org.id);
      check(balance === -7, `the balance is -7, below zero by the charges (${balance})`);

      // A recovery after the run already charged: nothing more.
      const again = await chargeStoredReview(prisma, org.id, assessmentId, since);
      check(again.credits === 0, 'charging the review again later takes nothing');
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

  console.log(failures === 0 ? 'Credit charge smoke passed' : `${failures} check(s) failed`);
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

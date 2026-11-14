/**
 * Smoke: an assessment run end to end in a fresh workspace, at
 * `TENANCY_MODE=multi`, against real OpenAI (t-22).
 *
 *   npx tsx --env-file=.env.local scripts/smoke/assessment.ts
 *
 * What the unit tests cannot show, because they fake the store and the judges:
 *
 *   • a freshly provisioned workspace can run judges with no admin step
 *     (`equipWorkspace` grants OpenAI and creates its agents);
 *   • the claim's serializable transaction, the lease writes and the JudgeRun
 *     upserts work as the restricted app role, under the `org_isolation`
 *     policy;
 *   • an assessment completes, each judge's row and cost row are the
 *     workspace's, and the cost rows name the assessment;
 *   • the recovery job, in the workspace's scope, completes a run that died;
 *   • a second workspace reads none of it, and cannot cancel it.
 *
 * Judges the baseline's eval case ev01 with two judges (ethos, logos) on
 * framework 0.5.1, which must be imported and published (`smoke-framework-
 * store.ts` leaves it so). The recovered run uses the `quick` profile, so it
 * costs nothing. Needs `.context/app/dev-environment.md`'s setup, including
 * `OPENAI_API_KEY`. Costs two judge calls, a few cents. Self-cleaning: both
 * workspaces, and with them every row, are erased in `finally`.
 *
 * Exit 0 passed, 1 a check failed.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { enqueueAssessment } from '@/lib/app/assessments/enqueue';
import { recoverAssessments } from '@/lib/app/assessments/recover';
import { cancelAssessment, runAssessment } from '@/lib/app/assessments/run';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import { prismaFrameworkRepo as repo } from '@/lib/app/frameworks/repo';
import { createWorkspaceOrg, equipWorkspace } from '@/lib/app/workspaces/provision';
import { prisma } from '@/lib/db/client';
import { eraseOrg } from '@/lib/privacy/erase-org';
import { isMultiTenant, runAsOrg, runAsSystem } from '@/lib/tenancy/context';

const CASE_FILE = 'tests/fixtures/app/engine-baseline/eval/ev01.json';
const VERSION = '0.5.1';
const JUDGES = ['judge_ethos', 'judge_logos'];
let failures = 0;

function check(ok: boolean, what: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
}

const caseSchema = z.object({
  input: z.object({
    text: z.string(),
    ctx: z.object({
      contentType: z.string(),
      archetype: z.string(),
      role: z.string().optional(),
      audience: z.record(z.string(), z.string()),
      culture: z.object({ reader: z.string().optional(), writer: z.string().optional() }),
    }),
  }),
});

const system = <T>(fn: () => Promise<T>) => runAsSystem('smoke: assessment', fn);

async function main(): Promise<number> {
  check(isMultiTenant(), 'TENANCY_MODE is multi');
  if (failures > 0) return 1;
  const { text, ctx } = caseSchema.parse(JSON.parse(readFileSync(CASE_FILE, 'utf8'))).input;

  const version = await system(() => repo.findVersion(howDoesThisLand.slug, VERSION));
  if (version?.status !== 'PUBLISHED') {
    console.log(
      `  ✗ ${howDoesThisLand.slug} ${VERSION} is not published; run smoke-framework-store`
    );
    return 1;
  }

  const stamp = Date.now();
  const orgA = await system(() =>
    createWorkspaceOrg('Smoke assessment A', `smoke-assess-a-${stamp}`)
  );
  const orgB = await system(() =>
    createWorkspaceOrg('Smoke assessment B', `smoke-assess-b-${stamp}`)
  );
  try {
    const { granted } = await system(() => equipWorkspace(orgA.id, 'smoke:assessment'));
    check(granted, 'the fresh workspace is approved for OpenAI, with no admin step');
    if (!granted) return 1;

    // ── A run that completes ──────────────────────────────────────────────
    const { assessmentId, judges } = await runAsOrg(orgA.id, () =>
      enqueueAssessment({
        content: { text, sourceKind: 'TEXT', title: 'ev01' },
        frameworkVersionId: version.id,
        profile: JUDGES,
        context: ctx,
        requestedVia: 'API',
      })
    );
    check(judges.join() === JUDGES.join(), `queued with judges ${judges.join(', ')}`);

    const started = Date.now();
    const outcome = await runAsOrg(orgA.id, () => runAssessment(assessmentId));
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    check(outcome === 'completed', `the run ended '${outcome}' in ${seconds}s`);

    await runAsOrg(orgA.id, async () => {
      const row = await prisma.assessment.findUnique({
        where: { id: assessmentId },
        include: { judgeRuns: true },
      });
      console.log(
        `  assessment: ${row?.status}, overall ${row?.overall}, band ${row?.band}, $${row?.costUsd.toFixed(4)}`
      );
      for (const run of row?.judgeRuns ?? []) {
        console.log(
          `    ${run.judge}: ${run.status} on ${run.provider}/${run.modelName}, ${run.latencyMs}ms, $${run.costUsd.toFixed(4)}${run.errorCode ? ` (${run.errorCode})` : ''}`
        );
      }
      check(row?.status === 'COMPLETED', 'the assessment is COMPLETED');
      check(
        typeof row?.overall === 'number' && typeof row.band === 'string',
        'it has an overall score and band'
      );
      check(row?.leaseToken === null && row.leaseExpiresAt === null, 'its lease is released');
      check(
        row?.judgeRuns.length === 2 &&
          row.judgeRuns.every((r) => r.status === 'SUCCEEDED' && r.orgId === orgA.id),
        'both JudgeRun rows saved, succeeded, in the workspace'
      );
      check((row?.costUsd ?? 0) > 0, 'its cost is the judges’ cost');

      const costRows = await prisma.aiCostLog.findMany({
        where: { orgId: orgA.id, metadata: { path: ['assessmentId'], equals: assessmentId } },
        select: { id: true },
      });
      check(costRows.length === 2, `two cost rows name the assessment (${costRows.length})`);
    });

    // ── A run that died, completed by the recovery job ────────────────────
    const died = await runAsOrg(orgA.id, async () => {
      const queued = await enqueueAssessment({
        content: { text, sourceKind: 'TEXT' },
        frameworkVersionId: version.id,
        profile: 'quick',
        context: ctx,
        requestedVia: 'APP',
      });
      // As a process killed mid-run leaves it: running, with a lease that has run out.
      await prisma.assessment.update({
        where: { id: queued.assessmentId },
        data: {
          status: 'RUNNING',
          attempts: 1,
          leaseToken: 'dead-process',
          leaseExpiresAt: new Date(Date.now() - 1_000),
        },
      });
      return queued.assessmentId;
    });
    const recovered = await runAsOrg(orgA.id, () => recoverAssessments());
    const diedRow = await runAsOrg(orgA.id, () =>
      prisma.assessment.findUnique({
        where: { id: died },
        select: { status: true, attempts: true },
      })
    );
    check(
      recovered.redriven === 1 && diedRow?.status === 'COMPLETED' && diedRow.attempts === 2,
      `the recovery job completed the run that died (${JSON.stringify(recovered)}, ${diedRow?.status}, attempt ${diedRow?.attempts})`
    );
    const again = await runAsOrg(orgA.id, () => recoverAssessments());
    check(again.redriven === 0 && again.gaveUp === 0, 'a second recovery pass changes nothing');

    // ── Another workspace sees none of it ─────────────────────────────────
    await runAsOrg(orgB.id, async () => {
      const [assessment, contents, runs] = await Promise.all([
        prisma.assessment.findUnique({ where: { id: assessmentId } }),
        prisma.content.count(),
        prisma.judgeRun.count({ where: { assessmentId } }),
      ]);
      check(assessment === null, 'workspace B reads the assessment as not found');
      check(contents === 0 && runs === 0, 'workspace B sees no content and no judge runs');
      check(!(await cancelAssessment(died)), 'workspace B cannot cancel A’s assessment');
    });
  } finally {
    for (const org of [orgA, orgB]) {
      await system(() => eraseOrg({ orgId: org.id, actorUserId: 'smoke' })).catch(
        (err: unknown) => {
          console.error(`  ✗ could not erase the smoke workspace ${org.id}:`, err);
          failures++;
        }
      );
    }
  }

  console.log(failures === 0 ? 'Assessment smoke passed' : `${failures} check(s) failed`);
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

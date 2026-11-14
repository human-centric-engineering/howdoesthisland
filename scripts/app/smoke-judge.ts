/**
 * Smoke: one judge run against real OpenAI, in a dev workspace (t-19).
 *
 *   npm run smoke:judge
 *
 * What the unit tests cannot show, because they script the provider:
 *
 *   • a new workspace's ethos judge is bound to OpenAI, and `runJudge` finds
 *     it by slug inside that workspace's context at `TENANCY_MODE=multi`;
 *   • OpenAI accepts the slot's schema in strict mode, and its reply passes
 *     the engine's post-validation;
 *   • the cost row is written in the workspace, priced, with the judge and
 *     framework version in its metadata.
 *
 * Judges the baseline's eval case ev01 (a landing page) on framework 0.5.1,
 * which must be imported and published (`smoke-framework-store.ts` leaves it
 * so). Needs the setup in `.context/app/dev-environment.md`, including
 * `OPENAI_API_KEY`. Costs one judge call, about a cent. Self-cleaning: the
 * workspace, and with it the cost row, is erased in `finally`.
 *
 * Exit 0 passed, 1 a check failed.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import { prismaFrameworkRepo as repo } from '@/lib/app/frameworks/repo';
import { materialise } from '@/lib/app/frameworks/store';
import { judgeAgentSlug } from '@/lib/app/judges/agents';
import { runJudge } from '@/lib/app/judges/run-judge';
import { createWorkspaceOrg, equipWorkspace } from '@/lib/app/workspaces/provision';
import { prisma } from '@/lib/db/client';
import { eraseOrg } from '@/lib/privacy/erase-org';
import { isMultiTenant, runAsOrg, runAsSystem } from '@/lib/tenancy/context';

const CASE_FILE = 'tests/fixtures/app/engine-baseline/eval/ev01.json';
const VERSION = '0.5.1';
const SLOT = 'judge_ethos';
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

const system = <T>(fn: () => Promise<T>) => runAsSystem('smoke: judge', fn);

async function main(): Promise<number> {
  check(isMultiTenant(), 'TENANCY_MODE is multi');
  // Nothing is created or billed on a database not set up as the app runs.
  if (failures > 0) return 1;
  const { text, ctx } = caseSchema.parse(JSON.parse(readFileSync(CASE_FILE, 'utf8'))).input;

  const version = await system(() => repo.findVersion(howDoesThisLand.slug, VERSION));
  if (version?.status !== 'PUBLISHED') {
    console.log(
      `  ✗ ${howDoesThisLand.slug} ${VERSION} is not published; run smoke-framework-store`
    );
    return 1;
  }

  const org = await system(() => createWorkspaceOrg('Smoke judge', `smoke-judge-${Date.now()}`));
  try {
    const { granted } = await system(() => equipWorkspace(org.id, 'smoke:judge'));
    check(granted, 'the workspace is approved for OpenAI');
    // Without the grant the call would fail at the provider gate, or bill
    // against a set-up the app never runs; the workspace is still erased.
    if (!granted) return 1;

    await runAsOrg(org.id, async () => {
      const agent = await prisma.aiAgent.findUnique({
        where: { orgId_slug: { orgId: org.id, slug: judgeAgentSlug(SLOT) } },
        select: { provider: true, model: true },
      });
      check(
        agent?.provider === 'openai' && agent.model.length > 0,
        `its ${SLOT} agent is bound to ${agent?.provider}/${agent?.model}`
      );

      const model = await materialise(repo, howDoesThisLand, version.id);
      const engine = createHowDoesThisLandEngine(model, { culture: false });
      const started = Date.now();
      const run = await runJudge(SLOT, {
        engine,
        frameworkVersion: `${howDoesThisLand.slug}@${VERSION}`,
        text,
        ctx,
      });
      const seconds = ((Date.now() - started) / 1000).toFixed(1);

      console.log(`\n  ${SLOT} on ${run.provider}/${run.model} in ${seconds}s:`);
      console.log(JSON.stringify(run.output, null, 2).replace(/^/gm, '    '));
      console.log(`  drops: ${JSON.stringify(run.drops)}`);
      console.log(
        `  usage: ${run.usage.input} in, ${run.usage.output} out, ${run.usage.attempts} attempt(s)\n`
      );

      check(run.finishReason === 'stop', `finished with '${run.finishReason}'`);
      const scores = run.output.dimension_scores ?? [];
      check(scores.length > 0, `the reply scores ${scores.length} ethos dimension(s)`);

      check(run.costLogIds.length === 1, `one cost row written (${run.costLogIds.length})`);
      const [rowId] = run.costLogIds;
      const row = rowId ? await prisma.aiCostLog.findUnique({ where: { id: rowId } }) : null;
      console.log('  cost row:');
      console.log(
        JSON.stringify(
          row && {
            id: row.id,
            orgId: row.orgId,
            agentId: row.agentId,
            operation: row.operation,
            provider: row.provider,
            model: row.model,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            totalCostUsd: row.totalCostUsd,
            metadata: row.metadata,
          },
          null,
          2
        ).replace(/^/gm, '    ')
      );
      const metadata = z
        .object({ judge: z.string(), frameworkVersion: z.string() })
        .safeParse(row?.metadata);
      check(row?.orgId === org.id, 'the cost row is the workspace’s');
      check((row?.totalCostUsd ?? 0) > 0, 'the cost row is priced');
      check(
        metadata.success &&
          metadata.data.judge === SLOT &&
          metadata.data.frameworkVersion === `${howDoesThisLand.slug}@${VERSION}`,
        'the cost row names the judge and the framework version'
      );
    });
  } finally {
    await system(() => eraseOrg({ orgId: org.id, actorUserId: 'smoke' })).catch((err: unknown) => {
      // Left behind, so say which, and fail the run.
      console.error(`  ✗ could not erase the smoke workspace ${org.id}:`, err);
      failures++;
    });
  }

  console.log(failures === 0 ? 'Judge smoke passed' : `${failures} check(s) failed`);
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

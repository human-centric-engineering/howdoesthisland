/**
 * Measure a candidate judge model on the calibration set (t-39, D8).
 *
 *   npx tsx --env-file=.env.local scripts/app/calibration/measure-judge-model.ts \
 *     --model claude-haiku-5-5 --probe
 *   npx tsx --env-file=.env.local scripts/app/calibration/measure-judge-model.ts \
 *     --model claude-haiku-5-5
 *
 * Binds the install org's nine judges to `--model` for the length of the
 * command, then puts their bindings back as they were, in `finally`. The
 * model must be on both the judge and the influence judge's approved lists
 * (`lib/app/judges/approved-models.ts`), whose entries carry the reply
 * ceiling, timeout and reasoning effort each call is sent with. While bound,
 * each agent is marked as the org's binding, so the platform-agent reconcile
 * cannot move it back mid-run.
 *
 * - `--probe`: one case (`--case`, default the set's first) through every
 *   judge, ephemeral, and prints each judge's tokens, latency, cost and
 *   finish. Stores no calibration run. For sizing the settings before a full
 *   run is paid for.
 * - otherwise: a full AI calibration run of `--version` (default 0.5.1),
 *   stored like `npm run calibrate`'s, and printed with its wall time.
 *
 * A development tool: it rebinds the install org's real agents, so it is not
 * for a production database. Exit 0 done, 1 refused or failed, 2 bad usage.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { runJudges } from '@/lib/app/assessments/fan-out';
import { runCalibrate } from '@/lib/app/calibration/cli';
import { caseContext } from '@/lib/app/calibration/schema';
import { loadBundledSet } from '@/lib/app/calibration/sets';
import { prismaCalibrationStore } from '@/lib/app/calibration/store';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import { prismaFrameworkRepo as repo } from '@/lib/app/frameworks/repo';
import { materialise } from '@/lib/app/frameworks/store';
import { judgeAgentSlug } from '@/lib/app/judges/agents';
import { APPROVED_MODELS } from '@/lib/app/judges/approved-models';
import { HOWDOESTHISLAND_JUDGE_SLOTS } from '@/lib/app/frameworks/howdoesthisland/judge-slots';
import { prisma } from '@/lib/db/client';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { runAsOrg, runAsSystem } from '@/lib/tenancy/context';

const argsSchema = z.object({
  model: z.string().min(1),
  version: z.string().default('0.5.1'),
  probe: z.boolean().default(false),
  case: z.string().optional(),
});

function parseArgs(argv: string[]): z.infer<typeof argsSchema> {
  const raw: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--probe') {
      raw.probe = true;
      continue;
    }
    const value = argv[i + 1];
    // A flag followed by another flag has no value: bad usage, not a value of `--probe`.
    if (!flag.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(
        `Bad usage at "${flag}": expected --model <id> [--version <v>] [--case <id>] [--probe]`
      );
    }
    raw[flag.slice(2)] = value;
    i++;
  }
  return argsSchema.parse(raw);
}

// A command's own output, for the person who ran it.
const out = (line: string) => console.log(line);

async function probe(version: string, caseId: string | undefined): Promise<number> {
  const found = await runAsSystem('measure: read version', async () => {
    const v = await repo.findVersion(howDoesThisLand.slug, version);
    return v ? { v, model: await materialise(repo, howDoesThisLand, v.id) } : null;
  });
  const set = await loadBundledSet(version);
  if (!found || !set) {
    out(`No ${version}, or no set for it.`);
    return 1;
  }
  const c = caseId ? set.cases.find((x) => x.id === caseId) : set.cases[0];
  if (!c) {
    out(`No case ${caseId}.`);
    return 1;
  }
  const engine = createHowDoesThisLandEngine(found.model, { culture: true });
  const parsed = engine.parseContext(caseContext(c));
  if (!parsed.ok) {
    out(`Case ${c.id}'s context is refused.`);
    return 1;
  }
  const started = Date.now();
  const { landed } = await runAsOrg(INSTALL_ORG_ID, () =>
    runJudges({
      engine,
      frameworkVersion: `${howDoesThisLand.slug}@${version}`,
      text: c.text,
      ctx: parsed.ctx,
      slots: engine.activeJudgeSlots('full'),
      ephemeral: true,
      costTags: { measure: 'probe' },
      userId: null,
    })
  );
  let cost = 0;
  for (const j of landed) {
    if (j.ok) {
      cost += j.reply.costUsd;
      out(
        `${j.slot.padEnd(16)} ok  in ${j.reply.usage.input} out ${j.reply.usage.output} ` +
          `x${j.reply.usage.attempts} ${(j.latencyMs / 1000).toFixed(1)}s ` +
          `$${j.reply.costUsd.toFixed(4)} ${j.reply.finishReason}`
      );
    } else {
      cost += j.spend?.costUsd ?? 0;
      out(`${j.slot.padEnd(16)} FAIL ${j.code}: ${j.message}`);
    }
  }
  out(
    `case ${c.id}: ${landed.filter((j) => j.ok).length}/${landed.length} ok, ` +
      `$${cost.toFixed(4)}, ${((Date.now() - started) / 1000).toFixed(1)}s wall`
  );
  return landed.every((j) => j.ok) ? 0 : 1;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const judge = APPROVED_MODELS.judge.find((e) => e.model === args.model);
  const influence = APPROVED_MODELS.influence.find((e) => e.model === args.model);
  if (!judge || !influence) {
    out(`${args.model} is not on both the judge and the influence judge's approved lists.`);
    return 2;
  }
  const slugs = HOWDOESTHISLAND_JUDGE_SLOTS.map(judgeAgentSlug);
  const saved = await runAsSystem('measure: read bindings', () =>
    prisma.aiAgent.findMany({
      where: { orgId: INSTALL_ORG_ID, slug: { in: slugs } },
      select: { id: true, provider: true, model: true, bindingOwner: true },
    })
  );
  if (saved.length !== slugs.length) {
    out(`The install org has ${saved.length} of the ${slugs.length} judge agents.`);
    return 1;
  }
  await runAsSystem('measure: bind candidate', () =>
    prisma.aiAgent.updateMany({
      where: { id: { in: saved.map((a) => a.id) } },
      data: { provider: judge.provider, model: judge.model, bindingOwner: 'org' },
    })
  );
  out(
    `Judges bound to ${judge.provider}/${judge.model} (effort ${judge.settings.reasoningEffort ?? 'default'}).`
  );
  // Once only, whichever comes first: the run ending, or an interrupt.
  let restored: Promise<void> | null = null;
  const restore = () =>
    (restored ??= runAsSystem('measure: restore bindings', () =>
      prisma.$transaction(
        saved.map((a) =>
          prisma.aiAgent.update({
            where: { id: a.id },
            data: { provider: a.provider, model: a.model, bindingOwner: a.bindingOwner },
          })
        )
      )
    ).then(() => out('Judge bindings restored.')));
  // `finally` does not run when the process is interrupted, which would leave
  // the install org's judges on the candidate, owned by the org, for good.
  const onSignal = (signal: NodeJS.Signals) => {
    out(`${signal}: restoring the judge bindings before exiting.`);
    restore()
      .catch((err: unknown) => {
        console.error('Could not restore the judge bindings; they were:', saved, err);
      })
      .finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    if (args.probe) return await probe(args.version, args.case);
    const started = Date.now();
    const code = await runCalibrate(['--mode', 'ai', '--version', args.version], {
      repo,
      store: prismaCalibrationStore,
      runJudges,
      runAsInstallOrg: (fn) => runAsOrg(INSTALL_ORG_ID, fn),
      readFile: (path) => readFileSync(path, 'utf8'),
      runAsSystem,
      out,
    });
    out(`Wall time ${((Date.now() - started) / 60_000).toFixed(1)} min.`);
    return code;
  } finally {
    await restore();
  }
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(2);
  });

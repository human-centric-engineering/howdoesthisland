/**
 * The calibrate command (t-37), behind `scripts/app/calibrate.ts`, which only
 * wires it to the real file system, database and process.
 *
 *   npm run calibrate -- --mode quick|ai --version <v> [--set <file>]
 *
 * Runs the HowDoesThisLand calibration set against an imported version
 * (draft or published), stores the run, and prints its totals beside the
 * last run of the same mode. The set defaults to the one written for the
 * version, `lib/app/frameworks/howdoesthisland/data/eval-<v>.json`.
 *
 * `ai` calls every judge on every case, in the install org, against its
 * budget: about 26 cases × 9 judges.
 */
import { calibrationSetSchema } from '@/lib/app/calibration/schema';
import type { RunComparison } from '@/lib/app/calibration/compare';
import {
  CalibrationError,
  runCalibration,
  type CalibrationMode,
  type RunCalibrationDeps,
} from '@/lib/app/calibration/run';
import { CHECK_KINDS, type Totals } from '@/lib/app/calibration/score';
import type { ExitCode } from '@/lib/app/frameworks/cli';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import type { FrameworkRepo } from '@/lib/app/frameworks/repo';
import { materialise, type FrameworkReader } from '@/lib/app/frameworks/store';

export interface CalibrateDeps extends RunCalibrationDeps {
  repo: Pick<FrameworkRepo, 'findVersion'> & FrameworkReader;
  readFile: (path: string) => string;
  runAsSystem: <T>(reason: string, fn: () => Promise<T>) => Promise<T>;
  out: (line: string) => void;
}

const USAGE = 'Usage: calibrate --mode quick|ai --version <version> [--set <eval-file.json>]';
const setFileFor = (version: string) =>
  `lib/app/frameworks/howdoesthisland/data/eval-${version}.json`;

function parseArgs(
  args: readonly string[]
): { mode: CalibrationMode; version: string; set: string | null } | null {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const [name, value] = [args[i], args[i + 1]];
    if (!['--mode', '--version', '--set'].includes(name) || value === undefined) return null;
    if (flags.has(name)) return null;
    flags.set(name, value);
  }
  const mode = flags.get('--mode');
  const version = flags.get('--version');
  if ((mode !== 'quick' && mode !== 'ai') || !version) return null;
  return { mode, version, set: flags.get('--set') ?? null };
}

const pct = (x: number | null) => (x === null ? '–' : `${(x * 100).toFixed(1)}%`);
const signed = (x: number | null) =>
  x === null ? '' : ` (${x > 0 ? '+' : ''}${(x * 100).toFixed(1)} pts)`;

function printTotals(totals: Totals, comparison: RunComparison | null, out: (l: string) => void) {
  out(
    `Agreement ${pct(totals.agreement)} over ${totals.checks} checks in ${totals.cases} cases` +
      (comparison ? signed(comparison.agreementDelta) : '')
  );
  for (const k of CHECK_KINDS) {
    const t = totals.byKind[k];
    if (!t.n) continue;
    const change = comparison?.byKind[k].delta ?? null;
    out(`  ${k.padEnd(9)} ${t.ok} ok, ${t.near} near, ${t.miss} miss of ${t.n}${signed(change)}`);
  }
  if (totals.judgeFailures) {
    out(`  ${totals.judgeFailures} judge call(s) failed: this run cannot publish a draft.`);
  }
  if (!comparison) {
    out('No earlier run of this mode to compare with.');
    return;
  }
  out(
    `Compared with run ${comparison.previousRunId} (${comparison.previousFrameworkVersion}, ` +
      `${comparison.previousRanAt}): ${comparison.flips.length} check(s) changed.`
  );
  for (const f of comparison.flips) out(`  ${f.case} ${f.kind} ${f.key}: ${f.from} → ${f.to}`);
}

/** Exit codes as the framework commands: 0 done, 1 refused, 2 bad usage. */
export async function runCalibrate(
  args: readonly string[],
  deps: CalibrateDeps
): Promise<ExitCode> {
  const parsed = parseArgs(args);
  if (!parsed) {
    deps.out(USAGE);
    return 2;
  }
  const { mode, version } = parsed;
  const slug = howDoesThisLand.slug;

  const found = await deps.runAsSystem(`calibrate: read ${slug} ${version}`, async () => {
    const v = await deps.repo.findVersion(slug, version);
    return v ? { v, model: await materialise(deps.repo, howDoesThisLand, v.id) } : null;
  });
  if (!found) {
    deps.out(`No ${slug} version ${version}. Import it first.`);
    return 1;
  }

  const file = parsed.set ?? setFileFor(version);
  let raw: string;
  try {
    raw = deps.readFile(file);
  } catch {
    deps.out(`No calibration set at ${file}.`);
    return 1;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    deps.out(`${file} is not valid JSON.`);
    return 1;
  }
  const set = calibrationSetSchema.safeParse(json);
  if (!set.success) {
    deps.out(`${file} is not a calibration set:`);
    for (const issue of set.error.issues) deps.out(`  ${issue.path.join('.')}: ${issue.message}`);
    return 1;
  }

  try {
    const { run, comparison } = await runCalibration(
      { version: found.v, model: found.model, set: set.data, mode },
      deps
    );
    deps.out(
      `${slug} ${version}, ${mode} run ${run.id} (set ${run.setVersion}` +
        (mode === 'ai' ? `, $${run.costUsd.toFixed(4)}` : '') +
        ')'
    );
    printTotals(run.totals, comparison, deps.out);
    return 0;
  } catch (err) {
    if (err instanceof CalibrationError) {
      deps.out(err.message);
      return 1;
    }
    throw err;
  }
}

/**
 * Run the calibration set against a framework version (t-37).
 *
 * Two modes, as the set's `meta.how_to_use` asks:
 *
 * - **quick**: every case through the quick scan and `assemble` with no judge
 *   outputs. Free and deterministic: the same version gives the same totals.
 * - **ai**: every case through the version's full judge profile
 *   (`runJudges`, `ephemeral`), then `assemble` with the replies. No
 *   Assessment row is written. Each judge call is costed to `AiCostLog` like
 *   any other, tagged `calibrationRunId`, and refused when the install org's
 *   budget is spent, so it runs inside the install org's tenant context. A
 *   judge that fails falls back to the quick scan for its part, as in an
 *   assessment, and is counted in `totals.judgeFailures`: such a run is kept,
 *   but does not let a draft publish (`gate.ts`).
 *
 * Cases run with the culture switch on, whatever the deployment's switch:
 * the set has culture expectations, and `caseContext` passes the case's
 * culture through. Each case's context goes through the engine's own
 * `parseContext`.
 *
 * {@link scoreSet} is the run itself, given an engine; {@link runCalibration}
 * is the service around it: the version and set checked against each other,
 * the run stored in the system scope, and the comparison with the last run of
 * the same mode.
 */
import { compareRuns, type RunComparison, type ScoredRow } from '@/lib/app/calibration/compare';
import {
  caseContext,
  danglingReferences,
  type CalibrationCase,
  type CalibrationSet,
} from '@/lib/app/calibration/schema';
import { scoreCase, tally, type Check, type Totals } from '@/lib/app/calibration/score';
import type { CalibrationStore, StoredRun } from '@/lib/app/calibration/store';
import {
  createHowDoesThisLandEngine,
  type Assessment,
  type HowDoesThisLandEngine,
  type JudgeOutputs,
} from '@/lib/app/frameworks/howdoesthisland/engine';
import { indexModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import type { StoredVersion } from '@/lib/app/frameworks/repo';
import type { JsonObject } from '@/lib/app/frameworks/types';
import type { runJudges as RunJudges } from '@/lib/app/assessments/fan-out';

export type CalibrationMode = 'quick' | 'ai';

export class CalibrationError extends Error {
  constructor(
    readonly code: 'SET_MISMATCH' | 'DANGLING_REFERENCES' | 'INVALID_CONTEXT',
    message: string,
    readonly problems: readonly string[] = []
  ) {
    super(problems.length ? `${message}\n  ${problems.join('\n  ')}` : message);
    this.name = 'CalibrationError';
  }
}

/** One case's scored expectations, and the judges that failed on it. */
export interface CaseRow extends ScoredRow {
  checks: Check[];
  judgeFailures: { slot: string; code: string }[];
}

export interface ScoredSet {
  rows: CaseRow[];
  totals: Totals;
  /** `provider/model` each slot answered with, by slot. Empty in quick mode. */
  judgeModels: Record<string, string[]>;
  costUsd: number;
}

export interface ScoreSetInput {
  engine: HowDoesThisLandEngine;
  cases: readonly CalibrationCase[];
  mode: CalibrationMode;
  /** `<framework slug>@<version>`, for the cost rows. */
  frameworkVersion: string;
  /** Tags each judge call's cost rows. Required in ai mode. */
  runId: string;
  startedByUserId?: string | null;
  /** The judges' fan-out. Required in ai mode; tests stub it. */
  runJudges?: typeof RunJudges;
}

/** Runs every case of the set and scores it. Throws {@link CalibrationError} on a context the engine refuses. */
export async function scoreSet(input: ScoreSetInput): Promise<ScoredSet> {
  const { engine, mode } = input;
  const slots = mode === 'ai' ? engine.activeJudgeSlots('full') : [];
  if (mode === 'ai' && !input.runJudges) throw new Error('ai mode needs runJudges');

  const rows: CaseRow[] = [];
  const models = new Map<string, Set<string>>();
  let costUsd = 0;
  let failures = 0;

  // One case at a time: each case already runs its judges in parallel
  // (JUDGES_IN_FLIGHT), and the agents' rate limits are per minute.
  for (const c of input.cases) {
    const parsed = engine.parseContext(caseContext(c));
    if (!parsed.ok) {
      throw new CalibrationError(
        'INVALID_CONTEXT',
        `Case ${c.id}'s context is not one this version accepts.`,
        parsed.issues.map((i) => `${c.id}.context.${i.path}: ${i.message}`)
      );
    }
    const ctx = parsed.ctx;
    const quick = engine.quickScan(c.text, ctx);
    const outputs: Record<string, unknown> = {};
    const judgeFailures: CaseRow['judgeFailures'] = [];

    if (mode === 'ai' && input.runJudges) {
      const { landed } = await input.runJudges({
        engine,
        frameworkVersion: input.frameworkVersion,
        text: c.text,
        ctx,
        slots,
        ephemeral: true,
        costTags: { calibrationRunId: input.runId },
        userId: input.startedByUserId ?? null,
      });
      for (const j of landed) {
        if (j.ok) {
          outputs[j.slot] = j.reply.output;
          costUsd += j.reply.costUsd;
          const used = models.get(j.slot) ?? new Set<string>();
          used.add(`${j.reply.provider}/${j.reply.model}`);
          models.set(j.slot, used);
        } else {
          judgeFailures.push({ slot: j.slot, code: j.code });
          costUsd += j.spend?.costUsd ?? 0;
        }
      }
      // A judge the fan-out never started (it was stopped) is a failure too.
      for (const slot of slots) {
        if (!landed.some((j) => j.slot === slot)) judgeFailures.push({ slot, code: 'not_run' });
      }
      failures += judgeFailures.length;
    }

    // The replies were checked by the engine's own validator in runJudge.
    const result: Assessment = engine.assemble(c.text, ctx, quick, outputs as JudgeOutputs);
    rows.push({ case: c.id, checks: scoreCase(c, result), judgeFailures });
  }

  return {
    rows,
    totals: tally(rows, failures),
    judgeModels: Object.fromEntries([...models].map(([slot, used]) => [slot, [...used].sort()])),
    costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
  };
}

export interface RunCalibrationInput {
  version: StoredVersion;
  /** The version's materialised model. */
  model: JsonObject;
  set: CalibrationSet;
  mode: CalibrationMode;
  startedByUserId?: string | null;
}

export interface RunCalibrationDeps {
  store: CalibrationStore;
  runJudges: typeof RunJudges;
  /** Enters the install org's tenant context, for the judge calls and their budget. */
  runAsInstallOrg: <T>(fn: () => Promise<T>) => Promise<T>;
}

export interface CalibrationOutcome {
  run: StoredRun;
  /** Null for the first run of its mode. */
  comparison: RunComparison | null;
}

/**
 * Checks the set against the version, runs it, stores the run and compares
 * it with the last run of the same mode. Nothing is spent or stored when the
 * set does not fit the version.
 */
export async function runCalibration(
  input: RunCalibrationInput,
  deps: RunCalibrationDeps
): Promise<CalibrationOutcome> {
  const { version, set, mode } = input;
  if (set.meta.model !== version.version) {
    throw new CalibrationError(
      'SET_MISMATCH',
      `The calibration set is written for model ${set.meta.model}, not ${version.version}.`
    );
  }
  const dangling = danglingReferences(set, indexModel(input.model));
  if (dangling.length > 0) {
    throw new CalibrationError(
      'DANGLING_REFERENCES',
      `The calibration set names ${dangling.length} id(s) version ${version.version} does not have.`,
      dangling
    );
  }

  const engine = createHowDoesThisLandEngine(input.model, { culture: true });
  // Web Crypto, so this module runs in any realm (lib/app/** may not import node:crypto).
  const runId = globalThis.crypto.randomUUID();
  const frameworkVersion = `${version.frameworkSlug}@${version.version}`;
  const scored = await deps.runAsInstallOrg(() =>
    scoreSet({
      engine,
      cases: set.cases,
      mode,
      frameworkVersion,
      runId,
      runJudges: deps.runJudges,
      ...(input.startedByUserId !== undefined ? { startedByUserId: input.startedByUserId } : {}),
    })
  );

  const previous = await deps.store.latestRun({ frameworkSlug: version.frameworkSlug, mode });
  const run = await deps.store.createRun({
    id: runId,
    frameworkVersionId: version.id,
    sourceSha256: version.sourceSha256,
    setVersion: set.meta.version,
    mode,
    judgeModels: scored.judgeModels,
    totals: scored.totals,
    rows: scored.rows,
    costUsd: scored.costUsd,
    startedByUserId: input.startedByUserId ?? null,
  });
  return { run, comparison: previous ? compareRuns(previous, scored) : null };
}

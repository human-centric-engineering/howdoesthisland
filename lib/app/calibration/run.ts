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
import { HEARTBEAT_MS, type CalibrationStore, type StoredRun } from '@/lib/app/calibration/store';
import {
  createHowDoesThisLandEngine,
  type Assessment,
  type HowDoesThisLandEngine,
  type JudgeOutputs,
} from '@/lib/app/frameworks/howdoesthisland/engine';
import { decompose } from '@/lib/app/frameworks/codec';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import { indexModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import type { StoredVersion } from '@/lib/app/frameworks/repo';
import type { JsonObject } from '@/lib/app/frameworks/types';
import { logger } from '@/lib/logging';
import type { runJudges as RunJudges } from '@/lib/app/assessments/fan-out';

export type CalibrationMode = 'quick' | 'ai';

/** Dollars to the millionth, as every cost here is stored. */
const roundUsd = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000;

export class CalibrationError extends Error {
  constructor(
    readonly code:
      | 'RETIRED'
      | 'INVALID_MODEL'
      | 'SET_MISMATCH'
      | 'DANGLING_REFERENCES'
      | 'INVALID_CONTEXT'
      | 'NO_JUDGES',
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
  /** Told each judge call's cost as it lands, so a run that fails part-way knows what it spent. */
  onCost?: (usd: number) => void;
  /** What {@link prepare} gave for these cases and mode, when the caller already checked them. */
  prepared?: Prepared;
}

type CaseContext = Extract<ReturnType<HowDoesThisLandEngine['parseContext']>, { ok: true }>['ctx'];

/**
 * What a run of `cases` in `mode` needs from the engine, checked before
 * anything is spent: the judge slots it runs, and every case's context as the
 * engine parses it. Throws {@link CalibrationError}: `NO_JUDGES` for an AI run
 * with none (it would be the quick scan under another name, and would still
 * let a draft publish), `INVALID_CONTEXT` for a case the version refuses.
 */
interface Prepared {
  slots: readonly string[];
  contexts: CaseContext[];
}

function prepare(
  engine: HowDoesThisLandEngine,
  cases: readonly CalibrationCase[],
  mode: CalibrationMode
): Prepared {
  const slots = mode === 'ai' ? engine.activeJudgeSlots('full') : [];
  if (mode === 'ai' && slots.length === 0) {
    throw new CalibrationError(
      'NO_JUDGES',
      'This version has no judges to run, so ai mode cannot.'
    );
  }
  const contexts = cases.map((c) => {
    const parsed = engine.parseContext(caseContext(c));
    if (!parsed.ok) {
      throw new CalibrationError(
        'INVALID_CONTEXT',
        `Case ${c.id}'s context is not one this version accepts.`,
        parsed.issues.map((i) => `${c.id}.context.${i.path}: ${i.message}`)
      );
    }
    return parsed.ctx;
  });
  return { slots, contexts };
}

/**
 * Runs every case of the set and scores it. Throws {@link CalibrationError},
 * before any judge is called, on a set the version cannot run.
 */
export async function scoreSet(input: ScoreSetInput): Promise<ScoredSet> {
  const { engine, mode } = input;
  if (mode === 'ai' && !input.runJudges) throw new Error('ai mode needs runJudges');
  const { slots, contexts } = input.prepared ?? prepare(engine, input.cases, mode);

  const rows: CaseRow[] = [];
  const models = new Map<string, Set<string>>();
  let costUsd = 0;
  let failures = 0;

  // One case at a time: each case already runs its judges in parallel
  // (JUDGES_IN_FLIGHT), and the agents' rate limits are per minute.
  for (const [i, c] of input.cases.entries()) {
    const ctx = contexts[i];
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
          input.onCost?.(j.reply.costUsd);
          const used = models.get(j.slot) ?? new Set<string>();
          used.add(`${j.reply.provider}/${j.reply.model}`);
          models.set(j.slot, used);
        } else {
          judgeFailures.push({ slot: j.slot, code: j.code });
          costUsd += j.spend?.costUsd ?? 0;
          input.onCost?.(j.spend?.costUsd ?? 0);
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

export interface StartedCalibration {
  /** The run's id, stored as `RUNNING` before this returns. */
  runId: string;
  /**
   * Settles when the run has finished and is stored `COMPLETE`, or rejects
   * once it is stored `FAILED`. It has already started.
   */
  done: Promise<CalibrationOutcome>;
}

/**
 * Checks the set against the version, stores the run as `RUNNING` and starts
 * it (t-38: the admin page returns once it has started). Nothing is spent or
 * stored when the set does not fit the version: that throws here, before
 * anything is written.
 */
export async function startCalibration(
  input: RunCalibrationInput,
  deps: RunCalibrationDeps
): Promise<StartedCalibration> {
  const { version, set, mode } = input;
  // A retired version can never publish or be used again: a run of it would
  // only spend. Refused here, so the CLI and the page both refuse it.
  if (version.status === 'RETIRED') {
    throw new CalibrationError('RETIRED', `${version.version} is retired, so it is not run.`);
  }
  // The definition's checks again, as on import: a draft imported before a
  // check it now fails (bands that leave a score with none, say) is refused
  // before it spends, and so never publishes, since the publish gate needs a
  // complete run of it. The engine's own read stays lenient for what is stored.
  const invalid = decompose(howDoesThisLand, input.model).problems;
  if (invalid.length > 0) {
    throw new CalibrationError(
      'INVALID_MODEL',
      `${version.version} fails ${invalid.length} of its framework's checks; fix the file and re-import it.`,
      invalid
    );
  }
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
  // Checked before the run is stored, so a set the version cannot run leaves
  // no row and spends nothing.
  const prepared = prepare(engine, set.cases, mode);
  // Web Crypto, so this module runs in any realm (lib/app/** may not import node:crypto).
  const runId = globalThis.crypto.randomUUID();
  const frameworkVersion = `${version.frameworkSlug}@${version.version}`;
  const startedByUserId = input.startedByUserId ?? null;
  const { createdAt } = await deps.store.startRun({
    id: runId,
    frameworkVersionId: version.id,
    sourceSha256: version.sourceSha256,
    setVersion: set.meta.version,
    mode,
    startedByUserId,
  });

  // Beats while this process is running the run, so a run whose process went
  // away is seen to have stopped (store.ts). A missed beat is not a failed run.
  const beat = setInterval(() => {
    deps.store.touchRun(runId, roundUsd(spent)).catch((err: unknown) => {
      logger.warn('calibration: heartbeat failed', { runId, error: String(err) });
    });
  }, HEARTBEAT_MS);

  let spent = 0;
  const work = async (): Promise<CalibrationOutcome> => {
    const scored = await deps.runAsInstallOrg(() =>
      scoreSet({
        engine,
        cases: set.cases,
        mode,
        frameworkVersion,
        runId,
        runJudges: deps.runJudges,
        startedByUserId,
        onCost: (usd) => (spent += usd),
        prepared,
      })
    );
    // The complete run stored before this one started, as the admin page
    // pairs them: a run started after this one is not the run before it.
    const previous = await deps.store.latestRun({
      frameworkSlug: version.frameworkSlug,
      mode,
      before: createdAt,
    });
    const run = await deps.store.finishRun(runId, {
      judgeModels: scored.judgeModels,
      totals: scored.totals,
      rows: scored.rows,
      costUsd: scored.costUsd,
    });
    return { run, comparison: previous ? compareRuns(previous, scored) : null };
  };

  const done = work()
    .catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      try {
        // What its judges cost before it failed, as their AiCostLog rows say.
        await deps.store.failRun(runId, message, roundUsd(spent));
      } catch (failErr) {
        // The run's own error is the one to surface; the row stops beating
        // and is shown as stopped.
        logger.error('calibration: could not record a failed run', failErr, { runId });
      }
      throw err;
    })
    .finally(() => clearInterval(beat));
  return { runId, done };
}

/**
 * {@link startCalibration}, waited for: the CLI's way. Throws
 * {@link CalibrationError} before anything is stored when the set does not
 * fit the version.
 */
export async function runCalibration(
  input: RunCalibrationInput,
  deps: RunCalibrationDeps
): Promise<CalibrationOutcome> {
  return (await startCalibration(input, deps)).done;
}

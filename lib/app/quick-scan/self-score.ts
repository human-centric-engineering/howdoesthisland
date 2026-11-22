/**
 * The landing page's self-score (t-62): "We ran this page through
 * HowDoesThisLand", the page's own copy put through the quick scan as the
 * page renders.
 *
 * Only with the quick-scan switch on (`./switch.ts`). Off, it returns
 * `null` without touching the engine, so the page shows no quick-scan output
 * and makes no call. It runs the same service `POST /api/v1/scan` answers
 * from (`runQuickScan`), in process: no request, no code, no rate limit, as
 * the text is the page's own and not a visitor's.
 *
 * Scored once per published framework version, not per page view. The scan
 * is deterministic, so the same copy, context and version always score the
 * same, and the engine runs again only when the version, or the copy,
 * changes. Which version is the latest is looked up at most once a
 * {@link LOOKUP_TTL_MS}, however many views arrive, so an anonymous flood of
 * `/` is neither a path to the engine work `POST /api/v1/scan` rate-limits
 * nor an unthrottled database read.
 *
 * A view waits on a stage only when nothing has been kept from it yet. Once a
 * version has been found and a score kept, a refresh of the lookup, or a scan
 * for a newly published version, runs behind the view, which answers with the
 * last good score meanwhile; so a slow database holds `/` only on a process's
 * first view. The kept score names the version that scored it.
 *
 * A failure is logged and answered `null` (the page then shows what it shows
 * with the switch off), so the landing page never fails because the
 * framework has no published version or the scan refused its own copy.
 * Once a score has been kept, a failing stage answers with it instead, so a
 * short database blip does not hide it; but a lookup that finds no published
 * version drops it, so a retired version's score does not stay up. Either stage is retried at most once
 * a {@link RETRY_FAILED_MS}; each distinct failure is logged once, and again
 * only after that stage has recovered. A stage that has not answered in
 * {@link TIMEOUT_MS} counts as failed, so a stalled run cannot hold every
 * later view of `/`, though what it finds if it lands later is still kept;
 * and no new run starts beside one still going until
 * {@link ABANDON_AFTER_MS}, so a hung database does not collect a stalled
 * query a minute.
 */
import { z } from 'zod';
import { logger } from '@/lib/logging';
import { runQuickScan } from '@/lib/app/assessments/api/scan';
import { DEFAULT_FRAMEWORK } from '@/lib/app/assessments/api/version';
import { prismaFrameworkCatalog } from '@/lib/app/frameworks/api/catalog';
import { isQuickScanEnabled } from '@/lib/app/quick-scan/switch';

/** How long a failed stage is answered from what is kept before it is tried again. */
export const RETRY_FAILED_MS = 60_000;
/** How long the latest published version, once found, is trusted. */
export const LOOKUP_TTL_MS = 30_000;
/** How long a page view waits for a stage before answering without it. */
export const TIMEOUT_MS = 10_000;
/** How long a run that never settled holds off a new one. */
export const ABANDON_AFTER_MS = 5 * 60_000;

const APPEALS = ['ethos', 'pathos', 'logos', 'kairos'] as const;
export type SelfScoreAppeal = (typeof APPEALS)[number];

/** The parts of the result the panel shows. The engine's output is not trusted to have them. */
const scoresSchema = z.object({
  scores: z.object({
    overall: z.number(),
    band: z.string(),
    ethos: z.number(),
    pathos: z.number(),
    logos: z.number(),
    kairos: z.number(),
  }),
});

export interface SelfScore {
  overall: number;
  band: string;
  /** In the model's order: ethos, pathos, logos, kairos. */
  appeals: { id: SelfScoreAppeal; score: number }[];
  /** The lowest-scoring appeal; the first of them on a tie. */
  weakest: SelfScoreAppeal;
  /** The framework version that scored it, as `howdoesthisland@0.5.1`. */
  scoredWith: string;
}

type Stage = 'lookup' | 'scan';
/** The last failure logged per stage, so a lasting one is logged once. */
const lastLogged: Record<Stage, string | null> = { lookup: null, scan: null };

function failed(stage: Stage, message: string, meta: Record<string, unknown>): null {
  const seen = JSON.stringify([message, meta]);
  if (seen !== lastLogged[stage]) {
    lastLogged[stage] = seen;
    logger.warn(message, meta);
  }
  return null;
}

/**
 * One run of a stage, kept so later views share it: its answer (`null` on a
 * failure or a timeout), when it started, whether that answer is in, and
 * whether the run itself has settled, which a timed-out answer does not mean.
 */
interface Kept<T> {
  key: string;
  startedAt: number;
  running: boolean;
  answered: boolean;
  failed: boolean;
  answer: Promise<T | null>;
}

/**
 * Start a run of `work`, which answers `null` on failure and never throws.
 * `found` gets the run's value whenever it lands, even after the view's
 * answer has timed out, so a slow success is kept rather than thrown away.
 */
function start<T>(
  stage: Stage,
  key: string,
  work: () => Promise<T | null>,
  found: (value: T, run: Kept<T>) => void
): Kept<T> {
  const run = work();
  const kept: Kept<T> = {
    key,
    startedAt: Date.now(),
    running: true,
    answered: false,
    failed: false,
    answer: withTimeout(stage, run),
  };
  void run.finally(() => {
    kept.running = false;
  });
  void run.then((value) => {
    if (value === null) return;
    kept.failed = false;
    lastLogged[stage] = null;
    found(value, kept);
  });
  void kept.answer.then((value) => {
    kept.answered = true;
    if (value === null) kept.failed = true;
  });
  return kept;
}

/** Whether a kept run still answers for `key`, or a new one should start. */
function stillAnswers<T>(kept: Kept<T> | null, key: string, freshForMs: number): kept is Kept<T> {
  if (kept?.key !== key) return false;
  const age = Date.now() - kept.startedAt;
  // Never a second run beside one still going, unless it looks abandoned.
  if (kept.running) return age < ABANDON_AFTER_MS;
  return age < (kept.failed ? RETRY_FAILED_MS : freshForMs);
}

interface LatestVersion {
  id: string;
  version: string;
  sourceSha256: string;
}

let lookup: Kept<LatestVersion> | null = null;
/** The last version a lookup found, used while a refresh runs or fails. */
let lastVersion: LatestVersion | null = null;
/** The last score, keyed on the version, copy and context it was scored with. */
let scan: Kept<SelfScore> | null = null;
/** The last score that succeeded, shown while a stage is running or failing. */
let lastGood: SelfScore | null = null;

export async function selfScore(
  text: string,
  context: Record<string, unknown>
): Promise<SelfScore | null> {
  if (!isQuickScanEnabled()) return null;

  if (!stillAnswers(lookup, 'latest', LOOKUP_TTL_MS)) {
    lookup = start('lookup', 'latest', findLatestVersion, (found, run) => {
      // An abandoned run that lands late never overwrites a newer one.
      if (run === lookup) lastVersion = found;
    });
  }
  // Wait only for a first lookup; a refresh runs behind the view.
  const version = lastVersion ?? (await lookup.answer);
  if (!version) return null;

  // The page's copy is a few KB, so the key is the inputs themselves.
  const key = JSON.stringify([version.id, version.sourceSha256, text, context]);
  if (!stillAnswers(scan, key, Infinity)) {
    scan = start(
      'scan',
      key,
      () => scoreWith(text, context, version.version),
      (score, run) => {
        // An older version's scan that lands late never replaces a newer score.
        if (run === scan) lastGood = score;
      }
    );
  }
  // Wait only when there is no score to show; a new run finishes behind the view.
  if (lastGood && !scan.answered) return lastGood;
  return (await scan.answer) ?? lastGood;
}

/**
 * Settles once the runs in flight have answered. A serverless host freezes
 * an instance once its response is sent, so the page hands this to `after()`
 * to keep a run started behind a view going until it lands.
 */
export async function selfScoreSettled(): Promise<void> {
  await Promise.all([lookup?.answer, scan?.answer]);
}

/**
 * Drop the kept version and score. Only for a lookup that answered that there
 * is nothing to score: unlike a thrown or timed-out lookup, that is a lasting
 * state, so a retired version's score must not stay on the page.
 */
function forgetKept(): void {
  lastVersion = null;
  lastGood = null;
}

async function findLatestVersion(): Promise<LatestVersion | null> {
  try {
    const framework = await prismaFrameworkCatalog.findFramework(DEFAULT_FRAMEWORK);
    if (!framework) {
      forgetKept();
      return failed('lookup', 'Self-score could not run', {
        error: `${DEFAULT_FRAMEWORK} is not in the framework catalog.`,
      });
    }
    // Newest first, so the first published is the latest.
    const version = framework.versions.find((v) => v.status === 'PUBLISHED');
    if (version) return version;
    forgetKept();
    return failed('lookup', 'Self-score could not run', {
      error: `${DEFAULT_FRAMEWORK} has no published version.`,
    });
  } catch (err) {
    return failed('lookup', 'Self-score could not run', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** The run, or `null` once {@link TIMEOUT_MS} has passed without it. */
function withTimeout<T>(stage: Stage, run: Promise<T | null>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(
      () => resolve(failed(stage, `Self-score ${stage} timed out`, { afterMs: TIMEOUT_MS })),
      TIMEOUT_MS
    );
  });
  return Promise.race([run, timedOut]).finally(() => clearTimeout(timer));
}

/** One run of the quick scan, pinned to the version the memo is keyed on. */
async function scoreWith(
  text: string,
  context: Record<string, unknown>,
  version: string
): Promise<SelfScore | null> {
  try {
    const view = await runQuickScan({ text, context, version });
    const parsed = scoresSchema.safeParse(view.result);
    if (!parsed.success) {
      return failed('scan', 'Self-score result has no appeal scores', {
        issues: parsed.error.issues,
      });
    }
    const { scores } = parsed.data;
    const appeals = APPEALS.map((id) => ({ id, score: scores[id] }));
    const weakest = appeals.reduce((low, a) => (a.score < low.score ? a : low)).id;
    return {
      overall: scores.overall,
      band: scores.band,
      appeals,
      weakest,
      scoredWith: `${view.framework.slug}@${view.framework.version}`,
    };
  } catch (err) {
    return failed('scan', 'Self-score could not run', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

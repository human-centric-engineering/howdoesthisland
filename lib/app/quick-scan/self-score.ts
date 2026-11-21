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
 * same. Each view costs one framework lookup to find the latest published
 * version, and the engine runs again only when that version, or the copy,
 * changes. An anonymous flood of `/` cannot become an unthrottled path to the
 * engine work that `POST /api/v1/scan` rate-limits.
 *
 * A failure is logged and answered `null` (the page then shows what it shows
 * with the switch off), so the landing page never fails because the
 * framework has no published version or the scan refused its own copy. A
 * failure, of the version lookup or of the scan, is retried at most once a
 * {@link RETRY_FAILED_MS}, so a transient error recovers and a degraded
 * database is not asked again on every view; each distinct failure is
 * logged once, and again only after that stage has recovered. A scan that
 * has not answered in {@link SCORE_TIMEOUT_MS} counts as failed, so one
 * stalled run cannot hold every later view of `/`.
 */
import { z } from 'zod';
import { logger } from '@/lib/logging';
import { runQuickScan } from '@/lib/app/assessments/api/scan';
import { DEFAULT_FRAMEWORK } from '@/lib/app/assessments/api/version';
import { prismaFrameworkCatalog } from '@/lib/app/frameworks/api/catalog';
import { isQuickScanEnabled } from '@/lib/app/quick-scan/switch';

/** How long a failed self-score is answered `null` before it is tried again. */
export const RETRY_FAILED_MS = 60_000;
/** How long a page view waits for a scan before answering `null`. */
export const SCORE_TIMEOUT_MS = 10_000;

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

/**
 * The last score, keyed on the version, copy and context it was scored
 * with. One slot: the page scores one copy, and a new version replaces it.
 */
let memo: { key: string; score: Promise<SelfScore | null>; failedAt: number | null } | null = null;
/** When the version lookup last failed or found no published version. */
let lookupFailedAt: number | null = null;

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

function withinRetryWindow(failedAt: number | null): boolean {
  return failedAt !== null && Date.now() - failedAt < RETRY_FAILED_MS;
}

export async function selfScore(
  text: string,
  context: Record<string, unknown>
): Promise<SelfScore | null> {
  if (!isQuickScanEnabled()) return null;
  if (withinRetryWindow(lookupFailedAt)) return null;
  let version;
  try {
    const framework = await prismaFrameworkCatalog.findFramework(DEFAULT_FRAMEWORK);
    // Newest first, so the first published is the latest.
    version = framework?.versions.find((v) => v.status === 'PUBLISHED');
  } catch (err) {
    lookupFailedAt = Date.now();
    return failed('lookup', 'Self-score could not run', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (!version) {
    lookupFailedAt = Date.now();
    return failed('lookup', 'Self-score could not run', {
      error: `${DEFAULT_FRAMEWORK} has no published version.`,
    });
  }
  lookupFailedAt = null;
  lastLogged.lookup = null;

  // The page's copy is a few KB, so the key is the inputs themselves.
  const key = JSON.stringify([version.id, version.sourceSha256, text, context]);
  const current = memo;
  if (current?.key === key && (current.failedAt === null || withinRetryWindow(current.failedAt))) {
    return current.score;
  }
  const entry: NonNullable<typeof memo> = {
    key,
    failedAt: null,
    score: withTimeout(scoreWith(text, context, version.version)),
  };
  memo = entry;
  void entry.score.then((score) => {
    if (score === null) entry.failedAt = Date.now();
    else lastLogged.scan = null;
  });
  return entry.score;
}

/** The run, or `null` once {@link SCORE_TIMEOUT_MS} has passed without it. */
function withTimeout(run: Promise<SelfScore | null>): Promise<SelfScore | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(
      () => resolve(failed('scan', 'Self-score timed out', { afterMs: SCORE_TIMEOUT_MS })),
      SCORE_TIMEOUT_MS
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

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
 * A failure is logged and answered `null` (the page then shows what it shows
 * with the switch off), so the landing page never fails because the
 * framework has no published version or the scan refused its own copy.
 */
import { z } from 'zod';
import { logger } from '@/lib/logging';
import { runQuickScan } from '@/lib/app/assessments/api/scan';
import { isQuickScanEnabled } from '@/lib/app/quick-scan/switch';

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

export async function selfScore(
  text: string,
  context: Record<string, unknown>
): Promise<SelfScore | null> {
  if (!isQuickScanEnabled()) return null;
  try {
    const view = await runQuickScan({ text, context });
    const parsed = scoresSchema.safeParse(view.result);
    if (!parsed.success) {
      logger.warn('Self-score result has no appeal scores', { issues: parsed.error.issues });
      return null;
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
    logger.warn('Self-score could not run', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * A stored review's quick scan, before its judges land (t-77).
 *
 * The run works the quick scan out first and folds it into the final result
 * (`run.ts`), so until then a review that calls judges had nothing to show.
 * The quick scan calls no model and reads only the review's stored text,
 * context, weight adjustment and pinned framework version, all of which are
 * fixed once the review is stored. So it is worked out again here when a
 * running review is read, rather than stored a second time: the same inputs
 * give the run's own answer. With no judge outputs, `assemble()` is the
 * quick-scan result (`lib/app/frameworks/engine.ts`), as `POST /api/v1/scan`
 * answers it.
 *
 * Never throws. Text the engine cannot score, an overlay that no longer fits,
 * or a version no code runs reads as `null`: the run finishes that review
 * `failed` itself, saying why, and nothing early is worth showing.
 */
import { engineForVersion } from '@/lib/app/assessments/engine';
import { scoresOf } from '@/lib/app/assessments/run';
import { logger } from '@/lib/logging';

/** What a review's quick scan says, before its judges. */
export interface EarlyQuickScan {
  overall: number | null;
  band: string | null;
  /** The framework's quick-scan result, in the shape of a final result with no judges. */
  result: unknown;
}

/** The stored inputs a quick scan reads. */
export interface EarlyScanInputs {
  id: string;
  frameworkVersionId: string;
  context: unknown;
  overlay: unknown;
  text: string;
  sourceUrl: string | null;
}

export async function earlyQuickScan(review: EarlyScanInputs): Promise<EarlyQuickScan | null> {
  try {
    const loaded = await engineForVersion(review.frameworkVersionId);
    if (!loaded) return null;
    const adjusted = loaded.engine.parseOverlay(review.overlay);
    if (!adjusted.ok) return null;
    const engine = adjusted.overlay ? loaded.engine.withOverlay(adjusted.overlay) : loaded.engine;
    const quick = engine.quickScan(review.text, review.context);
    const result = engine.assemble(review.text, review.context, quick, {}, review.sourceUrl);
    return { ...scoresOf(result), result };
  } catch (err) {
    logger.warn('Could not work out a running review’s quick scan', {
      assessmentId: review.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

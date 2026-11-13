/**
 * The HowDoesThisLand engine (t-13): the prototype's `engine.js` as typed
 * modules behind `FrameworkEngine` (app-plan §3, §8.2).
 *
 * | Prototype                                    | Here             |
 * | -------------------------------------------- | ---------------- |
 * | text utilities, `locate`                     | `text.ts`        |
 * | `craft()`                                    | `craft.ts`       |
 * | `createEngine`'s lookup maps                 | `model.ts`       |
 * | `cultureProfile`, `culturePositions`, cues   | `culture.ts`     |
 * | `quickScan`, `extraScan`                     | `quick-scan.ts`  |
 * | weights, duties, appeal scores, balance      | `scoring.ts`     |
 * | `assemble`, `libraryRecs`, `dedupeFlags`     | `assemble.ts`    |
 *
 * Not here: the judge prompts and output validation (f-judges), the rewrite
 * prompt (f-rewrite), `calibrate` (f-calibration) and `toApi` (f-assessments).
 *
 * Differences from the prototype, each listed against the baseline
 * (`tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-differences.ts`):
 * `locate()` offsets after a character whose lower case is longer (BRIEF §5),
 * and the red-flag penalty's stray `undefined` score. `primaryDuty` replaces
 * the prototype's `=== 40` (BRIEF §5) for f-rewrite to use.
 */
import type { FrameworkEngine } from '@/lib/app/frameworks/engine';
import { assemble } from '@/lib/app/frameworks/howdoesthisland/engine/assemble';
import { indexModel, type EngineModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import {
  quickScan,
  type EngineOptions,
} from '@/lib/app/frameworks/howdoesthisland/engine/quick-scan';
import { primaryDuty } from '@/lib/app/frameworks/howdoesthisland/engine/scoring';
import type {
  Assessment,
  EngineContext,
  JudgeOutputs,
  QuickScan,
} from '@/lib/app/frameworks/howdoesthisland/engine/types';

export type { EngineOptions } from '@/lib/app/frameworks/howdoesthisland/engine/quick-scan';
export type * from '@/lib/app/frameworks/howdoesthisland/engine/types';

export interface HowDoesThisLandEngine extends FrameworkEngine<
  EngineContext,
  QuickScan,
  JudgeOutputs,
  Assessment
> {
  /** Whether this engine was built with the culture switch on. */
  readonly culture: boolean;
  /** The duty this reader most needs the text to do (BRIEF §5 fix), or null. */
  primaryDuty(ctx: EngineContext): string | null;
}

/**
 * An engine over a materialised model. Throws (a `ZodError` naming the field)
 * when the model lacks something the engine reads. The model is never written.
 */
export function createHowDoesThisLandEngine(
  model: object,
  opts: EngineOptions
): HowDoesThisLandEngine {
  const m: EngineModel = indexModel(model);
  const options: EngineOptions = { culture: opts.culture };
  return {
    culture: options.culture,
    quickScan: (text, ctx) => quickScan(m, text, ctx, options),
    assemble: (text, ctx, quick, outputs = {}, source = null) =>
      assemble(m, text, ctx, quick, outputs, source, options),
    primaryDuty: (ctx) => primaryDuty(m, ctx),
  };
}

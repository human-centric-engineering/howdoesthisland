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
 * | `audienceText`, `contentBlock`, `judgePrompt`  | `prompts.ts`     |
 * | `validJudgeOutput`, as post-validation       | `validate-reply.ts` |
 *
 * New here (t-18): each judge's strict reply schema (`judge-schemas.ts`), and
 * which judges a profile runs and the call each makes (`judges.ts`). And
 * (t-25) the editor's summary request and its validation (`editor.ts`).
 *
 * Not here: the rewrite prompt (f-rewrite), `calibrate` (f-calibration) and
 * `toApi` (f-assessments).
 *
 * Differences from the prototype, each listed against the baseline
 * (`tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-differences.ts`):
 * `locate()` offsets after a character whose lower case is longer (BRIEF §5),
 * and the red-flag penalty's stray `undefined` score. `primaryDuty` replaces
 * the prototype's `=== 40` (BRIEF §5) for f-rewrite to use.
 */
import type { FrameworkEngine } from '@/lib/app/frameworks/engine';
import { assemble } from '@/lib/app/frameworks/howdoesthisland/engine/assemble';
import {
  buildEditorRequest,
  validateEditorReply,
} from '@/lib/app/frameworks/howdoesthisland/engine/editor';
import { outputSchema } from '@/lib/app/frameworks/howdoesthisland/engine/judge-schemas';
import {
  activeJudgeSlots,
  buildJudgeRequest,
} from '@/lib/app/frameworks/howdoesthisland/engine/judges';
import { indexModel, type EngineModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import {
  quickScan,
  type EngineOptions,
} from '@/lib/app/frameworks/howdoesthisland/engine/quick-scan';
import { primaryDuty } from '@/lib/app/frameworks/howdoesthisland/engine/scoring';
import type {
  Assessment,
  EngineContext,
  JudgeOutput,
  JudgeOutputs,
  QuickScan,
} from '@/lib/app/frameworks/howdoesthisland/engine/types';
import { validateJudgeReply } from '@/lib/app/frameworks/howdoesthisland/engine/validate-reply';
import { parseContext } from '@/lib/app/frameworks/howdoesthisland/engine/context';

export type { EngineOptions } from '@/lib/app/frameworks/howdoesthisland/engine/quick-scan';
export type * from '@/lib/app/frameworks/howdoesthisland/engine/types';
export type {
  JudgeDrop,
  JudgeDropReason,
  JudgeReplyValidation,
} from '@/lib/app/frameworks/howdoesthisland/engine/validate-reply';

export interface HowDoesThisLandEngine extends FrameworkEngine<
  EngineContext,
  QuickScan,
  JudgeOutputs,
  Assessment,
  JudgeOutput
> {
  /** Whether this engine was built with the culture switch on. */
  readonly culture: boolean;
  /** The duty this reader most needs the text to do (BRIEF §5 fix), or null. */
  primaryDuty(ctx: EngineContext): string | null;
}

/**
 * Judge outputs keyed the way `assemble()` reads them: by the judge's appeal
 * or group (`ethos`, `lenses`, `craft`, …).
 *
 * A run keys each reply by the slot it ran, the judge's id
 * (`judge_ethos`), which is what `activeJudgeSlots()` hands out and the
 * framework-generic run stores. `assemble()` is the prototype's and reads by
 * appeal, as the baseline fixtures do. Without this mapping every stored
 * review merged no reply and came back as the quick scan (t-33). A key that
 * is already an appeal passes through, so the baseline still compares; when a
 * slot and its appeal both arrive, the slot's reply wins whatever the order.
 * A key naming no judge is dropped, as `assemble()` would ignore it.
 */
function byAppeal(
  slotAppeal: ReadonlyMap<string, string>,
  appeals: ReadonlySet<string>,
  outputs: JudgeOutputs
): JudgeOutputs {
  const keyed: Record<string, JudgeOutput | undefined> = {};
  for (const [key, output] of Object.entries(outputs)) {
    if (output === undefined) continue;
    const slotFor = slotAppeal.get(key);
    if (slotFor !== undefined) keyed[slotFor] = output;
    else if (appeals.has(key) && keyed[key] === undefined) keyed[key] = output;
  }
  return keyed;
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
  const slotAppeal = new Map(m.data.judges.map((j) => [j.id, j.appeal]));
  const appeals = new Set(slotAppeal.values());
  return {
    culture: options.culture,
    parseContext: (input) => parseContext(m, input, options.culture),
    quickScan: (text, ctx) => quickScan(m, text, ctx, options),
    assemble: (text, ctx, quick, outputs = {}, source = null) =>
      assemble(m, text, ctx, quick, byAppeal(slotAppeal, appeals, outputs), source, options),
    primaryDuty: (ctx) => primaryDuty(m, ctx),
    activeJudgeSlots: (profile) => activeJudgeSlots(m, profile, options),
    buildJudgeRequest: (slot, text, ctx, projectContext = null) =>
      buildJudgeRequest(m, slot, text, ctx, { ...options, projectContext }),
    outputSchema: (slot) => outputSchema(m, slot),
    validateJudgeReply: (slot, reply, text) => validateJudgeReply(m, slot, reply, text),
    buildEditorRequest: (text, ctx, result, projectContext = null) =>
      buildEditorRequest(m, text, ctx, result, { ...options, projectContext }),
    validateEditorReply: (reply, result) => validateEditorReply(reply, result),
  };
}

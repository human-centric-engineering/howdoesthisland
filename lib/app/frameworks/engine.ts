/**
 * What a framework's engine is, in code (app-plan §8.2).
 *
 * A framework definition (`types.ts`) says what the framework's records are;
 * its engine is what scores a text against them. A caller goes from a slug to
 * a definition to an engine (`def.createEngine(model)`) without naming the
 * framework.
 *
 * **This interface grows with the features that implement it.** §8.2 lists
 * six methods; only the two that exist today are here. `activeJudgeSlots`,
 * `buildJudgeRequest` and `outputSchema` arrive with f-judges, and
 * `rewriteRequest` with f-rewrite, each together with its implementation, so
 * no method is ever a stub (B31).
 *
 * The slots themselves are not the engine's: they are the definition's static
 * `judges.slots` (`types.ts`), because each is a platform agent that exists
 * before any engine is made. `activeJudgeSlots` only chooses, for one run,
 * which of those run; it never names a slot that list does not have.
 *
 * The type parameters are the framework's own shapes. A caller that does not
 * know the framework holds a `FrameworkEngine` with the `unknown` defaults.
 */
export interface FrameworkEngine<
  Ctx = unknown,
  Quick = unknown,
  JudgeOutputs = unknown,
  Result = unknown,
> {
  /** The free, deterministic scan: no model call, the same answer every time. */
  quickScan(text: string, ctx: Ctx): Quick;
  /**
   * Combines a quick scan with whatever judge outputs arrived. With none it is
   * the quick-scan result, which is also what stands in when a judge fails.
   * `source` is where the text came from, returned as it is.
   */
  assemble(
    text: string,
    ctx: Ctx,
    quick: Quick,
    outputs?: JudgeOutputs,
    source?: string | null
  ): Result;
}

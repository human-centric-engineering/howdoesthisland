/**
 * What a framework's engine is, in code (app-plan §8.2).
 *
 * A framework definition (`types.ts`) says what the framework's records are;
 * its engine is what scores a text against them. A caller goes from a slug to
 * a definition to an engine (`def.createEngine(model)`) without naming the
 * framework.
 *
 * **This interface grows with the features that implement it.** §8.2 lists
 * six methods. The judge methods arrived with f-judges (t-18), and
 * `rewriteRequest` arrives with f-rewrite, together with its implementation,
 * so no method is ever a stub (B31). f-judges added one §8.2 did not list,
 * `validateJudgeReply`: the post-validation a reply needs is the framework's,
 * since only it knows the ids and scales.
 *
 * The slots themselves are not the engine's: they are the definition's static
 * `judges.slots` (`types.ts`), because each is a platform agent that exists
 * before any engine is made. `activeJudgeSlots` only chooses, for one run,
 * which of those run; it never names a slot that list does not have.
 *
 * The type parameters are the framework's own shapes. A caller that does not
 * know the framework holds a `FrameworkEngine` with the `unknown` defaults.
 */

/**
 * Which judges a run asks for (plan §4 "Profiles"): a profile name the
 * framework defines (`quick`, `full`, or one of its catalogue groups), or an
 * explicit list of slots.
 */
export type JudgeProfile = string | readonly string[];

/** A profile or slot list the framework cannot run: unknown, or switched off. */
export class JudgeProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeProfileError';
  }
}

/** One judge call, as the engine builds it; the runtime (t-19) makes it. */
export interface JudgeRequest {
  slot: string;
  /** The user message: what the judge is told, with the text at the end. */
  prompt: string;
  /** The reply's JSON Schema, in OpenAI's strict subset, and the name it is sent under. */
  schema: Record<string, unknown>;
  schemaName: string;
  /**
   * Interim hints for this slot's reply, under its agent's ceiling
   * (`lib/app/judges/agents.ts`), until k3 measures them.
   */
  maxTokens: number;
  timeoutMs: number;
}

/** One thing post-validation dropped or changed in a reply, by path. */
export interface JudgeDrop<Reason extends string = string> {
  at: string;
  reason: Reason;
  detail?: string;
}

/** A checked reply and what was dropped from it, or a refusal of the whole reply. */
export type JudgeReplyValidation<Output = unknown, Reason extends string = string> =
  | { ok: true; output: Output; drops: JudgeDrop<Reason>[] }
  | { ok: false; reason: 'malformed'; detail: string };

export interface FrameworkEngine<
  Ctx = unknown,
  Quick = unknown,
  JudgeOutputs = unknown,
  Result = unknown,
  JudgeOutput = unknown,
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
  /**
   * The slots a run with this profile asks for, in the version's order.
   * Throws {@link JudgeProfileError} for a profile or slot the framework does
   * not have or has switched off.
   */
  activeJudgeSlots(profile: JudgeProfile): readonly string[];
  /** One slot's call: its prompt, reply schema and limits. */
  buildJudgeRequest(
    slot: string,
    text: string,
    ctx: Ctx,
    projectContext?: string | null
  ): JudgeRequest;
  /** The JSON Schema a slot's reply is held to (also on its {@link JudgeRequest}). */
  outputSchema(slot: string): Record<string, unknown>;
  /** A slot's reply (parsed, untrusted) checked against the version and the judged text. */
  validateJudgeReply(slot: string, reply: unknown, text: string): JudgeReplyValidation<JudgeOutput>;
}

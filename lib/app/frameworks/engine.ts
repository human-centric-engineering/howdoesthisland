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
 * the rewrite pair (`rewriteFocuses`, `buildRewriteRequest`) with f-rewrite
 * (t-81), each together with its implementation, so no method is ever a
 * stub (B31). f-judges added one §8.2 did not list,
 * `validateJudgeReply`: the post-validation a reply needs is the framework's,
 * since only it knows the ids and scales. f-assessments added `parseContext`,
 * for the same reason: a context's ids are the version's, and the editor's
 * pair (`buildEditorRequest`, `validateEditorReply`, t-25), because what the
 * editor is shown of a result, and which of its recommendations it may name,
 * are the framework's. f-compare added `appealScores` (t-87) and the
 * verdict's pair (`buildVerdictRequest`, `validateVerdictReply`, t-88), for
 * the same reason as the editor's.
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

/**
 * The editor's call for a summary (t-25), as the engine builds it: a
 * {@link JudgeRequest} without a slot, since the editor is one agent.
 */
export type EditorRequest = Omit<JudgeRequest, 'slot'>;

/**
 * The editor's call for a rewrite of an assessed text (t-81), as the engine
 * builds it. The reply is plain text, streamed, so there is no schema;
 * `maxTokens` is sized from the text's length, and `timeoutMs` is a hint as
 * on {@link JudgeRequest}.
 */
export interface RewriteRequest {
  prompt: string;
  maxTokens: number;
  timeoutMs: number;
}

/**
 * A rewrite that fills an earlier one's gaps (t-83): that rewrite's draft, and
 * the writer's answer to each of its placeholders they answered, the
 * placeholder as written in the draft (`[ADD: …]`, `placeholders.ts`).
 * Placeholders with no answer are left as they are.
 */
export interface RewriteFollowUp {
  draft: string;
  answers: Array<{ placeholder: string; answer: string }>;
}

/** A rewrite focus the framework does not have (`rewriteFocuses()`). */
export class RewriteFocusUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RewriteFocusUnknownError';
  }
}

/**
 * The editor's summary of an assembled result (t-25): what to do first, in a
 * few sentences. Each change names one of the result's recommendations by the
 * id the framework gave it in the editor's request.
 */
export interface EditorSummary {
  /** Two or three sentences: how the text lands, overall. */
  verdict: string;
  /** The changes that matter most, most important first; at most three. */
  changes: { recommendation: string; change: string; why: string }[];
  /** What already works, to keep. */
  works: string[];
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

/**
 * A caller's context checked against the version: the context the engine
 * runs with, defaults applied, or each problem by its dotted path.
 */
export type ContextParse<Ctx = unknown> =
  { ok: true; ctx: Ctx } | { ok: false; issues: { path: string; message: string }[] };

/** One appeal's score in a result (`FrameworkEngine.appealScores`, t-87). */
export interface AppealScore {
  /** The framework's id for it (for this one, `ethos`, `pathos`, `logos`, `kairos`). */
  appeal: string;
  score: number;
}

/**
 * One finished review of a comparison's draft, as the editor's verdict
 * reads it (t-88): the draft's place in the comparison (its id in the
 * request and the reply), what the writer called it, its text, and the
 * result this engine assembled for it.
 */
export interface VerdictDraft<Result = unknown> {
  position: number;
  label: string | null;
  text: string;
  result: Result;
}

/** The editor's call for a comparison's verdict (t-88): as a summary's. */
export type VerdictRequest = EditorRequest;

/**
 * The editor's verdict on a comparison (t-88): which draft lands better with
 * this reader, and why, the way a summary says how one text lands.
 */
export interface ComparisonVerdict {
  /** The position of the draft that lands better: one of the drafts it was shown. */
  draft: number;
  /** Two or three sentences: why it lands better with this reader. */
  why: string;
  /** The appeals that decide it, most telling first: each the framework's id and one sentence. */
  appeals: { appeal: string; why: string }[];
}

/**
 * A project's adjustment to a version's weights (D5, t-72) checked against
 * the bounds that version declares: the overlay the engine scores with (null
 * for none), or each problem by its dotted path in the overlay.
 */
export type OverlayParse<Overlay = unknown> =
  | { ok: true; overlay: Overlay | null }
  | { ok: false; issues: { path: string; message: string }[] };

export interface FrameworkEngine<
  Ctx = unknown,
  Quick = unknown,
  JudgeOutputs = unknown,
  Result = unknown,
  JudgeOutput = unknown,
  Overlay = unknown,
> {
  /**
   * Who the text is for, as a caller sent it (untrusted; absent is `{}`),
   * checked against this version's ids. Every other method trusts the `Ctx`
   * this returns, so the API calls it before anything is stored or run
   * (t-24). Added in f-assessments, beside its first caller.
   */
  parseContext(input: unknown): ContextParse<Ctx>;
  /** The free, deterministic scan: no model call, the same answer every time. */
  quickScan(text: string, ctx: Ctx): Quick;
  /**
   * Combines a quick scan with whatever judge outputs arrived, keyed by the
   * slot each judge ran (as {@link activeJudgeSlots} returns them), which is
   * how a run stores them. With none it is the quick-scan result, which is
   * also what stands in when a judge fails.
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
  /**
   * The editor's call for a summary of `result`, which this engine assembled
   * from the same text and context. Added in f-assessments (t-25).
   */
  buildEditorRequest(
    text: string,
    ctx: Ctx,
    result: Result,
    projectContext?: string | null
  ): EditorRequest;
  /**
   * The editor's reply (parsed, untrusted) checked against `result`: a
   * change naming a recommendation the result does not have is dropped.
   */
  validateEditorReply(reply: unknown, result: Result): JudgeReplyValidation<EditorSummary>;
  /**
   * What a rewrite may aim at, the first being the default: the framework's
   * own names (for this one, `balanced` and its appeals). Added in f-rewrite
   * (t-81).
   */
  rewriteFocuses(): readonly string[];
  /**
   * A stored result's score on each of the framework's appeals, in the
   * framework's order, for comparing reviews of different drafts (t-87):
   * `null` when `result` is not one this framework assembled. `result` is
   * read as stored (JSON), so it is checked, not trusted. Added in f-compare.
   */
  appealScores(result: unknown): readonly AppealScore[] | null;
  /**
   * The editor's call for a rewrite of `text` from `result`, which this
   * engine assembled from the same text and context, aimed at `focus`.
   * `projectContext` is the project's background, as for a judge. Throws
   * {@link RewriteFocusUnknownError} for a focus {@link rewriteFocuses} does
   * not name. Added in f-rewrite (t-81).
   *
   * Gaps are asked for in the form `placeholders.ts` parses. With
   * `followUp` (t-83), the editor starts from that earlier draft and fills the
   * gaps the writer answered, leaving the rest.
   */
  buildRewriteRequest(
    text: string,
    ctx: Ctx,
    result: Result,
    focus: string,
    projectContext?: string | null,
    followUp?: RewriteFollowUp | null
  ): RewriteRequest;
  /**
   * The editor's call for a verdict on a comparison (t-88): which of `drafts`
   * (two or more finished reviews, each assembled by this engine from its
   * text and `ctx`) lands better with this reader. `projectContext` is the
   * project's background, as for a summary. Added in f-compare.
   */
  buildVerdictRequest(
    drafts: readonly VerdictDraft<Result>[],
    ctx: Ctx,
    projectContext?: string | null
  ): VerdictRequest;
  /**
   * The editor's verdict (parsed, untrusted) checked against the drafts it
   * was shown: refused whole when it names a draft that is not one of them,
   * or an appeal the framework does not have.
   */
  validateVerdictReply(
    reply: unknown,
    drafts: readonly VerdictDraft<Result>[]
  ): JudgeReplyValidation<ComparisonVerdict>;
  /**
   * A project's overlay (untrusted; absent is none) checked against this
   * version's bounds. A version that declares none refuses any overlay.
   * Added in f-projects (t-72).
   */
  parseOverlay(input: unknown): OverlayParse<Overlay>;
  /**
   * This engine, scoring with `overlay` (as {@link parseOverlay} returned
   * it). Every method then reads the adjusted weights; with `null` it scores
   * exactly as an engine never given one. This engine is not changed.
   */
  withOverlay(
    overlay: Overlay | null
  ): FrameworkEngine<Ctx, Quick, JudgeOutputs, Result, JudgeOutput, Overlay>;
}

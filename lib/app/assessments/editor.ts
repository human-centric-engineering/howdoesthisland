/**
 * The editor's summary of a full assessment (t-25, app-plan §8.2).
 *
 * After the judges, and once the result is assembled, the editor agent is
 * asked what the writer should do first: a verdict, the changes that matter
 * most (each naming one of the result's recommendations) and what already
 * works. The engine builds the request and checks the reply
 * (`buildEditorRequest`, `validateEditorReply`); the call is
 * {@link callAgent}, the judges' own path, under the `editor` role, so the
 * same binding, approved-list, budget and rate-limit checks apply, and the
 * same cost rows are written (`editor: 'summary'` in their metadata).
 *
 * **When it runs.** Only when the run asked for two judges or more (so never
 * for `quick` or a single judge) and at least one of them answered: with
 * none, the result is the free quick scan, and summarising it is not worth a
 * paid call.
 *
 * **A failure is not the assessment's.** The result stands without a
 * summary, and its `editor` record says why ({@link EditorRecord}); the
 * assessment's status is the judges' alone.
 */
import type { EditorSummary, FrameworkEngine, JudgeDrop } from '@/lib/app/frameworks/engine';
import { EDITOR_AGENT_SLUG } from '@/lib/app/judges/agents';
import {
  callAgent,
  JudgeRunError,
  type JudgeRunErrorCode,
  type JudgeSpend,
} from '@/lib/app/judges/run-judge';

/** The fewest judges a run asks for before the editor is asked to summarise it. */
export const EDITOR_MIN_JUDGES = 2;

/** Why the editor was not asked. */
export type EditorSkipReason =
  /** `quick`, or a single judge: there are not several findings to weigh. */
  | 'too_few_judges'
  /** Every judge failed: the result is the quick scan. */
  | 'no_judge_answered';

/** How the editor's step ended. */
export type EditorOutcome =
  | {
      status: 'written';
      summary: EditorSummary;
      drops: JudgeDrop[];
      spend: JudgeSpend;
      latencyMs: number;
    }
  | { status: 'skipped'; reason: EditorSkipReason }
  | {
      status: 'failed';
      code: JudgeRunErrorCode;
      message: string;
      /** What it was billed, when it reached the provider. */
      spend?: JudgeSpend;
      latencyMs: number;
    };

/**
 * What the stored result says about the editor, under `editor`: the summary,
 * or that there is none and why.
 */
export type EditorRecord =
  | {
      status: 'written';
      summary: EditorSummary;
      /** What post-validation dropped from the reply, by path. */
      dropped: JudgeDrop[];
      model: string;
      costUsd: number;
    }
  | { status: 'skipped'; reason: EditorSkipReason }
  | { status: 'failed'; errorCode: JudgeRunErrorCode; model: string | null; costUsd: number };

/** Why the editor is not asked, or `null` when it is. */
export function editorSkipReason(
  judges: readonly string[],
  answered: number
): EditorSkipReason | null {
  if (judges.length < EDITOR_MIN_JUDGES) return 'too_few_judges';
  if (answered === 0) return 'no_judge_answered';
  return null;
}

export interface RunEditorInput {
  engine: FrameworkEngine;
  /** `<framework slug>@<version>`, for the cost rows. */
  frameworkVersion: string;
  text: string;
  ctx: unknown;
  /** What `engine.assemble()` returned for this text and context. */
  result: unknown;
  /** The slots the run asked for. */
  judges: readonly string[];
  /** How many of them answered. */
  answered: number;
  projectContext?: string | null;
  /** Absent on an ephemeral run. */
  assessmentId?: string;
  ephemeral?: boolean;
  userId?: string | null;
}

/**
 * Ask the editor for its summary, or skip it. Every outcome a call decides
 * is an {@link EditorOutcome}; as with a judge, the database failing (the
 * agent or budget read) and the engine refusing to build the request
 * propagate as the caller's errors.
 */
export async function runEditor(input: RunEditorInput): Promise<EditorOutcome> {
  const reason = editorSkipReason(input.judges, input.answered);
  if (reason) return { status: 'skipped', reason };

  const { engine, result } = input;
  const started = Date.now();
  try {
    const reply = await callAgent({
      agentSlug: EDITOR_AGENT_SLUG,
      role: 'editor',
      name: 'editor',
      target: 'the editor',
      request: () =>
        engine.buildEditorRequest(input.text, input.ctx, result, input.projectContext ?? null),
      validate: (raw) => {
        const checked = engine.validateEditorReply(raw, result);
        return checked.ok ? { output: checked.output, drops: checked.drops } : null;
      },
      costMetadata: { editor: 'summary' },
      phase: 'editor',
      frameworkVersion: input.frameworkVersion,
      ...(input.assessmentId !== undefined ? { assessmentId: input.assessmentId } : {}),
      ...(input.ephemeral ? { ephemeral: true } : {}),
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
    });
    return {
      status: 'written',
      summary: reply.output,
      drops: reply.drops,
      spend: {
        provider: reply.provider,
        model: reply.model,
        usage: reply.usage,
        costUsd: reply.costUsd,
      },
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    if (!(err instanceof JudgeRunError)) throw err;
    return {
      status: 'failed',
      code: err.code,
      message: err.message,
      ...(err.spend ? { spend: err.spend } : {}),
      latencyMs: Date.now() - started,
    };
  }
}

/** What the editor's step cost, whatever its outcome. */
export const editorCostUsd = (outcome: EditorOutcome): number =>
  outcome.status === 'skipped' ? 0 : (outcome.spend?.costUsd ?? 0);

/** The record the stored result carries for `outcome`. */
export function editorRecord(outcome: EditorOutcome): EditorRecord {
  switch (outcome.status) {
    case 'written':
      return {
        status: 'written',
        summary: outcome.summary,
        dropped: outcome.drops,
        model: outcome.spend.model,
        costUsd: outcome.spend.costUsd,
      };
    case 'skipped':
      return { status: 'skipped', reason: outcome.reason };
    case 'failed':
      return {
        status: 'failed',
        errorCode: outcome.code,
        model: outcome.spend?.model ?? null,
        costUsd: outcome.spend?.costUsd ?? 0,
      };
  }
}

/**
 * `result` with the editor's record under `editor`. A result that is not an
 * object (no framework returns one; the engine interface does not promise
 * one) is returned as it is.
 */
export function withEditor(result: unknown, outcome: EditorOutcome): unknown {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return result;
  return { ...result, editor: editorRecord(outcome) };
}

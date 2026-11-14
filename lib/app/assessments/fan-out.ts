/**
 * Run a set of judges over one text, at most {@link JUDGES_IN_FLIGHT} at once
 * (t-22, app-plan §8.2).
 *
 * Needs no rows: the stored job (`run.ts`) saves each judge as it lands
 * through `onLanded`, and an ephemeral run (`store: false`, t-24) passes none.
 * A judge that fails with a {@link JudgeRunError} is a failure the run records
 * and carries on past: its dimensions fall back to the quick scan at assembly.
 * Anything else (the database failing, a slot the engine cannot run) is the
 * caller's error and rejects the fan-out once the judges in flight settle.
 *
 * `shouldContinue` is asked before each judge starts. Once it says no (the run
 * was cancelled, or lost its lease), no further judge starts; the ones in
 * flight finish, since a provider call cannot be taken back, and land as
 * usual.
 */
import type { FrameworkEngine } from '@/lib/app/frameworks/engine';
import { JUDGES_IN_FLIGHT } from '@/lib/app/assessments/limits';
import {
  JudgeRunError,
  runJudge,
  type JudgeReply,
  type JudgeRunErrorCode,
  type JudgeSpend,
} from '@/lib/app/judges/run-judge';

/** One judge's outcome, as it lands. */
export type LandedJudge =
  | { slot: string; ok: true; reply: JudgeReply<unknown>; latencyMs: number }
  | {
      slot: string;
      ok: false;
      code: JudgeRunErrorCode;
      message: string;
      latencyMs: number;
      /** What it was billed, when it reached the provider. */
      spend?: JudgeSpend;
    };

export interface RunJudgesInput {
  engine: FrameworkEngine;
  /** `<framework slug>@<version>`, for the cost rows. */
  frameworkVersion: string;
  text: string;
  ctx: unknown;
  slots: readonly string[];
  projectContext?: string | null;
  /** Absent on an ephemeral run. */
  assessmentId?: string;
  userId?: string | null;
  /** Asked before each judge starts; `false` starts no more. */
  shouldContinue?: () => Promise<boolean>;
  /** Called as each judge lands, before the next result is counted. */
  onLanded?: (landed: LandedJudge) => Promise<void>;
  /** Judges in flight at once. */
  concurrency?: number;
}

export interface RunJudgesResult {
  /** Every judge that landed, in the order they landed. */
  landed: LandedJudge[];
  /** Whether a judge was left unstarted because `shouldContinue` said no. */
  stopped: boolean;
}

export async function runJudges(input: RunJudgesInput): Promise<RunJudgesResult> {
  const queue = [...input.slots];
  const landed: LandedJudge[] = [];
  // Shared by the workers; an object, so the flags read after the workers
  // settle are the ones they set.
  const state: { stopped: boolean; failure: { error: unknown } | null } = {
    stopped: false,
    failure: null,
  };

  const runOne = async (slot: string): Promise<void> => {
    const started = Date.now();
    let outcome: LandedJudge;
    try {
      const reply = await runJudge(slot, {
        engine: input.engine,
        frameworkVersion: input.frameworkVersion,
        text: input.text,
        ctx: input.ctx,
        ...(input.projectContext !== undefined ? { projectContext: input.projectContext } : {}),
        ...(input.assessmentId !== undefined ? { assessmentId: input.assessmentId } : {}),
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
      });
      outcome = { slot, ok: true, reply, latencyMs: Date.now() - started };
    } catch (err) {
      if (!(err instanceof JudgeRunError)) throw err;
      outcome = {
        slot,
        ok: false,
        code: err.code,
        message: err.message,
        latencyMs: Date.now() - started,
        ...(err.spend ? { spend: err.spend } : {}),
      };
    }
    landed.push(outcome);
    await input.onLanded?.(outcome);
  };

  const worker = async (): Promise<void> => {
    while (queue.length > 0 && !state.stopped && !state.failure) {
      // Inside the try, so a check that throws (its read failing) is the
      // fan-out's failure like any other, raised once the others settle.
      try {
        if (input.shouldContinue && !(await input.shouldContinue())) {
          state.stopped = true;
          return;
        }
        // Taken after the check, so a judge is never claimed by a worker
        // that then stops without running it.
        const slot = queue.shift();
        if (slot === undefined) return;
        await runOne(slot);
      } catch (error) {
        state.failure ??= { error };
      }
    }
  };

  const width = Math.max(1, Math.min(input.concurrency ?? JUDGES_IN_FLIGHT, queue.length));
  await Promise.all(Array.from({ length: width }, worker));
  if (state.failure) throw state.failure.error;
  return { landed, stopped: state.stopped };
}

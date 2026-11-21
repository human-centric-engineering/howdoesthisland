/**
 * Run a stored assessment under a lease (t-22, app-plan §8.2).
 *
 *   claim ─▶ budget (no judge run yet) ─▶ quick scan ─▶ missing judges (≤ 4 in flight, each JudgeRun saved
 *   as it lands) ─▶ assemble ─▶ editor's summary ─▶ COMPLETED | PARTIAL | FAILED
 *
 * **The editor** (`editor.ts`, t-25) summarises the assembled result for a run
 * of two judges or more, and its record is stored on the result as `editor`:
 * the summary, or that there is none and why. Its failure never changes the
 * status. A run re-driven after the editor answered (the final write failing)
 * asks it again: there is no row to reuse, and the case is rare.
 *
 * **The lease.** A run claims the assessment by writing a fresh `leaseToken`
 * and a `leaseExpiresAt` {@link LEASE_MS} ahead, and renews it every
 * {@link LEASE_RENEW_MS} while it is alive, cancelled or not (a cancelled
 * one for up to {@link CANCEL_GRACE_MS}): a cancelled run's judges in flight
 * and its editor still land and are billed, and the budget check and the
 * running count hold it only while its lease is live (t-56). Every write after the claim is
 * conditional on the token and on `RUNNING`, so a run that lost its lease (or
 * was cancelled) writes nothing more to the assessment. A claim succeeds only
 * when the assessment is `QUEUED` or `RUNNING` with no live lease, has had
 * fewer than {@link MAX_ATTEMPTS} runs, and the workspace has fewer than
 * {@link RUNNING_PER_WORKSPACE} other live runs, stored or kept nowhere
 * (`places.ts`, t-28). The count and the claim are
 * one serializable transaction, so two claimers cannot both take the last
 * place; the loser of a conflict leaves the assessment `QUEUED` for the
 * recovery job.
 *
 * **Re-driving.** A run starts only the judges with no `JudgeRun` row yet,
 * and those whose earlier failure may not recur ({@link RETRIED_ON_REDRIVE}:
 * a rate limit, a provider outage). A judge that answered keeps its row and is
 * reused at assembly; any other failure stands (its dimensions fall back to
 * the quick scan and the result is `PARTIAL`). A judge run again keeps its
 * earlier attempts, tokens and cost on its row.
 *
 * **Cost.** Each judge's spend is added to the assessment's `costUsd` in the
 * transaction that saves it, so the total holds however the run ends:
 * completed, cancelled, or given up on. The editor's is added as it lands,
 * under the same guard.
 *
 * **The budget, again** (t-53). A review that has called no judge yet is
 * checked against the workspace's budget once claimed (`budgetRefusal` in
 * `lib/app/usage/budget.ts`): it may have waited in the queue while other
 * spend landed. Only the reviews in flight created before it are held back,
 * so of two claimed together the older runs. One its credits or the budget
 * no longer cover is finished `FAILED`, `errorCode` `INSUFFICIENT_CREDITS` or
 * `BUDGET_EXCEEDED`, with the reason in `error` and the figures in
 * `errorDetails`, and no judge is called. Its `startedAt` is cleared, since
 * it never started. A check that can read neither bound, or not the history,
 * refuses nothing.
 *
 * **The charge** (t-58, `lib/app/credits/charge.ts`). Every write that ends
 * a review charges the workspace's CopyCredits for its cost rows in the same
 * transaction: {@link finish}, the last attempt's failure, and a cancelled
 * run's last write ({@link freePlace}). A cancel of a review no run has
 * claimed charges as it cancels; one whose run's lease ran out is charged by
 * the recovery job. A review deleted before it was charged is charged
 * by the delete (`remove` in `api/service.ts`), from its rows.
 *
 * **An error that is not a judge's** (the database failing part-way) hands the
 * assessment back to the queue under the same attempt count, so the recovery
 * job re-drives it until {@link MAX_ATTEMPTS}. The engine refusing the version,
 * or failing to score the text (its quick scan or `assemble()` throwing,
 * which would throw again), is final at once.
 *
 * **Saving a judge** takes the assessment's row lock under the run's lease,
 * so a run that lost its lease never overwrites the row its successor wrote;
 * its late judge is billed (the cost log has it) but not stored.
 *
 * **Cancel** ({@link cancelAssessment}) sets `CANCELLED` and keeps the lease
 * token, so only the run that held it saves the judges it had in flight. The
 * run asks before each judge starts, so no further judge is called; the ones
 * in flight finish and are saved, and the assessment is not written again.
 *
 * **Privacy.** The run is one privacy scope (`assessment:<id>`), and each
 * judge's call sits in its agent's scope inside it (`runJudge`), so each
 * agent's privacy mode applies to its call.
 *
 * Runs in the caller's tenant context: the API's request (t-24), its
 * `after()`, or the recovery job's per-org scope.
 */
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { keepRunningAfterResponse } from '@/lib/api/after-response';
import { engineForVersion } from '@/lib/app/assessments/engine';
import { JudgeProfileError } from '@/lib/app/frameworks/engine';
import { runJudges, type LandedJudge } from '@/lib/app/assessments/fan-out';
import { editorCostUsd, runEditor, withEditor } from '@/lib/app/assessments/editor';
import {
  CANCEL_GRACE_MS,
  LEASE_MS,
  LEASE_RENEW_MS,
  MAX_ATTEMPTS,
  RETRIED_ON_REDRIVE,
  RUNNING_PER_WORKSPACE,
} from '@/lib/app/assessments/limits';
import { prisma } from '@/lib/db/client';
import { liveRunsIn } from '@/lib/app/assessments/places';
import { isSerializableConflict } from '@/lib/db/serializable-conflict';
import { logger } from '@/lib/logging';
import { createPrivacyScope, runInPrivacyScope } from '@/lib/orchestration/privacy/scope';
import { requireOrgId } from '@/lib/tenancy/context';
import { budgetRefusal } from '@/lib/app/usage/budget';
import { chargeEndedReview } from '@/lib/app/credits/charge';

/** How a call to {@link runAssessment} ended. */
export type RunOutcome =
  /** Another run holds it, it is final, it is out of attempts, or the workspace is at its limit. */
  | 'not_claimed'
  | 'completed'
  | 'partial'
  | 'failed'
  /** Cancelled while it ran: no further judge was called. */
  | 'cancelled'
  /** Its lease went to another run (it stopped renewing in time); that run finishes it. */
  | 'lease_lost'
  /** Stopped on an error that was not a judge's; queued again for the recovery job. */
  | 'requeued';

/** The two numbers every framework's result carries for listing (§9 `overall`, `band`). */
const resultScores = z.object({ scores: z.object({ overall: z.number(), band: z.string() }) });

/** A result's `overall` and `band`, or nulls when it carries none. */
export function scoresOf(result: unknown): { overall: number | null; band: string | null } {
  const parsed = resultScores.safeParse(result);
  return parsed.success
    ? { overall: parsed.data.scores.overall, band: parsed.data.scores.band }
    : { overall: null, band: null };
}

export async function runAssessment(assessmentId: string): Promise<RunOutcome> {
  const run = await beginAssessment(assessmentId);
  return run ? await run.done : 'not_claimed';
}

/** A run that has been claimed and started. */
export interface StartedRun {
  /** Settles when the run ends; never rejects. */
  done: Promise<RunOutcome>;
}

/**
 * Claim the assessment and start its run, without waiting for it: `null` when
 * it was not claimed. A claim that fails for any reason leaves it as it was,
 * for the recovery job.
 */
export async function beginAssessment(assessmentId: string): Promise<StartedRun | null> {
  const orgId = requireOrgId();
  let token: string | null;
  try {
    token = await claim(assessmentId, orgId);
  } catch (err) {
    logger.error('Assessment claim failed', err, { assessmentId });
    return null;
  }
  if (!token) return null;
  return { done: execute(assessmentId, orgId, token) };
}

async function execute(assessmentId: string, orgId: string, token: string): Promise<RunOutcome> {
  const lease = holdLease(assessmentId, token);
  let outcome: RunOutcome;
  try {
    const row = await prisma.assessment.findUnique({
      where: { id: assessmentId, orgId },
      select: {
        id: true,
        frameworkVersionId: true,
        profile: true,
        judges: true,
        createdAt: true,
        context: true,
        createdByUserId: true,
        content: { select: { text: true, sourceUrl: true } },
        judgeRuns: { include: { reply: { select: { output: true } } } },
      },
    });
    const refused = row ? await refuseOverBudget(row, orgId, token) : null;
    if (!row) {
      outcome = 'lease_lost';
    } else if (refused) {
      outcome = refused;
    } else {
      const scope = createPrivacyScope({
        scopeId: `assessment:${row.id}`,
        orgId,
        ...(row.createdByUserId ? { userId: row.createdByUserId } : {}),
      });
      outcome = await runInPrivacyScope(scope, () => drive(row, orgId, token, lease));
    }
  } catch (err) {
    // Not the judges' and not final (the database, most likely): back to the
    // queue, to be re-driven until it is out of attempts, or failed now if
    // this was its last. If the write fails too, the lease runs out and the
    // recovery job does the same.
    logger.error('Assessment run stopped on an error', err, { assessmentId });
    outcome = await stoppedOnError(assessmentId, token).catch(() => 'lease_lost' as const);
  }
  lease.release();
  if (outcome === 'cancelled') {
    // Failed, the lease stays set, and the recovery job charges it once lapsed.
    await freePlace(assessmentId, token).catch((err: unknown) =>
      logger.error('Could not free a cancelled run’s place, or charge it', err, { assessmentId })
    );
  }
  startNextQueued(orgId, assessmentId);
  return outcome;
}

const STOPPED_ON_ERROR = 'Its run stopped on an error that was not a judge’s.';

/** Hand back a run that stopped on an error: `QUEUED` again, or `FAILED` on its last attempt. */
async function stoppedOnError(assessmentId: string, token: string): Promise<RunOutcome> {
  const ours = { id: assessmentId, leaseToken: token, status: 'RUNNING' as const };
  const released = { leaseToken: null, leaseExpiresAt: null, error: STOPPED_ON_ERROR };
  const failed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.assessment.updateMany({
      where: { ...ours, attempts: { gte: MAX_ATTEMPTS } },
      data: { ...released, status: 'FAILED', completedAt: new Date() },
    });
    if (count === 1) await chargeEndedReview(tx, assessmentId);
    return count;
  });
  if (failed === 1) return 'failed';
  const requeued = await prisma.assessment.updateMany({
    where: ours,
    // The note is kept for the recovery job's give-up; a claim clears it.
    data: { ...released, status: 'QUEUED' },
  });
  if (requeued.count === 1) return 'requeued';
  // Neither: it was cancelled under the run, or its lease went elsewhere.
  return await lostTo(assessmentId);
}

/**
 * Start the workspace's oldest queued assessment, now that a place is free
 * (this run's, or a `store: false` run's: `finished` is absent then), without
 * waiting for it. This is what picks up an assessment that
 * was queued while the workspace was at its limit; the recovery job is the
 * backstop. Tries the next few in turn, since another claimer may take the
 * oldest first. Never throws.
 */
export function startNextQueued(orgId: string, finished?: string): void {
  keepRunningAfterResponse(
    async () => {
      const queued = await prisma.assessment.findMany({
        where: {
          orgId,
          status: 'QUEUED',
          attempts: { lt: MAX_ATTEMPTS },
          ...(finished ? { id: { not: finished } } : {}),
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
        },
        orderBy: { createdAt: 'asc' },
        take: RUNNING_PER_WORKSPACE,
        select: { id: true },
      });
      for (const { id } of queued) {
        const run = await beginAssessment(id);
        if (run) {
          await run.done;
          return;
        }
      }
    },
    'app: next queued assessment',
    { orgId }
  );
}

type AssessmentRow = {
  id: string;
  frameworkVersionId: string;
  profile: string;
  judges: string[];
  createdAt: Date;
  context: Prisma.JsonValue;
  createdByUserId: string | null;
  content: { text: string; sourceUrl: string | null };
  judgeRuns: StoredJudgeRun[];
};

type StoredJudgeRun = {
  judge: string;
  status: 'SUCCEEDED' | 'FAILED';
  errorCode: string | null;
  /** Its reply (`app_judge_reply`), for a succeeded run. */
  reply: { output: Prisma.JsonValue } | null;
  costUsd: number;
  attempts: number;
  tokens: Prisma.JsonValue;
  provider: string | null;
  modelName: string | null;
};

const storedTokens = z.object({ input: z.number(), output: z.number() });

/** Thrown by the engine's own scoring: the same text would throw again. */
export const NOT_SCORABLE = 'The framework could not score this text.';

async function drive(
  row: AssessmentRow,
  orgId: string,
  token: string,
  lease: Lease
): Promise<RunOutcome> {
  const loaded = await engineForVersion(row.frameworkVersionId);
  if (!loaded) {
    const written = await finish(row.id, token, {
      status: 'FAILED',
      error: 'Its framework version can no longer be run.',
    });
    return written ? 'failed' : await lostTo(row.id);
  }
  const { engine, label } = loaded;
  const { text, sourceUrl } = row.content;
  let quick: unknown;
  try {
    quick = engine.quickScan(text, row.context);
  } catch (err) {
    return await notScorable(row.id, token, err);
  }

  const outputs: Record<string, unknown> = {};
  let failures = 0;
  // A judge run again: its earlier row, whose spend the new row carries on.
  const prior = new Map<string, StoredJudgeRun>();
  const done = new Set<string>();
  for (const run of row.judgeRuns) {
    if (run.status === 'SUCCEEDED' && run.reply) {
      outputs[run.judge] = run.reply.output;
      done.add(run.judge);
    } else if (run.status === 'SUCCEEDED') {
      // Its reply is gone, which the retention purge never does to a run
      // still live. Counted as a failed judge rather than called again: a
      // second call would bill the workspace twice for one judge. Logged:
      // reaching here means a reply was lost.
      logger.warn('Succeeded judge run has no reply; counted as failed', {
        assessmentId: row.id,
        judge: run.judge,
      });
      failures += 1;
      done.add(run.judge);
    } else if (run.errorCode && RETRIED_ON_REDRIVE.has(run.errorCode)) {
      prior.set(run.judge, run);
    } else {
      failures += 1;
      done.add(run.judge);
    }
  }
  // A slot the engine no longer runs (its switch turned off after the
  // assessment was queued) fails as that judge, not as the run: it would
  // refuse again on every re-drive.
  const missing: string[] = [];
  for (const slot of row.judges.filter((s) => !done.has(s))) {
    try {
      engine.activeJudgeSlots([slot]);
      missing.push(slot);
    } catch (err) {
      if (!(err instanceof JudgeProfileError)) throw err;
      const landed = {
        slot,
        ok: false,
        code: 'slot_unavailable',
        message: err.message,
        latencyMs: 0,
      } as const;
      if (await saveJudgeRun(row.id, orgId, token, landed, prior.get(slot))) failures += 1;
    }
  }

  const fan = await runJudges({
    engine,
    frameworkVersion: label,
    text,
    ctx: row.context,
    slots: missing,
    assessmentId: row.id,
    userId: row.createdByUserId,
    shouldContinue: () => stillOurs(row.id, token, lease),
    onLanded: async (landed) => {
      const saved = await saveJudgeRun(row.id, orgId, token, landed, prior.get(landed.slot));
      // A judge that landed after the lease was lost is not this run's to count.
      if (!saved) return;
      if (landed.ok) outputs[landed.slot] = landed.reply.output;
      else failures += 1;
    },
  });
  if (fan.stopped || !(await stillOurs(row.id, token, lease))) {
    return await lostTo(row.id);
  }

  let result: unknown;
  try {
    result = engine.assemble(text, row.context, quick, outputs, sourceUrl);
  } catch (err) {
    return await notScorable(row.id, token, err);
  }

  // The editor's summary (t-25). Its failure is recorded on the result and
  // leaves the status the judges' alone.
  const editor = await runEditor({
    engine,
    frameworkVersion: label,
    text,
    ctx: row.context,
    result,
    judges: row.judges,
    answered: Object.keys(outputs).length,
    assessmentId: row.id,
    userId: row.createdByUserId,
  });
  // Already billed, so a failed write is logged, not thrown: a throw would
  // hand the run back, and its re-drive would pay for the editor again.
  try {
    await addCost(row.id, token, editorCostUsd(editor));
  } catch (err) {
    logger.error('Could not add the editor’s cost to the assessment', err, {
      assessmentId: row.id,
      costUsd: editorCostUsd(editor),
    });
  }
  result = withEditor(result, editor);

  const status = failures > 0 ? 'PARTIAL' : 'COMPLETED';
  const written = await finish(row.id, token, {
    status,
    // The engine's own output, plain data by construction.
    result: result as Prisma.InputJsonValue,
    ...scoresOf(result),
    error: null,
  });
  if (!written) return await lostTo(row.id);
  return status === 'PARTIAL' ? 'partial' : 'completed';
}

/**
 * Check the budget again as the review is claimed (t-53, `budget.ts`): one
 * that has called no judge yet and would now pass what is left is finished
 * `FAILED` with the refusal, before any judge is called. `null` when it fits,
 * or has judge runs already (a re-drive, which the per-judge gate ends).
 */
async function refuseOverBudget(
  row: Pick<AssessmentRow, 'id' | 'profile' | 'judges' | 'createdAt' | 'judgeRuns'>,
  orgId: string,
  token: string
): Promise<RunOutcome | null> {
  if (row.judgeRuns.length > 0) return null;
  const refusal = await budgetRefusal(orgId, row.profile, row.judges.length, {
    id: row.id,
    createdAt: row.createdAt,
  });
  if (!refusal) return null;
  logger.info('Queued assessment refused by the budget as it was claimed', {
    assessmentId: row.id,
    ...refusal.details,
  });
  const written = await finish(row.id, token, {
    status: 'FAILED',
    error: refusal.reason,
    // The claim set it; nothing ran.
    startedAt: null,
    errorCode: refusal.code,
    errorDetails: { ...refusal.details },
  });
  return written ? 'failed' : await lostTo(row.id);
}

/** Record that the engine could not score the text: final, since it would throw again. */
async function notScorable(assessmentId: string, token: string, err: unknown) {
  logger.error('Assessment could not be scored', err, { assessmentId });
  const written = await finish(assessmentId, token, { status: 'FAILED', error: NOT_SCORABLE });
  return written ? ('failed' as const) : await lostTo(assessmentId);
}

/**
 * Save one judge's outcome, if the run still holds the assessment (under its
 * token, running or cancelled), and add its spend to the assessment's cost.
 * One row per judge per assessment; a re-run replaces `prior`, carrying on its
 * attempts, tokens and cost. Answers whether it was saved.
 *
 * The guard is an update of the assessment row in the same transaction, so it
 * holds the row's lock until the upsert commits: a claim by another run waits
 * for it, and a save after that claim finds the token changed.
 */
async function saveJudgeRun(
  assessmentId: string,
  orgId: string,
  token: string,
  landed: LandedJudge,
  prior?: StoredJudgeRun
): Promise<boolean> {
  const spend = landed.ok ? landed.reply : landed.spend;
  const spentUsd = spend?.costUsd ?? 0;
  const priorTokens = storedTokens.safeParse(prior?.tokens);
  const tokens = [
    ...(priorTokens.success ? [priorTokens.data] : []),
    ...(spend ? [spend.usage] : []),
  ];
  const data = {
    status: landed.ok ? ('SUCCEEDED' as const) : ('FAILED' as const),
    provider: spend?.provider ?? prior?.provider ?? null,
    modelName: spend?.model ?? prior?.modelName ?? null,
    attempts: (prior?.attempts ?? 0) + (spend?.usage.attempts ?? 0),
    costUsd: (prior?.costUsd ?? 0) + spentUsd,
    // Left out when nothing was ever billed: only a failed row is replaced,
    // and one with no spend has no token count to clear.
    ...(tokens.length > 0
      ? {
          tokens: {
            input: tokens.reduce((sum, t) => sum + t.input, 0),
            output: tokens.reduce((sum, t) => sum + t.output, 0),
          },
        }
      : {}),
    latencyMs: landed.latencyMs,
    ...(landed.ok
      ? { errorCode: null, errorMessage: null }
      : { errorCode: landed.code, errorMessage: landed.message }),
  };
  // The engine's post-validated reply and its drop record: plain data. Kept
  // in its own row, which retention deletes sooner than the run (t-26).
  const reply = landed.ok
    ? {
        output: landed.reply.output as Prisma.InputJsonValue,
        dropped: landed.reply.drops as unknown as Prisma.InputJsonValue,
      }
    : null;
  return await prisma.$transaction(async (tx) => {
    const { count } = await tx.assessment.updateMany({
      where: { id: assessmentId, leaseToken: token, status: { in: ['RUNNING', 'CANCELLED'] } },
      data: { costUsd: { increment: spentUsd } },
    });
    if (count === 0) return false;
    const run = await tx.judgeRun.upsert({
      where: { assessmentId_judge: { assessmentId, judge: landed.slot } },
      create: { orgId, assessmentId, judge: landed.slot, ...data },
      update: data,
      select: { id: true },
    });
    // Only a failed row is ever replaced, and it has no reply, so a create is
    // all a succeeded save needs. Upserted all the same, so a second save of
    // one judge cannot fail on the unique run id.
    if (reply) {
      await tx.judgeReply.upsert({
        where: { judgeRunId: run.id },
        create: { orgId, judgeRunId: run.id, ...reply },
        update: reply,
      });
    }
    return true;
  });
}

/**
 * Add a spend that is not a judge's (the editor's) to the assessment's cost,
 * while the run still holds it, running or cancelled, as `saveJudgeRun` does.
 */
async function addCost(assessmentId: string, token: string, usd: number): Promise<void> {
  if (usd === 0) return;
  await prisma.assessment.updateMany({
    where: { id: assessmentId, leaseToken: token, status: { in: ['RUNNING', 'CANCELLED'] } },
    data: { costUsd: { increment: usd } },
  });
}

/** Tries at a claim that keeps losing serialization conflicts, before leaving it queued. */
const CLAIM_TRIES = 3;

/**
 * Take the lease, or answer `null`. See the file header for when a claim
 * succeeds. Claimers in one workspace conflict on its running count (a
 * request's background run against the recovery job, or two instances'
 * ticks), so a conflict is retried a few times before the assessment is left
 * queued for a later tick.
 */
async function claim(assessmentId: string, orgId: string): Promise<string | null> {
  for (let tries = 1; ; tries += 1) {
    try {
      return await claimOnce(assessmentId, orgId);
    } catch (err) {
      if (!isSerializableConflict(err)) throw err;
      if (tries >= CLAIM_TRIES) return null;
      // A jittered pause, so claimers that conflicted do not retry in step.
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 50 * tries));
    }
  }
}

async function claimOnce(assessmentId: string, orgId: string): Promise<string | null> {
  const now = new Date();
  return await prisma.$transaction(
    async (tx) => {
      const row = await tx.assessment.findUnique({
        where: { id: assessmentId, orgId },
        select: { status: true, leaseExpiresAt: true, attempts: true, startedAt: true },
      });
      if (!row || (row.status !== 'QUEUED' && row.status !== 'RUNNING')) return null;
      if (row.leaseExpiresAt && row.leaseExpiresAt > now) return null;
      if (row.attempts >= MAX_ATTEMPTS) return null;
      // Stored runs and runs kept nowhere share the places (t-28).
      if ((await liveRunsIn(tx, orgId, now, assessmentId)) >= RUNNING_PER_WORKSPACE) return null;

      const token = crypto.randomUUID();
      await tx.assessment.update({
        where: { id: assessmentId },
        data: {
          status: 'RUNNING',
          leaseToken: token,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          attempts: { increment: 1 },
          startedAt: row.startedAt ?? now,
          // An earlier run's note, which this run's own ending replaces.
          error: null,
        },
      });
      return token;
    },
    { isolationLevel: 'Serializable' }
  );
}

interface Lease {
  /**
   * False once a renewal matched nothing: the lease taken over, cleared,
   * lapsed after a cancel, or the assessment final. A cancel alone does not
   * turn it false; `stillOurs` reads the status for that.
   */
  readonly held: () => boolean;
  release: () => void;
}

/**
 * Renew the lease every {@link LEASE_RENEW_MS} until released, while the
 * assessment is under the token: `RUNNING` with its lease set, or
 * `CANCELLED` with its lease still live, until {@link LEASE_MS} short of
 * {@link CANCEL_GRACE_MS} after the cancel, so the last lease runs out
 * before the purge may take the row. A cancel therefore does not turn
 * `held` false: `stillOurs` reads the status, and that is what stops the run
 * starting judges. A renewal never brings back a cancelled lease that was
 * cleared (`freePlace`) or lapsed, whose place another run may have taken,
 * however late it lands.
 */
function holdLease(assessmentId: string, token: string): Lease {
  let held = true;
  const timer = setInterval(() => {
    const now = Date.now();
    prisma.assessment
      .updateMany({
        where: {
          id: assessmentId,
          leaseToken: token,
          OR: [
            { status: 'RUNNING', leaseExpiresAt: { not: null } },
            {
              status: 'CANCELLED',
              leaseExpiresAt: { gt: new Date(now) },
              completedAt: { gt: new Date(now - (CANCEL_GRACE_MS - LEASE_MS)) },
            },
          ],
        },
        data: { leaseExpiresAt: new Date(now + LEASE_MS) },
      })
      .then(
        ({ count }) => {
          if (count === 0) held = false;
        },
        (err: unknown) => {
          // Not fatal by itself: the lease has a minute left, and the next
          // renewal may succeed. If none does, another run takes it over.
          logger.warn('Assessment lease renewal failed', {
            assessmentId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      );
  }, LEASE_RENEW_MS);
  timer.unref?.();
  return { held: () => held, release: () => clearInterval(timer) };
}

/** Whether the run still holds the assessment: `RUNNING` under its token. */
async function stillOurs(assessmentId: string, token: string, lease: Lease): Promise<boolean> {
  if (!lease.held()) return false;
  const row = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { status: true, leaseToken: true },
  });
  return row?.status === 'RUNNING' && row.leaseToken === token;
}

/** Why a write under the lease matched nothing: the assessment was cancelled, or another run has it. */
async function lostTo(assessmentId: string): Promise<'cancelled' | 'lease_lost'> {
  const row = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { status: true },
  });
  return row?.status === 'CANCELLED' ? 'cancelled' : 'lease_lost';
}

/**
 * Write the final state, if the lease is still ours, and charge the review
 * for what it spent in the same transaction (t-58). Answers whether it was.
 */
async function finish(
  assessmentId: string,
  token: string,
  data: Omit<Prisma.AssessmentUpdateManyMutationInput, 'leaseToken' | 'leaseExpiresAt'>
): Promise<boolean> {
  return await prisma.$transaction(async (tx) => {
    const { count } = await tx.assessment.updateMany({
      where: { id: assessmentId, leaseToken: token, status: 'RUNNING' },
      data: { ...data, completedAt: new Date(), leaseToken: null, leaseExpiresAt: null },
    });
    if (count === 1) await chargeEndedReview(tx, assessmentId);
    return count === 1;
  });
}

/**
 * Cancel an assessment that has not finished. Answers whether it was
 * cancelled: `false` when it is already final, or not this workspace's.
 */
export async function cancelAssessment(assessmentId: string): Promise<boolean> {
  const orgId = requireOrgId();
  const open = { id: assessmentId, orgId, status: { in: ['QUEUED' as const, 'RUNNING' as const] } };
  const now = new Date();
  return await prisma.$transaction(async (tx) => {
    // No run holds it (queued): nothing is left to land, so it ends here, and
    // is charged for what earlier runs spent. A lease run out is not taken
    // for no run: the run may be alive with its renewals failing, its judges
    // still landing. It keeps its lease, and the recovery job charges it.
    const idle = await tx.assessment.updateMany({
      where: { ...open, leaseExpiresAt: null },
      data: { status: 'CANCELLED', completedAt: now },
    });
    if (idle.count === 1) {
      await chargeEndedReview(tx, assessmentId);
      return true;
    }
    const { count } = await tx.assessment.updateMany({
      where: open,
      // The token and lease stay: the run that held them can still save the
      // judges it has in flight, and no other run can (see `saveJudgeRun`), and
      // the run keeps its place in the workspace's limit until they land
      // (`freePlace`, which charges it), or its lease runs out (the recovery
      // job charges it then, as it does one already run out).
      data: { status: 'CANCELLED', completedAt: now },
    });
    return count === 1;
  });
}

/**
 * A cancelled run's judges have all landed: give up its place in the
 * workspace's limit, and charge it for what it spent (t-58).
 */
async function freePlace(assessmentId: string, token: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.assessment.updateMany({
      where: { id: assessmentId, leaseToken: token, status: 'CANCELLED' },
      data: { leaseExpiresAt: null },
    });
    if (count === 1) await chargeEndedReview(tx, assessmentId);
  });
}

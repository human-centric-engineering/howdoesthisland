/**
 * Run a stored assessment under a lease (t-22, app-plan §8.2).
 *
 *   claim ─▶ quick scan ─▶ missing judges (≤ 4 in flight, each JudgeRun saved
 *   as it lands) ─▶ assemble ─▶ COMPLETED | PARTIAL | FAILED
 *
 * **The lease.** A run claims the assessment by writing a fresh `leaseToken`
 * and a `leaseExpiresAt` {@link LEASE_MS} ahead, and renews it every
 * {@link LEASE_RENEW_MS} while it is alive. Every write after the claim is
 * conditional on the token and on `RUNNING`, so a run that lost its lease (or
 * was cancelled) writes nothing more to the assessment. A claim succeeds only
 * when the assessment is `QUEUED` or `RUNNING` with no live lease, has had
 * fewer than {@link MAX_ATTEMPTS} runs, and the workspace has fewer than
 * {@link RUNNING_PER_WORKSPACE} other live runs. The count and the claim are
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
 * completed, cancelled, or given up on.
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
import {
  LEASE_MS,
  LEASE_RENEW_MS,
  MAX_ATTEMPTS,
  RUNNING_PER_WORKSPACE,
} from '@/lib/app/assessments/limits';
import { prisma } from '@/lib/db/client';
import { isSerializableConflict } from '@/lib/db/serializable-conflict';
import { logger } from '@/lib/logging';
import { createPrivacyScope, runInPrivacyScope } from '@/lib/orchestration/privacy/scope';
import { requireOrgId } from '@/lib/tenancy/context';

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

/**
 * Failures a re-drive runs the judge again for: each is about the moment
 * (a rate-limit window, a provider outage), not the judge or the text.
 */
const RETRIED_ON_REDRIVE: ReadonlySet<string> = new Set(['rate_limited', 'provider_error']);

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
        judges: true,
        context: true,
        createdByUserId: true,
        content: { select: { text: true, sourceUrl: true } },
        judgeRuns: true,
      },
    });
    if (!row) {
      lease.release();
      return 'lease_lost';
    }

    const scope = createPrivacyScope({
      scopeId: `assessment:${row.id}`,
      orgId,
      ...(row.createdByUserId ? { userId: row.createdByUserId } : {}),
    });
    outcome = await runInPrivacyScope(scope, () => drive(row, orgId, token, lease));
  } catch (err) {
    // Not the judges' and not final (the database, most likely): back to the
    // queue for the recovery job, which re-drives it until it is out of
    // attempts. If this write fails too, the lease runs out to the same end.
    logger.error('Assessment run stopped on an error; queued again', err, { assessmentId });
    const requeued = await prisma.assessment
      .updateMany({
        where: { id: assessmentId, leaseToken: token, status: 'RUNNING' },
        data: {
          status: 'QUEUED',
          leaseToken: null,
          leaseExpiresAt: null,
          // Kept for the recovery job's give-up; cleared by a run that finishes.
          error: 'Its run stopped on an error that was not a judge’s.',
        },
      })
      .then(({ count }) => count === 1)
      .catch(() => false);
    // Not requeued: it was cancelled under the run, or its lease went elsewhere.
    outcome = requeued ? 'requeued' : await lostTo(assessmentId).catch(() => 'lease_lost' as const);
  }
  lease.release();
  if (outcome === 'cancelled') await freePlace(assessmentId, token).catch(() => undefined);
  startNextQueued(orgId, assessmentId);
  return outcome;
}

/**
 * Start the workspace's oldest queued assessment, now that this run's place
 * is free, without waiting for it. This is what picks up an assessment that
 * was queued while the workspace was at its limit; the recovery job is the
 * backstop. Never throws.
 */
function startNextQueued(orgId: string, finished: string): void {
  keepRunningAfterResponse(
    async () => {
      const next = await prisma.assessment.findFirst({
        where: {
          orgId,
          status: 'QUEUED',
          attempts: { lt: MAX_ATTEMPTS },
          id: { not: finished },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!next) return;
      const run = await beginAssessment(next.id);
      if (run) await run.done;
    },
    'app: next queued assessment',
    { orgId }
  );
}

type AssessmentRow = {
  id: string;
  frameworkVersionId: string;
  judges: string[];
  context: Prisma.JsonValue;
  createdByUserId: string | null;
  content: { text: string; sourceUrl: string | null };
  judgeRuns: StoredJudgeRun[];
};

type StoredJudgeRun = {
  judge: string;
  status: 'SUCCEEDED' | 'FAILED';
  errorCode: string | null;
  output: Prisma.JsonValue;
  costUsd: number;
  attempts: number;
  tokens: Prisma.JsonValue;
  provider: string | null;
  modelName: string | null;
};

const storedTokens = z.object({ input: z.number(), output: z.number() });

/** Thrown by the engine's own scoring: the same text would throw again. */
const NOT_SCORABLE = 'The framework could not score this text.';

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
    if (run.status === 'SUCCEEDED') {
      outputs[run.judge] = run.output;
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
  const scores = resultScores.safeParse(result);
  const status = failures > 0 ? 'PARTIAL' : 'COMPLETED';
  const written = await finish(row.id, token, {
    status,
    // The engine's own output, plain data by construction.
    result: result as Prisma.InputJsonValue,
    overall: scores.success ? scores.data.scores.overall : null,
    band: scores.success ? scores.data.scores.band : null,
    error: null,
  });
  if (!written) return await lostTo(row.id);
  return status === 'PARTIAL' ? 'partial' : 'completed';
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
      ? {
          // The engine's post-validated reply and its drop record: plain data.
          output: landed.reply.output as Prisma.InputJsonValue,
          dropped: landed.reply.drops as unknown as Prisma.InputJsonValue,
          errorCode: null,
          errorMessage: null,
        }
      : { errorCode: landed.code, errorMessage: landed.message }),
  };
  return await prisma.$transaction(async (tx) => {
    const { count } = await tx.assessment.updateMany({
      where: { id: assessmentId, leaseToken: token, status: { in: ['RUNNING', 'CANCELLED'] } },
      data: { costUsd: { increment: spentUsd } },
    });
    if (count === 0) return false;
    await tx.judgeRun.upsert({
      where: { assessmentId_judge: { assessmentId, judge: landed.slot } },
      create: { orgId, assessmentId, judge: landed.slot, ...data },
      update: data,
    });
    return true;
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
      const running = await tx.assessment.count({
        where: {
          orgId,
          // A cancelled run holds its place until its judges in flight land.
          status: { in: ['RUNNING', 'CANCELLED'] },
          leaseExpiresAt: { gt: now },
          id: { not: assessmentId },
        },
      });
      if (running >= RUNNING_PER_WORKSPACE) return null;

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
  /** False once a renewal found the lease gone (taken over, or cancelled). */
  readonly held: () => boolean;
  release: () => void;
}

/** Renew the lease every {@link LEASE_RENEW_MS} until released. */
function holdLease(assessmentId: string, token: string): Lease {
  let held = true;
  const timer = setInterval(() => {
    prisma.assessment
      .updateMany({
        where: { id: assessmentId, leaseToken: token, status: 'RUNNING' },
        data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
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

/** Write the final state, if the lease is still ours. Answers whether it was. */
async function finish(
  assessmentId: string,
  token: string,
  data: Omit<Prisma.AssessmentUpdateManyMutationInput, 'leaseToken' | 'leaseExpiresAt'>
): Promise<boolean> {
  const { count } = await prisma.assessment.updateMany({
    where: { id: assessmentId, leaseToken: token, status: 'RUNNING' },
    data: { ...data, completedAt: new Date(), leaseToken: null, leaseExpiresAt: null },
  });
  return count === 1;
}

/**
 * Cancel an assessment that has not finished. Answers whether it was
 * cancelled: `false` when it is already final, or not this workspace's.
 */
export async function cancelAssessment(assessmentId: string): Promise<boolean> {
  const { count } = await prisma.assessment.updateMany({
    where: { id: assessmentId, orgId: requireOrgId(), status: { in: ['QUEUED', 'RUNNING'] } },
    // The token and lease stay: the run that held them can still save the
    // judges it has in flight, and no other run can (see `saveJudgeRun`), and
    // the run keeps its place in the workspace's limit until they land
    // (`freePlace`), or its lease runs out.
    data: { status: 'CANCELLED', completedAt: new Date() },
  });
  return count === 1;
}

/** A cancelled run's judges have all landed: give up its place in the workspace's limit. */
async function freePlace(assessmentId: string, token: string): Promise<void> {
  await prisma.assessment.updateMany({
    where: { id: assessmentId, leaseToken: token, status: 'CANCELLED' },
    data: { leaseExpiresAt: null },
  });
}

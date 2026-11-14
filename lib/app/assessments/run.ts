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
 * **Re-driving.** A run starts only the judges with no `JudgeRun` row yet. A
 * judge that landed in an earlier run, whether it answered or failed, keeps
 * its row: a success is reused at assembly, and a failure stands (its
 * dimensions fall back to the quick scan and the result is `PARTIAL`).
 *
 * **Cancel** ({@link cancelAssessment}) sets `CANCELLED`. The run asks before
 * each judge starts, so no further judge is called; the ones in flight finish
 * and are saved, and the assessment is not written again.
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
import { engineForVersion } from '@/lib/app/assessments/engine';
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
  | 'lease_lost';

/** The two numbers every framework's result carries for listing (§9 `overall`, `band`). */
const resultScores = z.object({ scores: z.object({ overall: z.number(), band: z.string() }) });

export async function runAssessment(assessmentId: string): Promise<RunOutcome> {
  const orgId = requireOrgId();
  const token = await claim(assessmentId, orgId);
  if (!token) return 'not_claimed';

  const lease = holdLease(assessmentId, token);
  try {
    const row = await prisma.assessment.findUnique({
      where: { id: assessmentId },
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
    if (!row) return 'lease_lost';

    const scope = createPrivacyScope({
      scopeId: `assessment:${row.id}`,
      orgId,
      ...(row.createdByUserId ? { userId: row.createdByUserId } : {}),
    });
    return await runInPrivacyScope(scope, () => drive(row, orgId, token, lease));
  } catch (err) {
    // A failure the run cannot carry on past: the engine refusing the
    // version, or the database. Recorded when the lease is still ours; if the
    // write fails too, the lease runs out and the recovery job tries again.
    logger.error('Assessment run failed', err, { assessmentId });
    await finish(assessmentId, token, {
      status: 'FAILED',
      error: 'The assessment could not be run.',
    }).catch(() => undefined);
    return 'failed';
  } finally {
    lease.release();
  }
}

type AssessmentRow = {
  id: string;
  frameworkVersionId: string;
  judges: string[];
  context: Prisma.JsonValue;
  createdByUserId: string | null;
  content: { text: string; sourceUrl: string | null };
  judgeRuns: {
    judge: string;
    status: 'SUCCEEDED' | 'FAILED';
    output: Prisma.JsonValue;
    costUsd: number;
  }[];
};

async function drive(
  row: AssessmentRow,
  orgId: string,
  token: string,
  lease: Lease
): Promise<RunOutcome> {
  const loaded = await engineForVersion(row.frameworkVersionId);
  if (!loaded) {
    await finish(row.id, token, {
      status: 'FAILED',
      error: 'Its framework version can no longer be run.',
    });
    return 'failed';
  }
  const { engine, label } = loaded;
  const { text, sourceUrl } = row.content;
  const quick = engine.quickScan(text, row.context);

  const outputs: Record<string, unknown> = {};
  let failures = 0;
  let costUsd = 0;
  for (const run of row.judgeRuns) {
    costUsd += run.costUsd;
    if (run.status === 'SUCCEEDED') outputs[run.judge] = run.output;
    else failures += 1;
  }
  const done = new Set(row.judgeRuns.map((run) => run.judge));
  const missing = row.judges.filter((slot) => !done.has(slot));

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
      await saveJudgeRun(row.id, orgId, landed);
      if (landed.ok) {
        outputs[landed.slot] = landed.reply.output;
        costUsd += landed.reply.costUsd;
      } else {
        failures += 1;
      }
    },
  });
  if (fan.stopped || !(await stillOurs(row.id, token, lease))) {
    return (await statusOf(row.id)) === 'CANCELLED' ? 'cancelled' : 'lease_lost';
  }

  const result = engine.assemble(text, row.context, quick, outputs, sourceUrl);
  const scores = resultScores.safeParse(result);
  const status = failures > 0 ? 'PARTIAL' : 'COMPLETED';
  const written = await finish(row.id, token, {
    status,
    // The engine's own output, plain data by construction.
    result: result as Prisma.InputJsonValue,
    overall: scores.success ? scores.data.scores.overall : null,
    band: scores.success ? scores.data.scores.band : null,
    costUsd,
  });
  if (!written) return (await statusOf(row.id)) === 'CANCELLED' ? 'cancelled' : 'lease_lost';
  return status === 'PARTIAL' ? 'partial' : 'completed';
}

/** Save one judge's outcome. One row per judge per assessment; a re-run replaces it. */
async function saveJudgeRun(assessmentId: string, orgId: string, landed: LandedJudge) {
  const data = landed.ok
    ? {
        status: 'SUCCEEDED' as const,
        provider: landed.reply.provider,
        modelName: landed.reply.model,
        attempts: landed.reply.usage.attempts,
        costUsd: landed.reply.costUsd,
        tokens: { input: landed.reply.usage.input, output: landed.reply.usage.output },
        latencyMs: landed.latencyMs,
        // The engine's post-validated reply and its drop record: plain data.
        output: landed.reply.output as Prisma.InputJsonValue,
        dropped: landed.reply.drops as unknown as Prisma.InputJsonValue,
        errorCode: null,
        errorMessage: null,
      }
    : {
        status: 'FAILED' as const,
        latencyMs: landed.latencyMs,
        errorCode: landed.code,
        errorMessage: landed.message,
      };
  await prisma.judgeRun.upsert({
    where: { assessmentId_judge: { assessmentId, judge: landed.slot } },
    create: { orgId, assessmentId, judge: landed.slot, ...data },
    update: data,
  });
}

/** Tries at a claim that keeps losing serialization conflicts, before leaving it queued. */
const CLAIM_TRIES = 3;

/**
 * Take the lease, or answer `null`. See the file header for when a claim
 * succeeds. Claimers in one workspace conflict on its running count (the
 * recovery job claims several at once), so a conflict is retried a few times
 * before the assessment is left queued for a later tick.
 */
async function claim(assessmentId: string, orgId: string): Promise<string | null> {
  for (let tries = 1; ; tries += 1) {
    try {
      return await claimOnce(assessmentId, orgId);
    } catch (err) {
      if (!isSerializableConflict(err)) throw err;
      if (tries >= CLAIM_TRIES) return null;
    }
  }
}

async function claimOnce(assessmentId: string, orgId: string): Promise<string | null> {
  const now = new Date();
  return await prisma.$transaction(
    async (tx) => {
      const row = await tx.assessment.findUnique({
        where: { id: assessmentId },
        select: { status: true, leaseExpiresAt: true, attempts: true, startedAt: true },
      });
      if (!row || (row.status !== 'QUEUED' && row.status !== 'RUNNING')) return null;
      if (row.leaseExpiresAt && row.leaseExpiresAt > now) return null;
      if (row.attempts >= MAX_ATTEMPTS) return null;
      const running = await tx.assessment.count({
        where: {
          orgId,
          status: 'RUNNING',
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

async function statusOf(assessmentId: string) {
  const row = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { status: true },
  });
  return row?.status ?? null;
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
    data: { status: 'CANCELLED', completedAt: new Date(), leaseToken: null, leaseExpiresAt: null },
  });
  return count === 1;
}

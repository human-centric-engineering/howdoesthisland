/**
 * The editor's verdict on a comparison (t-88, `.context/app/comparisons.md`):
 * which draft lands better with this reader, and why.
 *
 * Scores per appeal say where drafts differ, not which to send. Once every
 * draft's review has ended, the editor reads the finished reviews and says
 * which draft to send, the way it writes a review's summary (`editor.ts`).
 * The engine builds the request and checks the reply (`buildVerdictRequest`,
 * `validateVerdictReply`), so another framework writes its own; the call is
 * `callAgent` under the `editor` role, so the same binding, approved-list,
 * budget and rate-limit checks apply. Its cost rows carry `comparisonId` and
 * `editor: 'verdict'`, and no `assessmentId`, so no draft's charge counts them.
 *
 * **When it runs.** Once every draft is final (or purged) and at least two
 * completed. A draft that ended `partial` was reviewed by fewer AI reviewers
 * than the others, so weighing it beside them would not be like for like;
 * it is not shown to the editor. With fewer than two completed, the
 * comparison has no verdict and says why (`SKIPPED`, `too_few_completed`).
 * Nor does one whose drafts call fewer than `EDITOR_MIN_JUDGES` AI reviewers
 * (`too_few_judges`, decided when it is made, and nothing held): the editor
 * writes no summary for such a review, and a paid call to weigh them is not
 * what a writer asking for a cheap review chose.
 *
 * **Started by** the end of each draft's run (`run.ts`, and a cancel that
 * ends a queued draft), and by the recovery tick ({@link recoverVerdicts}),
 * which starts any due verdict that has none: one whose last draft ended in
 * a process that died before starting it, or ended by a delete. A claim
 * moves it `WAITING` → `RUNNING` under a lease, matching the attempt count it
 * read, so it is never run twice at once: of two starters, one claims it.
 *
 * **It survives the process ending.** The lease is renewed while the call
 * runs; one whose lease ran out lost its process, and recovery claims it
 * again and asks again, up to `MAX_ATTEMPTS` starts. Past them it is ended
 * `FAILED` (`lost`) and charged for what its attempts recorded.
 *
 * **Charged once.** The write that ends it (`COMPLETED` or `FAILED`) charges
 * its cost rows in the same transaction, under its own reference
 * (`chargeComparisonVerdict`): every attempt's rows, since a restarted
 * verdict's earlier attempts wrote theirs before it was restarted. A call
 * that ends after its verdict was claimed again does not charge: the attempt
 * that ends it does, its rows included. A comparison deleted under its call
 * is charged by that call, since nothing else will.
 *
 * Runs in the caller's tenant context; every read and write names the org.
 */
import type { Prisma } from '@prisma/client';
import { keepRunningAfterResponse } from '@/lib/api/after-response';
import { EDITOR_MIN_JUDGES } from '@/lib/app/assessments/editor';
import { engineForVersion, type VersionEngine } from '@/lib/app/assessments/engine';
import {
  LEASE_MS,
  LEASE_RENEW_MS,
  MAX_ATTEMPTS,
  RECOVERY_BATCH,
} from '@/lib/app/assessments/limits';
import { chargeComparisonVerdict } from '@/lib/app/credits/charge';
import type { ComparisonVerdict, FrameworkEngine, VerdictDraft } from '@/lib/app/frameworks/engine';
import { EDITOR_AGENT_SLUG } from '@/lib/app/judges/agents';
import { callAgent, JudgeRunError, streamCeilingUsd } from '@/lib/app/judges/run-judge';
import { parseProjectContext, renderProjectContext } from '@/lib/app/projects/context';
import { estimateVerdictCost } from '@/lib/app/usage/budget';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { createPrivacyScope, runInPrivacyScope } from '@/lib/orchestration/privacy/scope';
import { requireOrgId } from '@/lib/tenancy/context';

/** Why a comparison has no verdict, for `SKIPPED`. */
export type VerdictSkipReason =
  /** Fewer than two of its drafts completed: there is nothing to weigh. */
  | 'too_few_completed'
  /** Its drafts call too few AI reviewers for the editor to run (`EDITOR_MIN_JUDGES`). */
  | 'too_few_judges'
  /** Made before verdicts were: none was held or asked for. */
  | 'predates_verdicts';

/** Why a verdict failed, for `FAILED`: the call's code, `lost`, or `internal_error`. */
export const LOST_VERDICT_CODE = 'lost';

/** The editor's call, as `callAgent` and its ceiling name it. */
const EDITOR_CALL = {
  agentSlug: EDITOR_AGENT_SLUG,
  role: 'editor',
  name: 'editor',
  target: 'the editor',
} as const;

/** The cost rows' `editor` tag, beside a summary's `summary` and a rewrite's. */
export const VERDICT_COST_TAG = 'verdict';

/** The judges a comparison's drafts call, as few as the editor will weigh. */
export const verdictRuns = (judges: readonly string[]): boolean =>
  judges.length >= EDITOR_MIN_JUDGES;

/**
 * What a comparison's verdict is held at when it is asked for, in USD
 * (`estimateVerdictCost`): the workspace's recent verdicts, or with none,
 * what this one can cost at most, its request built from each draft's free
 * quick scan (the reviews do not exist yet). Low by what the judges add to
 * each review the editor is shown, and the output ceiling dominates. `0`
 * when the verdict will not run.
 */
export async function estimateComparisonVerdict(
  orgId: string,
  engine: FrameworkEngine,
  ctx: unknown,
  drafts: readonly { text: string; label?: string | null }[],
  judges: readonly string[]
): Promise<number> {
  if (!verdictRuns(judges)) return 0;
  return estimateVerdictCost(orgId, async () => {
    const shown: VerdictDraft[] = drafts.map((d, position) => ({
      position,
      label: d.label ?? null,
      text: d.text,
      result: engine.assemble(d.text, ctx, engine.quickScan(d.text, ctx)),
    }));
    return streamCeilingUsd(EDITOR_CALL, engine.buildVerdictRequest(shown, ctx));
  });
}

/** The comparison as a verdict reads it. */
const VERDICT_SET_SELECT = {
  id: true,
  createdAt: true,
  frameworkVersionId: true,
  context: true,
  judges: true,
  createdByUserId: true,
  verdictStatus: true,
  verdictAttempts: true,
  verdictLeaseExpiresAt: true,
  project: { select: { brief: true } },
  members: {
    orderBy: { position: 'asc' },
    select: {
      position: true,
      label: true,
      assessment: {
        select: { status: true, result: true, content: { select: { text: true } } },
      },
    },
  },
} satisfies Prisma.AssessmentSetSelect;

type VerdictSet = Prisma.AssessmentSetGetPayload<{ select: typeof VERDICT_SET_SELECT }>;

const UNFINISHED = new Set(['QUEUED', 'RUNNING']);

/** A verdict a starter may claim: waiting, or running with its process lost. */
const claimable = (now: Date): Prisma.AssessmentSetWhereInput => ({
  OR: [
    { verdictStatus: 'WAITING' },
    {
      verdictStatus: 'RUNNING',
      OR: [{ verdictLeaseExpiresAt: null }, { verdictLeaseExpiresAt: { lt: now } }],
    },
  ],
});

/** What a start did. */
export type VerdictStart =
  /** Not due: a draft is still queued or running, or it is not this starter's to claim. */
  'not_due' | 'skipped' | 'gave_up' | 'started';

/**
 * Start the comparison `setId`'s verdict if it is due, without waiting for
 * the call: see "When it runs" and "Started by" in the file header.
 * Idempotent: a verdict ended, running under a live lease, or claimed by
 * another starter is left alone.
 */
export async function startVerdict(setId: string, now: Date = new Date()): Promise<VerdictStart> {
  const orgId = requireOrgId();
  const set = await prisma.assessmentSet.findFirst({
    where: { id: setId, orgId, kind: 'COMPARISON', ...claimable(now) },
    select: VERDICT_SET_SELECT,
  });
  if (!set) return 'not_due';
  if (set.members.some((m) => m.assessment && UNFINISHED.has(m.assessment.status))) {
    return 'not_due';
  }
  // Read as `claimable` read it: a starter that read it before this one
  // claimed or ended it matches nothing.
  const mine: Prisma.AssessmentSetWhereInput = {
    id: setId,
    orgId,
    verdictAttempts: set.verdictAttempts,
    ...claimable(now),
  };

  const drafts = completedDrafts(set);
  if (drafts.length < 2) {
    const { count } = await prisma.assessmentSet.updateMany({
      where: mine,
      data: {
        verdictStatus: 'SKIPPED',
        verdictReason: 'too_few_completed' satisfies VerdictSkipReason,
        verdictCompletedAt: now,
        verdictLeaseExpiresAt: null,
      },
    });
    return count === 1 ? 'skipped' : 'not_due';
  }
  if (set.verdictAttempts >= MAX_ATTEMPTS) {
    const ended = await end(orgId, set, mine, {
      status: 'FAILED',
      verdict: null,
      reason: LOST_VERDICT_CODE,
      model: null,
    });
    return ended ? 'gave_up' : 'not_due';
  }

  const attempt = set.verdictAttempts + 1;
  const { count } = await prisma.assessmentSet.updateMany({
    where: mine,
    data: {
      verdictStatus: 'RUNNING',
      verdictAttempts: attempt,
      verdictLeaseExpiresAt: new Date(now.getTime() + LEASE_MS),
    },
  });
  if (count === 0) return 'not_due';

  const scope = createPrivacyScope({
    scopeId: `comparison:${setId}`,
    orgId,
    ...(set.createdByUserId ? { userId: set.createdByUserId } : {}),
  });
  keepRunningAfterResponse(
    () => runInPrivacyScope(scope, () => drive(orgId, set, drafts, attempt)),
    'app: comparison verdict',
    { setId }
  );
  return 'started';
}

/** The drafts the editor weighs: those whose review completed, in position order. */
function completedDrafts(set: VerdictSet): VerdictDraft[] {
  return set.members.flatMap((m) =>
    m.assessment?.status === 'COMPLETED' && m.assessment.result !== null
      ? [
          {
            position: m.position,
            label: m.label,
            text: m.assessment.content.text,
            result: m.assessment.result,
          },
        ]
      : []
  );
}

/**
 * Start the verdicts the review `assessmentId` was the last draft of (it has
 * just ended), after the response. Never throws.
 */
export function startVerdictsAfterReview(orgId: string, assessmentId: string): void {
  keepRunningAfterResponse(
    async () => {
      const sets = await prisma.assessmentSetMember.findMany({
        where: { orgId, assessmentId, set: { verdictStatus: 'WAITING' } },
        select: { setId: true },
      });
      for (const { setId } of sets) await startVerdict(setId);
    },
    'app: comparison verdict start',
    { assessmentId }
  );
}

/**
 * Start every due verdict in the workspace that has none, at most
 * {@link RECOVERY_BATCH} a pass: the recovery tick's backstop for a start
 * lost with its process, and for one whose last draft ended without a run
 * to start it (deleted). Does not wait for the calls it starts.
 */
export async function recoverVerdicts(
  now: Date = new Date()
): Promise<{ started: number; skipped: number; gaveUp: number }> {
  const orgId = requireOrgId();
  const due = await prisma.assessmentSet.findMany({
    where: {
      orgId,
      kind: 'COMPARISON',
      ...claimable(now),
      members: { none: { assessment: { status: { in: ['QUEUED', 'RUNNING'] } } } },
    },
    orderBy: { createdAt: 'asc' },
    take: RECOVERY_BATCH,
    select: { id: true },
  });
  const tally = { started: 0, skipped: 0, gaveUp: 0 };
  for (const { id } of due) {
    try {
      const start = await startVerdict(id, now);
      if (start === 'started') tally.started += 1;
      else if (start === 'skipped') tally.skipped += 1;
      else if (start === 'gave_up') tally.gaveUp += 1;
    } catch (err) {
      // Left for the next pass; the rest of this one goes on.
      logger.error('Recovery could not start a comparison verdict', err, { setId: id });
    }
  }
  return tally;
}

/** How a verdict's call ended. */
interface Ending {
  status: 'COMPLETED' | 'FAILED';
  verdict: ComparisonVerdict | null;
  reason: string | null;
  model: string | null;
}

/** Ask the editor, renewing the lease while it answers, and end the verdict. Never rejects. */
async function drive(
  orgId: string,
  set: VerdictSet,
  drafts: VerdictDraft[],
  attempt: number
): Promise<void> {
  const mine: Prisma.AssessmentSetWhereInput = {
    id: set.id,
    orgId,
    verdictStatus: 'RUNNING',
    verdictAttempts: attempt,
  };
  const timer = setInterval(() => {
    prisma.assessmentSet
      .updateMany({
        where: mine,
        data: { verdictLeaseExpiresAt: new Date(Date.now() + LEASE_MS) },
      })
      .catch((err: unknown) => {
        // Not fatal: the lease outlasts several renewals, and the next may succeed.
        logger.warn('A comparison verdict’s lease could not be renewed', {
          setId: set.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, LEASE_RENEW_MS);
  timer.unref?.();

  let ending: Ending;
  try {
    ending = await ask(set, drafts);
  } finally {
    clearInterval(timer);
  }
  for (let tries = 1; tries <= 2; tries += 1) {
    try {
      await end(orgId, set, mine, ending);
      return;
    } catch (err) {
      // Twice failed: left `RUNNING`; once its lease runs out, recovery asks again.
      logger.error('A comparison verdict could not be ended', err, { setId: set.id, tries });
    }
  }
}

/** The editor's call and its ending. Never throws. */
async function ask(set: VerdictSet, drafts: VerdictDraft[]): Promise<Ending> {
  let loaded: VersionEngine | null;
  try {
    loaded = await engineForVersion(set.frameworkVersionId);
  } catch (err) {
    logger.error('A comparison verdict could not load its framework', err, { setId: set.id });
    return { status: 'FAILED', verdict: null, reason: 'internal_error', model: null };
  }
  if (!loaded) {
    logger.warn('A comparison verdict’s framework version can no longer be run', { setId: set.id });
    return { status: 'FAILED', verdict: null, reason: 'internal_error', model: null };
  }
  const { engine, label } = loaded;
  // The project's brief as it is now, as a rewrite reads it: each draft's
  // passages were found for its own text, so none stands for them all.
  const projectContext = set.project
    ? renderProjectContext(
        parseProjectContext({ documents: [], passages: [], brief: set.project.brief })
      )
    : null;
  try {
    const reply = await callAgent({
      ...EDITOR_CALL,
      request: () => engine.buildVerdictRequest(drafts, set.context, projectContext),
      validate: (raw) => {
        const checked = engine.validateVerdictReply(raw, drafts);
        return checked.ok ? { output: checked.output, drops: checked.drops } : null;
      },
      costMetadata: { editor: VERDICT_COST_TAG, comparisonId: set.id },
      phase: 'editor',
      frameworkVersion: label,
      userId: set.createdByUserId,
    });
    return { status: 'COMPLETED', verdict: reply.output, reason: null, model: reply.model };
  } catch (err) {
    if (err instanceof JudgeRunError) {
      logger.warn('The editor did not write a comparison verdict', {
        setId: set.id,
        code: err.code,
        message: err.message,
      });
      return {
        status: 'FAILED',
        verdict: null,
        reason: err.code,
        model: err.spend?.model ?? null,
      };
    }
    logger.error('A comparison verdict failed', err, { setId: set.id });
    return { status: 'FAILED', verdict: null, reason: 'internal_error', model: null };
  }
}

/** The verdict as it is stored, and read back by `views.ts`. */
const storedVerdict = (v: ComparisonVerdict): Prisma.InputJsonObject => ({
  draft: v.draft,
  why: v.why,
  appeals: v.appeals.map((a) => ({ appeal: a.appeal, why: a.why })),
});

/**
 * End the verdict matching `where` and charge it, in one transaction:
 * see "Charged once" in the file header. Answers whether this write ended it.
 */
async function end(
  orgId: string,
  set: Pick<VerdictSet, 'id' | 'createdAt'>,
  where: Prisma.AssessmentSetWhereInput,
  ending: Ending
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const rows = {
      orgId,
      createdAt: { gte: set.createdAt },
      metadata: { path: ['comparisonId'], equals: set.id },
    } satisfies Prisma.AiCostLogWhereInput;
    const { _sum } = await tx.aiCostLog.aggregate({ where: rows, _sum: { totalCostUsd: true } });
    const { count } = await tx.assessmentSet.updateMany({
      where,
      data: {
        verdictStatus: ending.status,
        ...(ending.verdict ? { verdict: storedVerdict(ending.verdict) } : {}),
        verdictReason: ending.reason,
        verdictModel: ending.model,
        verdictCostUsd: _sum.totalCostUsd ?? 0,
        verdictCompletedAt: new Date(),
        verdictLeaseExpiresAt: null,
      },
    });
    // Claimed again since (its lease ran out): the attempt that ends it charges.
    const gone =
      count === 0 && (await tx.assessmentSet.count({ where: { id: set.id, orgId } })) === 0;
    if (count === 1 || gone) await chargeComparisonVerdict(tx, orgId, set.id, set.createdAt);
    return count === 1;
  });
}

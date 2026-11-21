/**
 * The assessments API's service (t-24): the routes parse, this does.
 *
 * - **Stored** (the default): intake, then `enqueueAssessment`. Without
 *   `wait` the run starts after the response, which is a 202. With `wait`
 *   the run is claimed in this request and awaited for {@link WAIT_BOUND_MS};
 *   a run still going then is handed to `after()` and the answer is a 202 the
 *   caller polls or streams. A run the workspace cannot start yet (at its
 *   limit) is watched for the same bound.
 * - **Kept nowhere** (`store: false`): synchronous only. The quick scan and
 *   the judges' fan-out run with no rows (`runJudges`), so no `Content`,
 *   `Assessment` or `JudgeRun` is written. The cost rows still are, marked
 *   `ephemeral: true` and with no `assessmentId` (§8.2). A run that calls
 *   judges holds one of the workspace's running places while it runs, shared
 *   with stored runs (`places.ts`, t-28); with none free it is refused with
 *   `WorkspaceBusyError`, which the route answers 429 `WORKSPACE_BUSY`. It is
 *   charged in CopyCredits for its cost rows once it ends, however it ends,
 *   before its budget hold is released (t-58).
 *
 * Runs in the caller's tenant context (the route's guard). Every refusal is
 * an `APIError`, so the guard answers it with its status and code.
 */
import type { AssessmentStatus } from '@prisma/client';
import { z } from 'zod';
import { APIError, NotFoundError } from '@/lib/api/errors';
import { keepRunningAfterResponse } from '@/lib/api/after-response';
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import { JudgeProfileError, type JudgeProfile } from '@/lib/app/frameworks/engine';
import { countWords, extractText } from '@/lib/app/intake/extract-text';
import { fetchPage } from '@/lib/app/intake/fetch-page';
import { runJudges } from '@/lib/app/assessments/fan-out';
import { AssessmentInputError, type AssessmentInputErrorCode } from '@/lib/app/assessments/errors';
import {
  enqueueAssessment,
  startAssessmentInBackground,
  storedProfileName,
} from '@/lib/app/assessments/enqueue';
import {
  beginAssessment,
  cancelAssessment,
  NOT_SCORABLE,
  scoresOf,
  startNextQueued,
} from '@/lib/app/assessments/run';
import { withPlace } from '@/lib/app/assessments/places';
import {
  assertReviewFits,
  reserveReviewBudget,
  type BudgetHold,
  type ReviewRate,
} from '@/lib/app/usage/budget';
import { chargeEphemeralRun, chargeStoredReview } from '@/lib/app/credits/charge';
import { logger } from '@/lib/logging';
import { createPrivacyScope, runInPrivacyScope } from '@/lib/orchestration/privacy/scope';
import { assessableText } from '@/lib/app/assessments/text';
import { CHARGE_SWEEP_MS, POLL_MS, WAIT_BOUND_MS } from '@/lib/app/assessments/limits';
import { versionToScore, type VersionToScore } from '@/lib/app/assessments/api/version';
import { deleteReportPdfs, sweepReportPdfs } from '@/lib/app/reports/pdf/cache';
import type { CreateAssessmentBody } from '@/lib/app/assessments/api/validations';
import {
  isFinal,
  readAssessment,
  stateOf,
  type AssessmentDetail,
  type EphemeralAssessment,
  type JudgeRunView,
} from '@/lib/app/assessments/api/views';

/** How each refusal from the library reaches a caller. */
const INPUT_ERRORS: Record<AssessmentInputErrorCode, { code: string; status: number }> = {
  content_empty: { code: 'CONTENT_EMPTY', status: 400 },
  // The code intake uses for the same limit on an upload (`IntakeErrorCodes`).
  content_too_long: { code: 'TEXT_TOO_LONG', status: 422 },
  version_not_found: { code: 'FRAMEWORK_VERSION_NOT_FOUND', status: 404 },
  profile_unknown: { code: 'PROFILE_UNKNOWN', status: 400 },
};

/** An `AssessmentInputError` as the `APIError` a route answers with; anything else as it is. */
export function asApiError(err: unknown): unknown {
  if (!(err instanceof AssessmentInputError)) return err;
  const { code, status } = INPUT_ERRORS[err.code];
  return new APIError(err.message, code, status);
}

/** Run `fn`, answering a library refusal as its `APIError`. */
export async function refusingAsApi<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw asApiError(err);
  }
}

/** The caller's context checked against the version, or `CONTEXT_INVALID` with each problem. */
export function contextFor(resolved: VersionToScore, input: unknown): unknown {
  const parsed = resolved.engine.parseContext(input);
  if (!parsed.ok) {
    throw new APIError('The context does not fit this framework version.', 'CONTEXT_INVALID', 400, {
      issues: parsed.issues,
    });
  }
  return parsed.ctx;
}

/** The judges a profile or list resolves to, or `PROFILE_UNKNOWN`. */
export function judgesFor(resolved: VersionToScore, profile: JudgeProfile): readonly string[] {
  try {
    return resolved.engine.activeJudgeSlots(profile);
  } catch (err) {
    if (err instanceof JudgeProfileError) throw new APIError(err.message, 'PROFILE_UNKNOWN', 400);
    throw err;
  }
}

/** The context as the row stores it: the engine's parse, which is plain JSON by construction. */
const jsonObject = z.record(z.string(), z.json());
function storedContext(ctx: unknown): z.infer<typeof jsonObject> {
  return jsonObject.parse(JSON.parse(JSON.stringify(ctx)));
}

export interface Caller {
  /** A real `User.id`. */
  userId: string;
  /** The API key the request came through, if it did. */
  apiKeyId: string | null;
}

interface Source {
  text: string;
  title: string | null;
  sourceKind: 'TEXT' | 'FILE' | 'URL';
  sourceUrl: string | null;
  fileName: string | null;
}

/** Turn the request's source into text: pasted, fetched (D14) or read from a file. */
async function intake(source: CreateAssessmentBody['source']): Promise<Source> {
  if ('text' in source) {
    return { text: source.text, title: null, sourceKind: 'TEXT', sourceUrl: null, fileName: null };
  }
  if ('url' in source) {
    const page = await fetchPage(source.url);
    return {
      text: page.text,
      title: page.title,
      sourceKind: 'URL',
      sourceUrl: page.url,
      fileName: null,
    };
  }
  const file = await extractText(Buffer.from(source.file.base64, 'base64'), source.file.name);
  return {
    text: file.text,
    title: file.title,
    sourceKind: 'FILE',
    sourceUrl: null,
    fileName: source.file.name,
  };
}

export type CreatedAssessment =
  | { kind: 'stored'; final: boolean; assessment: AssessmentDetail }
  | { kind: 'ephemeral'; assessment: EphemeralAssessment };

/** A request checked as far as it can be without fetching or reading anything. */
export interface PreparedAssessment {
  resolved: VersionToScore;
  ctx: unknown;
  profile: JudgeProfile;
  judges: readonly string[];
  /**
   * What the request holds of the workspace's budget (t-50), or `null` when
   * it holds nothing: taken by {@link holdReviewBudget}. {@link createAssessment}
   * releases it once the review is stored or, kept nowhere, once its run
   * ends; whoever took it releases it again however the request ends, which
   * is safe.
   */
  hold: BudgetHold | null;
  /** The cost per judge the budget check read, for the hold's check to reuse. */
  rate: ReviewRate | null;
}

/**
 * Everything that can be refused before anything is fetched, read or spent:
 * the version, the context, the profile, pasted text, and a review that would
 * pass the workspace's monthly budget (402 `BUDGET_EXCEEDED`, t-49). The route
 * counts a request against the per-user cap only once this has passed, then
 * holds its estimate with {@link holdReviewBudget} (t-50). Holds nothing, so a
 * request the route then refuses (no place free, the per-user cap) never
 * held budget another request was refused for.
 */
export async function prepareAssessment(body: CreateAssessmentBody): Promise<PreparedAssessment> {
  const resolved = await versionToScore(body);
  const ctx = contextFor(resolved, body.context);
  const profile: JudgeProfile = body.judges ?? body.profile ?? 'full';
  const judges = judgesFor(resolved, profile);
  // Pasted text can be refused now; a page or a file only once it is read.
  if ('text' in body.source) {
    const { text } = body.source;
    await refusingAsApi(() => assessableText(text));
  }
  // Last, so a request refused for anything above is refused for that.
  const rate = await assertReviewFits(
    requireOrgId(),
    storedProfileName(profile),
    judges.length,
    body.store !== false
  );
  return { resolved, ctx, profile, judges, hold: null, rate };
}

/**
 * Check `prepared` against the workspace's budget again and hold its estimate
 * (t-50) under the lock that orders requests arriving together, as
 * `prepared.hold`: the last step before {@link createAssessment}. Throws 402
 * `BUDGET_EXCEEDED` when requests checked before it took what was left.
 */
export async function holdReviewBudget(
  body: CreateAssessmentBody,
  prepared: PreparedAssessment
): Promise<void> {
  prepared.hold = await reserveReviewBudget(
    requireOrgId(),
    storedProfileName(prepared.profile),
    prepared.judges.length,
    body.store !== false,
    prepared.rate ?? undefined
  );
}

export async function createAssessment(
  body: CreateAssessmentBody,
  prepared: PreparedAssessment,
  caller: Caller,
  options: { boundMs?: number; signal?: AbortSignal } = {}
): Promise<CreatedAssessment> {
  const { resolved, ctx, profile, hold } = prepared;
  if (body.store === false) {
    try {
      return await createEphemeral(body, prepared, caller, options.signal);
    } finally {
      // Held while the run spends: it has no row to be held by (t-51).
      await hold?.release();
    }
  }

  let assessmentId: string;
  try {
    const source = await intake(body.source);
    ({ assessmentId } = await refusingAsApi(() =>
      enqueueAssessment({
        content: {
          text: source.text,
          title: body.title ?? source.title,
          sourceKind: source.sourceKind,
          sourceUrl: source.sourceUrl,
          fileName: source.fileName,
        },
        frameworkVersionId: resolved.version.id,
        profile,
        context: storedContext(ctx),
        requestedVia: caller.apiKeyId ? 'API' : 'APP',
        apiKeyId: caller.apiKeyId,
        userId: caller.userId,
      })
    ));
  } finally {
    // Stored, the review's row is held in its place; refused, nothing is.
    // Before the run is claimed, whose check would hold this request's hold
    // against the review it became.
    await hold?.release();
  }

  if (body.wait === true) {
    await waitForRun(assessmentId, options.boundMs ?? WAIT_BOUND_MS, options.signal);
  } else {
    startAssessmentInBackground(assessmentId);
  }
  const assessment = await readAssessment(assessmentId);
  // Deleted under us, by another request, between the write and this read.
  if (!assessment) throw new NotFoundError('Assessment not found');
  return { kind: 'stored', final: isFinal(assessment.status), assessment };
}

/** A `store: false` review: intake, then the run, holding one of the workspace's places. */
async function createEphemeral(
  body: CreateAssessmentBody,
  prepared: PreparedAssessment,
  caller: Caller,
  signal?: AbortSignal
): Promise<CreatedAssessment> {
  const { resolved, ctx, profile, judges } = prepared;
  const source = await intake(body.source);
  const runId = crypto.randomUUID();
  const run = () =>
    refusingAsApi(() =>
      runEphemeral(resolved, source, ctx, profile, judges, caller, runId, signal)
    );
  // A run that calls judges takes one of the workspace's places, or is
  // refused with `WorkspaceBusyError` (t-28). The quick scan calls no model.
  const orgId = requireOrgId();
  if (judges.length === 0) return { kind: 'ephemeral', assessment: await run() };
  const began = new Date();
  try {
    const assessment = await withPlace(orgId, run, () => startNextQueued(orgId));
    return { kind: 'ephemeral', assessment };
  } finally {
    // However it ended: what its judges were billed is spent (t-58). Before
    // the caller releases the hold, so it is held or charged throughout. A
    // charge that fails here is taken by the recovery job, from the rows.
    await chargeEphemeralRun(orgId, runId, began).catch((err: unknown) =>
      logger.error('Could not charge a store: false review', err, { runId })
    );
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Claim and run the assessment in this request, for at most `boundMs`. A
 * run still going at the bound carries on after the response. One the
 * workspace could not start yet is watched for the bound instead: the next
 * run in the workspace to end starts it.
 */
async function waitForRun(
  assessmentId: string,
  boundMs: number,
  signal?: AbortSignal
): Promise<void> {
  const deadline = Date.now() + boundMs;
  const run = await beginAssessment(assessmentId);
  if (run) {
    keepRunningAfterResponse(run.done, 'app: assessment run', { assessmentId });
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The bound, or the caller going away: either way the run carries on.
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    await Promise.race([run.done.then(() => undefined), bound]);
    clearTimeout(timer);
    return;
  }
  const orgId = requireOrgId();
  while (Date.now() < deadline && !signal?.aborted) {
    const row = await prisma.assessment.findUnique({
      where: { id: assessmentId, orgId },
      select: { status: true },
    });
    if (!row || isFinal(stateOf(row.status))) return;
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  }
}

/** The quick scan and the judges with no rows: the result, and the cost rows alone. */
async function runEphemeral(
  resolved: VersionToScore,
  source: Source,
  ctx: unknown,
  profile: JudgeProfile,
  judges: readonly string[],
  caller: Caller,
  runId: string,
  signal?: AbortSignal
): Promise<EphemeralAssessment> {
  const text = assessableText(source.text);
  const { engine, label } = resolved;
  // Nothing has been spent yet: the same text would throw again, so refuse it.
  const quick = notScorable(() => engine.quickScan(text, ctx), 0);
  // Who the calls are for, as the stored run says it (`run.ts`), so the
  // privacy layer applies the same policy and the user's own known values.
  const scope = createPrivacyScope({
    scopeId: `assessment:ephemeral:${runId}`,
    orgId: requireOrgId(),
    userId: caller.userId,
  });
  const fan = await runInPrivacyScope(scope, () =>
    runJudges({
      engine,
      frameworkVersion: label,
      text,
      ctx,
      slots: judges,
      userId: caller.userId,
      ephemeral: true,
      // Tells this run's cost rows apart, so usage can count the reviews
      // kept nowhere, which have no other record (t-48).
      costTags: { ephemeralRun: runId },
      // A caller gone away starts no further judge: nobody is left to answer.
      shouldContinue: () => Promise.resolve(!signal?.aborted),
    })
  );
  if (fan.stopped) {
    throw new APIError('The request was closed before the judges ran.', 'REQUEST_CLOSED', 499);
  }
  const outputs: Record<string, unknown> = {};
  const runs = new Map<string, JudgeRunView>();
  let costUsd = 0;
  for (const landed of fan.landed) {
    const spend = landed.ok ? landed.reply : landed.spend;
    costUsd += spend?.costUsd ?? 0;
    if (landed.ok) outputs[landed.slot] = landed.reply.output;
    runs.set(landed.slot, {
      judge: landed.slot,
      status: landed.ok ? 'succeeded' : 'failed',
      model: spend?.model ?? null,
      costUsd: spend?.costUsd ?? 0,
      latencyMs: landed.latencyMs,
      errorCode: landed.ok ? null : landed.code,
    });
  }
  const result = notScorable(
    () => engine.assemble(text, ctx, quick, outputs, source.sourceUrl),
    costUsd
  );
  const failed = [...runs.values()].some((r) => r.status === 'failed');
  return {
    stored: false,
    status: failed ? 'partial' : 'completed',
    profile: storedProfileName(profile),
    judges: [...judges],
    framework: resolved.framework,
    wordCount: countWords(text),
    ...scoresOf(result),
    costUsd,
    context: ctx,
    result,
    judgeRuns: judges.flatMap((slot) => runs.get(slot) ?? []),
  };
}

/**
 * The engine's own scoring, or `NOT_SCORABLE` (422) when it throws: the
 * stored run's `FAILED` (`run.ts`), with no row to record it on. `costUsd`
 * is what the judges had already spent.
 */
export function notScorable<T>(score: () => T, costUsd: number): T {
  try {
    return score();
  } catch (err) {
    logger.error('Assessment could not be scored, with no row to record it', err, { costUsd });
    throw new APIError(NOT_SCORABLE, 'NOT_SCORABLE', 422, { costUsd });
  }
}

/** One of this workspace's assessments, or 404. */
export async function getAssessment(id: string): Promise<AssessmentDetail> {
  const assessment = await readAssessment(id);
  if (!assessment) throw new NotFoundError('Assessment not found');
  return assessment;
}

/**
 * Cancel a queued or running assessment. Judges already in flight finish and
 * are saved, since their cost is spent; no further judge starts (`run.ts`).
 */
export async function cancel(id: string): Promise<AssessmentDetail> {
  const cancelled = await cancelAssessment(id);
  // Read after the attempt, so a refusal names the state that refused it.
  const assessment = await getAssessment(id);
  if (!cancelled) {
    throw new APIError(`This assessment is already ${assessment.status}.`, 'ASSESSMENT_FINAL', 409);
  }
  return assessment;
}

/** Whether a review being deleted has not been charged yet: see {@link remove}. */
function chargeableOnDelete(
  row: { status: AssessmentStatus; completedAt: Date | null; leaseExpiresAt: Date | null },
  now: Date
): boolean {
  if (row.status === 'QUEUED' || row.status === 'RUNNING') return true;
  // A cancel that ended it charged it then, and cleared the lease (`run.ts`).
  return (
    row.status === 'CANCELLED' &&
    row.leaseExpiresAt !== null &&
    row.completedAt !== null &&
    row.completedAt.getTime() > now.getTime() - CHARGE_SWEEP_MS
  );
}

/**
 * Delete an assessment, its judge runs, and its text unless another
 * assessment shares it. Allowed in any state: a run still going writes only
 * under its lease, to a row that is gone, so it stores nothing more. Its
 * cost rows stay, as the usage record, and what they say it spent is
 * charged here unless it was already (t-58).
 *
 * Its cached report PDFs go first (t-31). If storage refuses, the row stays
 * and the delete fails, so trying again finishes it: the other order could
 * leave a PDF of content that no longer exists, with nothing left to find it
 * by. They are swept once more after the row, for a render that raced the
 * delete (`sweepReportPdfs`).
 */
export async function remove(id: string): Promise<{ deleted: true }> {
  const orgId = requireOrgId();
  // Not found before anything else, so a missing id is 404 whatever state
  // storage is in.
  if ((await prisma.assessment.count({ where: { id, orgId } })) === 0) {
    throw new NotFoundError('Assessment not found');
  }
  await deleteReportPdfs(orgId, id);
  await prisma.$transaction(async (tx) => {
    const row = await tx.assessment.findUnique({
      where: { id, orgId },
      select: {
        contentId: true,
        createdAt: true,
        status: true,
        completedAt: true,
        leaseExpiresAt: true,
      },
    });
    if (!row) throw new NotFoundError('Assessment not found');
    // A delete that lost a race with another one has nothing left: 404.
    const { count } = await tx.assessment.deleteMany({ where: { id, orgId } });
    if (count === 0) throw new NotFoundError('Assessment not found');
    // Charged for what it spent (t-58) when it has not been yet: still open,
    // or cancelled with its lease not cleared. Charged here even while a run
    // holds it, since that run's process may be gone, and nothing reads a
    // deleted row's spend again; judges still in flight are missed
    // (`charge.ts`). A final review was charged as it ended, or ended before
    // reviews were charged: not charged again.
    if (chargeableOnDelete(row, new Date())) {
      await chargeStoredReview(tx, orgId, id, row.createdAt);
    }
    await tx.content.deleteMany({
      where: { id: row.contentId, orgId, assessments: { none: {} } },
    });
  });
  await sweepReportPdfs(orgId, [id]);
  return { deleted: true };
}

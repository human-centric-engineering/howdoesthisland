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
import type { AssessmentStatus, AssessmentVia, Prisma } from '@prisma/client';
import { z } from 'zod';
import { APIError, NotFoundError } from '@/lib/api/errors';
import { keepRunningAfterResponse } from '@/lib/api/after-response';
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import { JudgeProfileError, type JudgeProfile } from '@/lib/app/frameworks/engine';
import { countWords, extractText } from '@/lib/app/intake/extract-text';
import { fetchPage } from '@/lib/app/intake/fetch-page';
import {
  buildProjectContext,
  ProjectContextError,
  contextUsedView,
  renderProjectContext,
  type BuiltProjectContext,
} from '@/lib/app/projects/context';
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
  startNextQueued,
} from '@/lib/app/assessments/run';
import { scoresOf } from '@/lib/app/assessments/scores';
import { withPlace } from '@/lib/app/assessments/places';
import {
  assertReviewFits,
  reserveReviewBudget,
  type BudgetHold,
  type ReviewRate,
} from '@/lib/app/usage/budget';
import {
  chargeEphemeralRun,
  chargeRewrite,
  chargeStoredReview,
  uncharged,
} from '@/lib/app/credits/charge';
import { logger } from '@/lib/logging';
import { createPrivacyScope, runInPrivacyScope } from '@/lib/orchestration/privacy/scope';
import { assessableText } from '@/lib/app/assessments/text';
import { CANCEL_GRACE_MS, POLL_MS, WAIT_BOUND_MS } from '@/lib/app/assessments/limits';
import { versionToScore, type VersionToScore } from '@/lib/app/assessments/api/version';
import { deleteReportPdfs, sweepReportPdfs } from '@/lib/app/reports/pdf/cache';
import type { AssessmentRequest } from '@/lib/app/assessments/api/validations';
import { mergeContext, projectForReview, type ReviewProject } from '@/lib/app/projects/service';
import { overlayForReview, type StoredOverlay } from '@/lib/app/projects/overlay';
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
  project_archived: { code: 'PROJECT_ARCHIVED', status: 409 },
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
export function storedContext(ctx: unknown): z.infer<typeof jsonObject> {
  return jsonObject.parse(JSON.parse(JSON.stringify(ctx)));
}

export interface Caller {
  /** A real `User.id`. */
  userId: string;
  /** The API key the request came through, if it did. */
  apiKeyId: string | null;
  /**
   * Set by a tool call through the MCP server (t-92), which comes with no
   * `sk_` key: without it the review would read as asked for in the app.
   */
  via?: 'MCP';
}

/** How a review was asked for, as its row records it. */
export function requestedViaOf(caller: Caller): AssessmentVia {
  if (caller.via) return caller.via;
  return caller.apiKeyId ? 'API' : 'APP';
}

interface Source {
  text: string;
  title: string | null;
  sourceKind: 'TEXT' | 'FILE' | 'URL';
  sourceUrl: string | null;
  fileName: string | null;
}

/** Turn the request's source into text: pasted, fetched (D14) or read from a file. */
async function intake(source: AssessmentRequest['source']): Promise<Source> {
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
  const file = await extractText(source.file.bytes, source.file.name);
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
  /** The version, its engine scoring with the project's overlay when there is one (t-72). */
  resolved: VersionToScore;
  /** The project it is reviewed in (t-70), or `null`. */
  projectId: string | null;
  /** The project's adjustment to the weights, as checked against this version (t-72), or `null`. */
  overlay: StoredOverlay | null;
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
export async function prepareAssessment(body: AssessmentRequest): Promise<PreparedAssessment> {
  const options = await resolveReviewOptions(body);
  // Pasted text can be refused now; a page or a file only once it is read.
  if ('text' in body.source) {
    const { text } = body.source;
    await refusingAsApi(() => assessableText(text));
  }
  // Last, so a request refused for anything above is refused for that.
  const rate = await assertReviewFits(
    requireOrgId(),
    storedProfileName(options.profile),
    options.judges.length,
    body.store !== false
  );
  return { ...options, hold: null, rate };
}

/** The review options every request names, as {@link resolveReviewOptions} reads them. */
export type ReviewOptions = Pick<
  AssessmentRequest,
  'projectId' | 'framework' | 'version' | 'context' | 'profile' | 'judges'
>;

/** What a request's options resolve to: {@link PreparedAssessment} before the budget. */
export type ResolvedReviewOptions = Omit<PreparedAssessment, 'hold' | 'rate'>;

/**
 * The version, the project, its overlay, the context and the judges a
 * request's options resolve to, each refused as {@link prepareAssessment}
 * says. Shared with a comparison (t-87), whose drafts are all reviewed with
 * what this resolves once.
 */
export async function resolveReviewOptions(body: ReviewOptions): Promise<ResolvedReviewOptions> {
  const project = body.projectId ? await projectForReview(body.projectId) : null;
  const version = await versionToScore(frameworkChoice(body, project));
  // The project's defaults under the request's own fields (t-70), checked
  // against this version as any context is.
  const ctx = fromProjectDefaults(
    (err) => issuesFromDefaults(err, project?.defaults.context, body.context),
    () => contextFor(version, mergeContext(project?.defaults.context, body.context))
  );
  // The project's adjustment to the weights (t-72), checked against this
  // version as its defaults are: 400 `OVERLAY_INVALID` when the version's
  // bounds do not allow it, or it declares none.
  const adjusted = overlayForReview(version.engine, project?.overlay);
  const resolved: VersionToScore = { ...version, engine: adjusted.engine };
  const ownProfile = body.judges ?? body.profile;
  const profile: JudgeProfile = ownProfile ?? project?.defaults.profile ?? 'full';
  const judges = fromProjectDefaults(
    () => ownProfile === undefined && project?.defaults.profile !== undefined,
    () => judgesFor(resolved, profile)
  );
  return {
    resolved,
    projectId: project?.id ?? null,
    overlay: adjusted.overlay,
    ctx,
    profile,
    judges,
  };
}

/**
 * Run `check`; when it refuses for something the project's defaults supplied,
 * say so, since the caller may be refused for ids they never sent: defaults are
 * checked against the framework's latest version when saved, not every
 * version (t-70).
 */
function fromProjectDefaults<T>(fromDefaults: (err: APIError) => boolean, check: () => T): T {
  try {
    return check();
  } catch (err) {
    if (!(err instanceof APIError) || !fromDefaults(err)) throw err;
    throw new APIError(
      `${err.message} The project's defaults are part of this request: check them against this version.`,
      err.code,
      err.status,
      { ...err.details, fromProjectDefaults: true }
    );
  }
}

/** The value at a dotted context path (`audience.awareness`), or undefined. */
function atPath(ctx: Record<string, unknown> | undefined, path: string): unknown {
  let value: unknown = ctx;
  for (const part of path.split('.')) {
    const record = z.record(z.string(), z.unknown()).safeParse(value);
    if (!record.success) return undefined;
    value = record.data[part];
  }
  return value;
}

/**
 * Whether a `CONTEXT_INVALID` names a path the project's defaults gave and the
 * request did not: only then is the project's to blame.
 */
function issuesFromDefaults(
  err: APIError,
  project: Record<string, unknown> | undefined,
  request: Record<string, unknown> | undefined
): boolean {
  const issues = z
    .object({ issues: z.array(z.object({ path: z.string() })) })
    .safeParse(err.details);
  if (!issues.success || project === undefined) return false;
  return issues.data.issues.some(
    ({ path }) =>
      path !== '' && atPath(project, path) !== undefined && atPath(request, path) === undefined
  );
}

/**
 * The framework a review is scored with: a project's, when it is in one. A
 * request naming another framework is refused, since the project's defaults
 * are that framework's ids.
 */
function frameworkChoice(
  body: ReviewOptions,
  project: ReviewProject | null
): { framework?: string; version?: string } {
  if (!project) return body;
  if (body.framework !== undefined && body.framework !== project.framework) {
    throw new APIError(
      `This project's reviews are scored with ${project.framework}, not ${body.framework}.`,
      'PROJECT_FRAMEWORK_MISMATCH',
      400
    );
  }
  return { framework: project.framework, version: body.version };
}

/**
 * Check `prepared` against the workspace's budget again and hold its estimate
 * (t-50) under the lock that orders requests arriving together, as
 * `prepared.hold`: the last step before {@link createAssessment}. Throws 402
 * `BUDGET_EXCEEDED` when requests checked before it took what was left.
 */
export async function holdReviewBudget(
  body: AssessmentRequest,
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

/**
 * `onStored` is told the review's id as soon as its row is written, so a
 * caller that cannot let a later failure lose it (the MCP tool, t-92) can
 * still answer it.
 */
export async function createAssessment(
  body: AssessmentRequest,
  prepared: PreparedAssessment,
  caller: Caller,
  options: {
    boundMs?: number;
    signal?: AbortSignal;
    onStored?: (assessmentId: string) => void;
  } = {}
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
          projectId: prepared.projectId,
        },
        frameworkVersionId: resolved.version.id,
        profile,
        context: storedContext(ctx),
        overlay: prepared.overlay,
        requestedVia: requestedViaOf(caller),
        apiKeyId: caller.apiKeyId,
        userId: caller.userId,
      })
    ));
    options.onStored?.(assessmentId);
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
  body: AssessmentRequest,
  prepared: PreparedAssessment,
  caller: Caller,
  signal?: AbortSignal
): Promise<CreatedAssessment> {
  const { resolved, ctx, profile, judges, hold } = prepared;
  const source = await intake(body.source);
  const runId = crypto.randomUUID();
  const run = () =>
    refusingAsApi(() =>
      runEphemeral(
        resolved,
        source,
        ctx,
        prepared.overlay,
        prepared.projectId,
        profile,
        judges,
        caller,
        runId,
        signal
      )
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
    // charge that fails here is taken by the recovery job, from the rows, and
    // the hold is kept until then rather than released.
    try {
      await chargeEphemeralRun(orgId, runId, began);
    } catch (err) {
      logger.error('Could not charge a store: false review', err, { runId });
      await hold?.keepFor(UNCHARGED_HOLD_MS);
    }
  }
}

/**
 * How long a `store: false` run's hold is kept when its charge failed: the
 * hour its rows must be quiet before the recovery job charges it
 * (`chargeLapsedEphemeralRuns`), and the job's next 15-minute tick, so it is
 * counted twice for minutes at most, never not at all.
 */
const UNCHARGED_HOLD_MS = CANCEL_GRACE_MS + 20 * 60 * 1000;

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
  overlay: StoredOverlay | null,
  projectId: string | null,
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
  const { gathered, fan } = await runInPrivacyScope(scope, async () => {
    // The project's context (t-75), as the stored run gathers it, in the
    // run's privacy scope, for the judges to read. None for the quick scan
    // alone, which calls no model.
    const gathered =
      projectId && judges.length > 0
        ? await ephemeralProjectContext(projectId, text, caller, runId)
        : { record: null, costUsd: 0 };
    const fan = await runJudges({
      engine,
      frameworkVersion: label,
      text,
      ctx,
      slots: judges,
      projectContext: renderProjectContext(gathered.record),
      userId: caller.userId,
      ephemeral: true,
      // Tells this run's cost rows apart, so usage can count the reviews
      // kept nowhere, which have no other record (t-48).
      costTags: { ephemeralRun: runId },
      // A caller gone away starts no further judge: nobody is left to answer.
      shouldContinue: () => Promise.resolve(!signal?.aborted),
    });
    return { gathered, fan };
  });
  const contextUsed = contextUsedView(gathered.record);
  if (fan.stopped) {
    throw new APIError('The request was closed before the judges ran.', 'REQUEST_CLOSED', 499);
  }
  const outputs: Record<string, unknown> = {};
  const runs = new Map<string, JudgeRunView>();
  let costUsd = gathered.costUsd;
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
    overlay,
    contextUsed,
    result,
    judgeRuns: judges.flatMap((slot) => runs.get(slot) ?? []),
  };
}

/**
 * A `store: false` review's project context (t-75), its searches' cost rows
 * tagged with the run, so its charge includes them, and `ephemeral`, so usage
 * counts them with the reviews kept nowhere. A search that fails is refused
 * before any judge is called, rather than a review that reads as if the
 * project had no documents: 409 `PROJECT_CONTEXT_NOT_SET_UP` when the
 * workspace's embedding setup stops it, which asking again cannot change;
 * otherwise 503 `PROJECT_CONTEXT_UNAVAILABLE`.
 */
async function ephemeralProjectContext(
  projectId: string,
  text: string,
  caller: Caller,
  runId: string
): Promise<BuiltProjectContext> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, orgId: requireOrgId() },
    select: { id: true, brief: true },
  });
  // Deleted since the request was checked: reviewed as outside a project.
  if (!project) return { record: null, costUsd: 0 };
  try {
    return await buildProjectContext(project, text, {
      userId: caller.userId,
      metadata: { ephemeral: true, ephemeralRun: runId },
    });
  } catch (err) {
    // Anything else (the database) is the ordinary 500.
    if (!(err instanceof ProjectContextError)) throw err;
    logger.error('Project context could not be gathered for a store: false review', err, {
      projectId,
      runId,
    });
    // What the searches that ran cost, already charged with the run, as
    // `NOT_SCORABLE` says what the judges had spent.
    const details = { costUsd: err.costUsd };
    if (err.permanent) {
      throw new APIError(err.message, 'PROJECT_CONTEXT_NOT_SET_UP', 409, details);
    }
    throw new APIError(
      "The project's background documents could not be searched. Try again in a moment.",
      'PROJECT_CONTEXT_UNAVAILABLE',
      503,
      details
    );
  }
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
async function chargeableOnDelete(
  tx: Pick<Prisma.TransactionClient, 'creditEntry'>,
  orgId: string,
  row: {
    status: AssessmentStatus;
    createdAt: Date;
    completedAt: Date | null;
    leaseExpiresAt: Date | null;
  },
  now: Date
): Promise<boolean> {
  // Open: charged unless it predates charging (`chargeStoredReview` checks).
  if (row.status === 'QUEUED' || row.status === 'RUNNING') return true;
  // A cancel that ended it charged it then, and cleared the lease (`run.ts`).
  // One with its lease set is the recovery job's to charge, unless it is from
  // before charging began (`uncharged`).
  if (row.status !== 'CANCELLED' || row.leaseExpiresAt === null) return false;
  const since = await uncharged(orgId, now, tx);
  return (
    since !== null &&
    row.createdAt >= since.createdAt.gte &&
    row.completedAt !== null &&
    row.completedAt > since.completedAt.gt
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
    // Its rewrites go with it (FK cascade), so they are read first (t-81). One
    // still running is charged now for what its rows record, as an open
    // review is: its call stops at its next save, which finds the row gone,
    // and charges what it spent as it ends (`rewrites/service.ts`), once with
    // this. A finished one was charged as it ended.
    const running = await tx.rewrite.findMany({
      where: { assessmentId: id, orgId, status: 'RUNNING' },
      select: { id: true, createdAt: true },
    });
    for (const rewrite of running) {
      await chargeRewrite(tx, orgId, rewrite.id, rewrite.createdAt);
    }
    // A delete that lost a race with another one has nothing left: 404.
    const { count } = await tx.assessment.deleteMany({ where: { id, orgId } });
    if (count === 0) throw new NotFoundError('Assessment not found');
    // Charged for what it spent (t-58) when it has not been yet: still open,
    // or cancelled with its lease not cleared. Charged here even while a run
    // holds it, since that run's process may be gone, and nothing reads a
    // deleted row's spend again; judges still in flight are missed
    // (`charge.ts`). A final review was charged as it ended, or ended before
    // reviews were charged: not charged again.
    if (await chargeableOnDelete(tx, orgId, row, new Date())) {
      await chargeStoredReview(tx, orgId, id, row.createdAt);
    }
    await tx.content.deleteMany({
      where: { id: row.contentId, orgId, assessments: { none: {} } },
    });
  });
  await sweepReportPdfs(orgId, [id]);
  return { deleted: true };
}

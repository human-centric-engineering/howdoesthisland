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
 *   `ephemeral: true` and with no `assessmentId` (§8.2).
 *
 * Runs in the caller's tenant context (the route's guard). Every refusal is
 * an `APIError`, so the guard answers it with its status and code.
 */
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
import { enqueueAssessment, startAssessmentInBackground } from '@/lib/app/assessments/enqueue';
import { beginAssessment, cancelAssessment } from '@/lib/app/assessments/run';
import { assessableText } from '@/lib/app/assessments/text';
import { POLL_MS, WAIT_BOUND_MS } from '@/lib/app/assessments/limits';
import { resolveVersion, type ResolvedVersion } from '@/lib/app/assessments/api/version';
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
export function contextFor(resolved: ResolvedVersion, input: unknown): unknown {
  const parsed = resolved.engine.parseContext(input);
  if (!parsed.ok) {
    throw new APIError('The context does not fit this framework version.', 'CONTEXT_INVALID', 400, {
      issues: parsed.issues,
    });
  }
  return parsed.ctx;
}

/** The judges a profile or list resolves to, or `PROFILE_UNKNOWN`. */
export function judgesFor(resolved: ResolvedVersion, profile: JudgeProfile): readonly string[] {
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

/** The two numbers every framework's result carries for listing (§9 `overall`, `band`). */
const resultScores = z.object({ scores: z.object({ overall: z.number(), band: z.string() }) });

export function scoresOf(result: unknown): { overall: number | null; band: string | null } {
  const parsed = resultScores.safeParse(result);
  return parsed.success
    ? { overall: parsed.data.scores.overall, band: parsed.data.scores.band }
    : { overall: null, band: null };
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

export async function createAssessment(
  body: CreateAssessmentBody,
  caller: Caller,
  options: { boundMs?: number } = {}
): Promise<CreatedAssessment> {
  // Everything that can be refused without fetching or reading anything first.
  const resolved = await resolveVersion(body);
  const ctx = contextFor(resolved, body.context);
  const profile: JudgeProfile = body.judges ?? body.profile ?? 'full';
  const judges = judgesFor(resolved, profile);
  const source = await intake(body.source);

  if (body.store === false) {
    return {
      kind: 'ephemeral',
      assessment: await refusingAsApi(() =>
        runEphemeral(resolved, source.text, ctx, profile, judges, caller)
      ),
    };
  }

  const { assessmentId } = await refusingAsApi(() =>
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
  );

  if (body.wait === true) {
    await waitForRun(assessmentId, options.boundMs ?? WAIT_BOUND_MS);
  } else {
    startAssessmentInBackground(assessmentId);
  }
  const assessment = await readAssessment(assessmentId);
  // Deleted under us, by another request, between the write and this read.
  if (!assessment) throw new NotFoundError('Assessment not found');
  return { kind: 'stored', final: isFinal(assessment.status), assessment };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Claim and run the assessment in this request, for at most `boundMs`. A
 * run still going at the bound carries on after the response. One the
 * workspace could not start yet is watched for the bound instead: the next
 * run in the workspace to end starts it.
 */
async function waitForRun(assessmentId: string, boundMs: number): Promise<void> {
  const deadline = Date.now() + boundMs;
  const run = await beginAssessment(assessmentId);
  if (run) {
    keepRunningAfterResponse(run.done, 'app: assessment run', { assessmentId });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
    });
    await Promise.race([run.done.then(() => undefined), bound]);
    clearTimeout(timer);
    return;
  }
  const orgId = requireOrgId();
  while (Date.now() < deadline) {
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
  resolved: ResolvedVersion,
  rawText: string,
  ctx: unknown,
  profile: JudgeProfile,
  judges: readonly string[],
  caller: Caller
): Promise<EphemeralAssessment> {
  const text = assessableText(rawText);
  const { engine, label } = resolved;
  const quick = engine.quickScan(text, ctx);
  const fan = await runJudges({
    engine,
    frameworkVersion: label,
    text,
    ctx,
    slots: judges,
    userId: caller.userId,
    ephemeral: true,
  });
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
  const result = engine.assemble(text, ctx, quick, outputs, null);
  const failed = [...runs.values()].some((r) => r.status === 'failed');
  return {
    stored: false,
    status: failed ? 'partial' : 'completed',
    profile: typeof profile === 'string' ? profile : 'custom',
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
  const current = await getAssessment(id);
  if (!(await cancelAssessment(id))) {
    throw new APIError(`This assessment is already ${current.status}.`, 'ASSESSMENT_FINAL', 409);
  }
  return await getAssessment(id);
}

/**
 * Delete an assessment, its judge runs, and its text unless another
 * assessment shares it. Allowed in any state: a run still going writes only
 * under its lease, to a row that is gone, so it stores nothing more. Its
 * cost rows stay, as the usage record.
 */
export async function remove(id: string): Promise<{ deleted: true }> {
  const orgId = requireOrgId();
  await prisma.$transaction(async (tx) => {
    const row = await tx.assessment.findUnique({
      where: { id, orgId },
      select: { contentId: true },
    });
    if (!row) throw new NotFoundError('Assessment not found');
    await tx.assessment.delete({ where: { id } });
    await tx.content.deleteMany({
      where: { id: row.contentId, orgId, assessments: { none: {} } },
    });
  });
  return { deleted: true };
}

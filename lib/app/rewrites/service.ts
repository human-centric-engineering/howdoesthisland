/**
 * Rewrites (t-81, app-plan §8.2, .context/app/rewrites.md): a draft the
 * editor writes from a finished review, streamed as it is written, then kept.
 *
 * **What it reads.** The review's text, context and result, and its
 * project's context as background: the passages the judges read (stored on
 * the review, `projectContext`) with the project's brief as it is now, not as
 * the review stored it, so a brief written after the review reaches the
 * rewrite (planning ruling on f-rewrite, 2026-11-24). The documents are not
 * searched again: that would cost a search per rewrite and could give
 * passages the judges never saw.
 *
 * **How it runs.** {@link startRewrite} checks the request, then writes the
 * `RUNNING` row in the budget check's transaction (`reserveRewriteBudget`):
 * the row is the budget hold, so requests sent together cannot each spend
 * the same remainder. A workspace with no rewrites ended yet holds what this
 * one can cost at most, at the editor's price (t-86, `streamCeilingUsd`). The
 * call then runs on its own under
 * `keepRunningAfterResponse`, not as part of the response: a reader that
 * stops listening does not stop it, and the draft is saved and charged all
 * the same. While it runs it saves what it has written and renews its lease
 * every {@link DRAFT_SAVE_MS}, and once as soon as it has its first piece; a
 * save that finds the row gone (its review was deleted) stops the call, as
 * does running past {@link REWRITE_CALL_MS}. As the call starts, the row
 * keeps what it is priced from (`callStart`, t-85), so recovery can price one
 * whose process dies before it writes its cost row.
 *
 * **How it ends.** One write: `COMPLETED` with the draft, or `FAILED` with
 * the reason and what was written by then, and in the same transaction the
 * charge for its cost rows (`chargeRewrite`, tagged `rewriteId`), so a rewrite
 * is always either holding budget or charged. A rewrite whose process died
 * keeps `RUNNING` until its lease runs out, then the recovery job fails and
 * charges it (`recover.ts`).
 *
 * **Charged by the call, whatever became of its row.** A streamed call
 * writes its cost row only when it ends, so a charge made while it runs (its
 * review deleted, or recovery ending a rewrite whose saves failed past its
 * lease) finds nothing to charge, and writes no entry. The call's own end
 * charges again, after its row is written, under the same reference: once
 * in all, whoever got there first. A live call whose row recovery ended
 * `lost` is not lost: its next save sets it `RUNNING` again (holding budget
 * again, since it is spending), and its ending replaces recovery's.
 *
 * Tenancy: every read and write names the org the guard entered.
 */
import type { Prisma } from '@prisma/client';
import { APIError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { keepRunningAfterResponse } from '@/lib/api/after-response';
import { engineForVersion } from '@/lib/app/assessments/engine';
import { isForeignKeyFailure } from '@/lib/app/assessments/prisma-errors';
import { LEASE_MS } from '@/lib/app/assessments/limits';
import { chargeRewrite } from '@/lib/app/credits/charge';
import { RewriteFocusUnknownError, type RewriteFollowUp } from '@/lib/app/frameworks/engine';
import { parsePlaceholders } from '@/lib/app/frameworks/placeholders';
import { EDITOR_AGENT_SLUG } from '@/lib/app/judges/agents';
import {
  JudgeRunError,
  streamAgent,
  streamCeilingUsd,
  type StreamStart,
} from '@/lib/app/judges/run-judge';
import { parseProjectContext, renderProjectContext } from '@/lib/app/projects/context';
import { EventChannel } from '@/lib/app/rewrites/channel';
import { LOST_REWRITE_CODE, settleRewriteCostRows } from '@/lib/app/rewrites/recover';
import { DRAFT_SAVE_MS, REWRITE_CALL_MS, REWRITE_COST_TAG } from '@/lib/app/rewrites/limits';
import type { CreateRewriteRequest } from '@/lib/app/rewrites/validations';
import { REWRITE_VIEW_SELECT, toRewriteView, type RewriteView } from '@/lib/app/rewrites/views';
import { reserveRewriteBudget } from '@/lib/app/usage/budget';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { requireOrgId } from '@/lib/tenancy/context';

/** What a rewrite's stream carries, in order: the row, each piece of the draft, the row once it ends. */
export type RewriteEvent =
  | { type: 'rewrite'; rewrite: RewriteView }
  | { type: 'rewrite_text'; text: string }
  | { type: 'rewrite_done'; rewrite: RewriteView };

export interface StartedRewrite {
  /** The row as written: `running`, with no draft yet. */
  rewrite: RewriteView;
  /** The stream's events, for one reader. */
  events: AsyncIterable<RewriteEvent>;
  /** The row once it ends, `completed` or `failed`. Never rejects. */
  done: Promise<RewriteView>;
}

/** Who a rewrite's call goes to, for its checks, its ceiling and its refusals. */
const EDITOR_CALL = {
  agentSlug: EDITOR_AGENT_SLUG,
  role: 'editor',
  name: 'editor',
  target: 'the editor',
} as const;

/** A review that can be rewritten: finished, with a result to rewrite from. */
const REWRITABLE = new Set(['COMPLETED', 'PARTIAL']);

function notRewritable(message: string): APIError {
  return new APIError(message, 'ASSESSMENT_NOT_REWRITABLE', 409);
}

/**
 * The project's context for a rewrite of `review`: its stored passages and
 * documents, with the project's brief as it is now. A review whose project is
 * gone keeps the brief it stored. `null` when there is nothing to read.
 */
function rewriteContext(review: {
  id: string;
  projectContext: Prisma.JsonValue;
  project: { brief: Prisma.JsonValue } | null;
}): string | null {
  const stored = parseProjectContext(review.projectContext);
  if (!review.project) return renderProjectContext(stored);
  const current = parseProjectContext({
    documents: stored?.documents ?? [],
    passages: stored?.passages ?? [],
    brief: review.project.brief,
  });
  if (!current) {
    // A stored brief this schema no longer reads: the passages still count.
    logger.warn('Project brief unreadable for a rewrite; using what the review stored', {
      assessmentId: review.id,
    });
    return renderProjectContext(stored);
  }
  return renderProjectContext(current);
}

/**
 * Check a request for a rewrite and start it. Throws, before anything is
 * written or spent: 404 for a review not in this workspace, 409
 * `ASSESSMENT_NOT_REWRITABLE` for one not finished (or whose framework
 * version can no longer be run), 400 for a focus its framework does not
 * have, and the budget's 402s and 429.
 */
export async function startRewrite(
  body: CreateRewriteRequest,
  who: { userId: string | null },
  /** The request's, for a streamed one: once it aborts, its events are not kept. */
  signal?: AbortSignal
): Promise<StartedRewrite> {
  const orgId = requireOrgId();
  const review = await prisma.assessment.findFirst({
    where: { id: body.assessmentId, orgId },
    select: {
      id: true,
      status: true,
      result: true,
      context: true,
      projectContext: true,
      frameworkVersionId: true,
      content: { select: { text: true } },
      project: { select: { brief: true } },
    },
  });
  if (!review) throw new NotFoundError('Assessment not found');
  if (!REWRITABLE.has(review.status)) {
    throw notRewritable(
      `This review is ${review.status.toLowerCase()}: only a finished review can be rewritten.`
    );
  }
  if (review.result === null) throw notRewritable('This review has no result to rewrite from.');
  const loaded = await engineForVersion(review.frameworkVersionId);
  if (!loaded) throw notRewritable('This review’s framework version can no longer be run.');
  const { engine, label } = loaded;

  const earlier = await answeredRewrite(review.id, body);
  const focuses = engine.rewriteFocuses();
  const focus = body.focus ?? earlier?.focus ?? focuses[0];
  if (!focuses.includes(focus)) {
    throw new ValidationError(
      `"${focus}" is not a rewrite focus: use one of ${focuses.join(', ')}.`,
      {
        focus: focuses,
      }
    );
  }
  const text = review.content.text;
  const projectContext = rewriteContext(review);
  // Built now, so a review the engine cannot read is refused before anything
  // is held or written. A published version never changes, so the call
  // builds the same request again.
  // The stored result is read as the engine wrote it; one stored in a shape
  // it no longer reads is not rewritable, not a server error.
  let request: ReturnType<typeof engine.buildRewriteRequest>;
  try {
    request = engine.buildRewriteRequest(
      text,
      review.context,
      review.result,
      focus,
      projectContext,
      earlier?.followUp ?? null
    );
  } catch (err) {
    if (err instanceof RewriteFocusUnknownError) throw err;
    logger.warn('A stored review could not be read for a rewrite', {
      assessmentId: review.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw notRewritable('This review’s stored result can no longer be read for a rewrite.');
  }

  let row;
  try {
    row = await reserveRewriteBudget(
      orgId,
      (tx, estimate) =>
        tx.rewrite.create({
          data: {
            orgId,
            assessmentId: review.id,
            focus,
            heldUsd: estimate.estimateUsd,
            leaseExpiresAt: new Date(Date.now() + LEASE_MS),
            createdByUserId: who.userId,
          },
          select: REWRITE_VIEW_SELECT,
        }),
      () => streamCeilingUsd(EDITOR_CALL, request)
    );
  } catch (err) {
    // The review was deleted (or purged) since it was read: nothing was held.
    if (isForeignKeyFailure(err)) throw new NotFoundError('Assessment not found');
    throw err;
  }
  const rewrite = toRewriteView(row);
  // Only a streamed request has a reader: otherwise every piece of the draft
  // would be queued a second time for the whole call, and never read.
  const channel = body.stream ? new EventChannel<RewriteEvent>(signal) : null;
  channel?.push({ type: 'rewrite', rewrite });

  const done = drive({
    orgId,
    rewriteId: row.id,
    assessmentId: row.assessmentId,
    focus: row.focus,
    createdAt: row.createdAt,
    prompt: request.prompt,
    maxTokens: request.maxTokens,
    frameworkVersion: label,
    userId: who.userId,
    channel,
  });
  keepRunningAfterResponse(done, 'app: rewrite', { rewriteId: row.id });
  return { rewrite, events: channel ?? NO_EVENTS, done };
}

/** What a request to fill an earlier rewrite's gaps needs from it: its focus, and the second pass. */
interface AnsweredRewrite {
  focus: string;
  followUp: RewriteFollowUp;
}

/**
 * The earlier rewrite a request's `answers` fill (t-83), or `null` for a
 * request without one. Throws 404 for one that is not a rewrite of this
 * review in this workspace, 409 `REWRITE_NOT_FINISHED` for one not
 * `completed`, and 400 for an answer to a placeholder its draft does not
 * have (`details.answers` names them, with the ids it has). Each answered
 * placeholder goes to the editor as the draft wrote it.
 */
async function answeredRewrite(
  assessmentId: string,
  body: CreateRewriteRequest
): Promise<AnsweredRewrite | null> {
  if (body.fromRewriteId === undefined || body.answers === undefined) return null;
  const row = await prisma.rewrite.findFirst({
    where: { id: body.fromRewriteId, assessmentId, orgId: requireOrgId() },
    select: { status: true, draft: true, focus: true },
  });
  if (!row) throw new NotFoundError('Rewrite not found for this review');
  if (row.status !== 'COMPLETED') {
    throw new APIError(
      'Only a finished rewrite’s placeholders can be answered.',
      'REWRITE_NOT_FINISHED',
      409
    );
  }
  const placeholders = parsePlaceholders(row.draft);
  const ids = new Set(placeholders.map((p) => p.id));
  const answers = body.answers;
  const unknown = Object.keys(answers).filter((key) => !ids.has(key));
  if (unknown.length > 0) {
    throw new ValidationError(
      `This rewrite has no placeholder ${unknown.join(', ')}: answer one of ${
        placeholders.map((p) => p.id).join(', ') || 'none (it has none)'
      }.`,
      { answers: { unknown, placeholders: [...ids] } }
    );
  }
  return {
    focus: row.focus,
    followUp: {
      draft: row.draft,
      answers: placeholders
        .filter((p) => Object.hasOwn(answers, p.id))
        .map((p) => ({
          placeholder: row.draft.slice(p.at[0].start, p.at[0].end),
          answer: answers[p.id],
        })),
    },
  };
}

/** The events of a request that did not ask to stream: none. */
const NO_EVENTS: AsyncIterable<RewriteEvent> = {
  async *[Symbol.asyncIterator]() {},
};

/**
 * A row this process may still write: running, or ended `lost` by recovery
 * while it lived. Anything else ended another way, and is not written over.
 */
const ALIVE: Prisma.RewriteWhereInput[] = [
  { status: 'RUNNING' },
  { status: 'FAILED', errorCode: LOST_REWRITE_CODE },
];

interface Drive {
  orgId: string;
  rewriteId: string;
  assessmentId: string;
  focus: string;
  createdAt: Date;
  prompt: string;
  maxTokens: number;
  frameworkVersion: string;
  userId: string | null;
  channel: EventChannel<RewriteEvent> | null;
}

/** Run the call, saving as it goes, and end the row. Never rejects. */
async function drive(d: Drive): Promise<RewriteView> {
  const { rewriteId } = d;
  const stop = new AbortController();
  let draft = '';
  let saving: Promise<void> = Promise.resolve();
  const save = () => {
    saving = saving.then(async () => {
      try {
        const { count } = await prisma.rewrite.updateMany({
          where: { id: rewriteId, orgId: d.orgId, OR: ALIVE },
          // A row recovery ended `lost` while this call lived (its saves failed
          // past the lease) runs again, holding budget again: it is spending.
          data: {
            status: 'RUNNING',
            error: null,
            errorCode: null,
            completedAt: null,
            draft,
            leaseExpiresAt: new Date(Date.now() + LEASE_MS),
          },
        });
        // Gone (its review was deleted) or ended another way: stop paying for it.
        if (count === 0) stop.abort();
      } catch (err) {
        // Not fatal: the lease outlasts several saves, and the next may succeed.
        logger.warn('A running rewrite could not be saved', {
          rewriteId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };
  const timer = setInterval(save, DRAFT_SAVE_MS);
  timer.unref?.();
  // Stopped once it has run too long, on any host, so its own cost row lands
  // before recovery may price it from its draft (`REWRITE_LIFETIME_MS`).
  let overran = false;
  const deadline = setTimeout(
    () => {
      overran = true;
      stop.abort();
    },
    Math.max(0, d.createdAt.getTime() + REWRITE_CALL_MS - Date.now())
  );
  deadline.unref?.();
  // So recovery can price the call should this process die before it ends.
  const keepStart = async (start: StreamStart) => {
    try {
      const { count } = await prisma.rewrite.updateMany({
        where: { id: rewriteId, orgId: d.orgId, OR: ALIVE },
        data: { callStart: { ...start, frameworkVersion: d.frameworkVersion } },
      });
      // Gone (its review was deleted) or ended another way: stop before paying.
      if (count === 0) stop.abort();
    } catch (err) {
      // Not fatal: the call is still worth making, and charges itself as it
      // ends. Only a process that died as well would go uncharged.
      logger.warn('A rewrite could not keep what its call is priced from', {
        rewriteId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  let end: Ending;
  try {
    const reply = await streamAgent({
      ...EDITOR_CALL,
      // A rewrite asks for little thinking, so the longest text's reply fits
      // the editor's ceiling with it (`lib/app/judges/agents.ts`).
      request: () => ({ prompt: d.prompt, maxTokens: d.maxTokens, reasoningEffort: 'low' }),
      onStart: keepStart,
      onText: (piece) => {
        // Saved at once, so a process that dies before the next save has a
        // draft that says the provider answered, and how much (t-85).
        const first = draft === '' && piece !== '';
        draft += piece;
        if (first) save();
        d.channel?.push({ type: 'rewrite_text', text: piece });
      },
      costMetadata: { editor: REWRITE_COST_TAG, rewriteId },
      frameworkVersion: d.frameworkVersion,
      userId: d.userId,
      signal: stop.signal,
    });
    end = {
      status: 'COMPLETED',
      draft: reply.text,
      provider: reply.provider,
      modelName: reply.model,
      costUsd: reply.costUsd,
      error: null,
      errorCode: null,
    };
  } catch (err) {
    // Only a failure the stop caused: one the call had already met (cut off
    // at its ceiling, refused) as the deadline passed keeps its own reason.
    end =
      overran && err instanceof JudgeRunError && err.code === 'provider_error'
        ? overranEnding(rewriteId, draft, err)
        : failedEnding(rewriteId, draft, err);
  } finally {
    clearInterval(timer);
    clearTimeout(deadline);
  }
  await saving;

  const ended = await finish(d, end);
  d.channel?.push({ type: 'rewrite_done', rewrite: ended });
  d.channel?.close();
  return ended;
}

interface Ending {
  status: 'COMPLETED' | 'FAILED';
  draft: string;
  provider: string | null;
  modelName: string | null;
  costUsd: number;
  error: string | null;
  errorCode: string | null;
}

/** What a rewrite whose call ran past {@link REWRITE_CALL_MS} says. */
export const OVERRAN_REWRITE = 'It ran too long and was stopped.';

/** The ending of a call stopped at {@link REWRITE_CALL_MS}, priced as any stopped call. */
function overranEnding(rewriteId: string, draft: string, err: JudgeRunError): Ending {
  logger.warn('A rewrite ran too long and was stopped', { rewriteId });
  const { spend } = err;
  return {
    status: 'FAILED',
    draft,
    provider: spend?.provider ?? null,
    modelName: spend?.model ?? null,
    costUsd: spend?.costUsd ?? 0,
    error: OVERRAN_REWRITE,
    errorCode: 'timed_out',
  };
}

function failedEnding(rewriteId: string, draft: string, err: unknown): Ending {
  if (err instanceof JudgeRunError) {
    logger.warn('A rewrite failed', { rewriteId, code: err.code, message: err.message });
    return {
      status: 'FAILED',
      draft,
      provider: err.spend?.provider ?? null,
      modelName: err.spend?.model ?? null,
      costUsd: err.spend?.costUsd ?? 0,
      error: err.message,
      errorCode: err.code,
    };
  }
  logger.error('A rewrite failed', err, { rewriteId });
  return {
    status: 'FAILED',
    draft,
    provider: null,
    modelName: null,
    costUsd: 0,
    error: 'The rewrite could not be finished.',
    errorCode: 'internal_error',
  };
}

/**
 * End the row and charge it ({@link endAndCharge}), trying once more on a
 * failure. Twice failed, the row is left `RUNNING` with the whole draft saved
 * if that much can be written, and answered as it is: the recovery job ends
 * it and charges its cost rows once its lease runs out, so the answer agrees
 * with what `GET` reads then.
 */
async function finish(d: Drive, end: Ending): Promise<RewriteView> {
  const { orgId, rewriteId } = d;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await endAndCharge(d, end);
    } catch (err) {
      logger.error('A rewrite could not be ended', err, {
        rewriteId,
        status: end.status,
        attempt,
      });
      if (attempt === 2) break;
    }
  }
  try {
    await prisma.rewrite.updateMany({
      where: { id: rewriteId, orgId, OR: ALIVE },
      data: { draft: end.draft },
    });
  } catch {
    // The last periodic save stands: logged above.
  }
  return { ...missing(d, end), status: 'running', completedAt: null };
}

/**
 * End the row and charge it, in one transaction. The row is written while it
 * runs, or once recovery has ended it `lost` (this process is not lost: its
 * ending is the true one). It is charged whatever its state, or even with
 * the row gone (its review deleted): see "Charged by the call" above. A row
 * gone answers the ending it missed.
 */
async function endAndCharge(d: Drive, end: Ending): Promise<RewriteView> {
  const { orgId, rewriteId } = d;
  return prisma.$transaction(async (tx) => {
    await tx.rewrite.updateMany({
      where: { id: rewriteId, orgId, OR: ALIVE },
      data: { ...end, completedAt: new Date(), leaseExpiresAt: null },
    });
    // Recovery's estimate, should it have priced this call meanwhile, gives
    // way to the row the call wrote itself.
    await settleRewriteCostRows(tx, orgId, rewriteId, d.createdAt);
    await chargeRewrite(tx, orgId, rewriteId, d.createdAt);
    const row = await tx.rewrite.findFirst({
      where: { id: rewriteId, orgId },
      select: REWRITE_VIEW_SELECT,
    });
    return row ? toRewriteView(row) : missing(d, end);
  });
}

/** The ending as the API would have answered it, for a row that is gone or could not be written. */
function missing(d: Drive, end: Ending): RewriteView {
  return {
    id: d.rewriteId,
    assessmentId: d.assessmentId,
    focus: d.focus,
    status: end.status === 'COMPLETED' ? 'completed' : 'failed',
    draft: end.draft,
    placeholders: parsePlaceholders(end.draft),
    error: end.error,
    errorCode: end.errorCode,
    model: end.modelName,
    costUsd: end.costUsd,
    createdAt: d.createdAt.toISOString(),
    completedAt: new Date().toISOString(),
  };
}

/** One of the workspace's rewrites. */
export async function getRewrite(id: string): Promise<RewriteView> {
  const row = await prisma.rewrite.findFirst({
    where: { id, orgId: requireOrgId() },
    select: REWRITE_VIEW_SELECT,
  });
  if (!row) throw new NotFoundError('Rewrite not found');
  return toRewriteView(row);
}

/** A review's rewrites, newest first. 404 for a review not in this workspace. */
export async function listRewrites(assessmentId: string): Promise<RewriteView[]> {
  const orgId = requireOrgId();
  const review = await prisma.assessment.count({ where: { id: assessmentId, orgId } });
  if (review === 0) throw new NotFoundError('Assessment not found');
  const rows = await prisma.rewrite.findMany({
    where: { assessmentId, orgId },
    orderBy: { createdAt: 'desc' },
    select: REWRITE_VIEW_SELECT,
  });
  return rows.map(toRewriteView);
}

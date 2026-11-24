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
 * the same remainder. The call then runs on its own under
 * `keepRunningAfterResponse`, not as part of the response: a reader that
 * stops listening does not stop it, and the draft is saved and charged all
 * the same. While it runs it saves what it has written and renews its lease
 * every {@link DRAFT_SAVE_MS}; a save that finds the row gone (its review was
 * deleted) stops the call.
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
 * in all, whoever got there first. A live call's ending also replaces the
 * `lost` that recovery wrote for it, since it knows what happened.
 *
 * Tenancy: every read and write names the org the guard entered.
 */
import type { Prisma } from '@prisma/client';
import { APIError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { keepRunningAfterResponse } from '@/lib/api/after-response';
import { engineForVersion } from '@/lib/app/assessments/engine';
import { LEASE_MS } from '@/lib/app/assessments/limits';
import { chargeRewrite } from '@/lib/app/credits/charge';
import { EDITOR_AGENT_SLUG } from '@/lib/app/judges/agents';
import { JudgeRunError, streamAgent } from '@/lib/app/judges/run-judge';
import { parseProjectContext, renderProjectContext } from '@/lib/app/projects/context';
import { EventChannel } from '@/lib/app/rewrites/channel';
import { LOST_REWRITE_CODE } from '@/lib/app/rewrites/recover';
import { DRAFT_SAVE_MS, REWRITE_COST_TAG } from '@/lib/app/rewrites/limits';
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
    logger.warn('Project brief unreadable for a rewrite; using what the review stored', {});
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
  who: { userId: string | null }
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
  if (!REWRITABLE.has(review.status) || review.result === null) {
    throw notRewritable(
      `This review is ${review.status.toLowerCase()}: only a finished review can be rewritten.`
    );
  }
  const loaded = await engineForVersion(review.frameworkVersionId);
  if (!loaded) throw notRewritable('This review’s framework version can no longer be run.');
  const { engine, label } = loaded;

  const focuses = engine.rewriteFocuses();
  const focus = body.focus ?? focuses[0];
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
  const request = engine.buildRewriteRequest(
    text,
    review.context,
    review.result,
    focus,
    projectContext
  );

  const row = await reserveRewriteBudget(orgId, (tx, estimate) =>
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
    })
  );
  const rewrite = toRewriteView(row);
  // Only a streamed request has a reader: otherwise every piece of the draft
  // would be queued a second time for the whole call, and never read.
  const channel = body.stream ? new EventChannel<RewriteEvent>() : null;
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

/** The events of a request that did not ask to stream: none. */
const NO_EVENTS: AsyncIterable<RewriteEvent> = {
  async *[Symbol.asyncIterator]() {},
};

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
          where: { id: rewriteId, status: 'RUNNING' },
          data: { draft, leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
        });
        // Gone (its review was deleted) or ended elsewhere: stop paying for it.
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

  let end: Ending;
  try {
    const reply = await streamAgent({
      agentSlug: EDITOR_AGENT_SLUG,
      role: 'editor',
      name: 'editor',
      target: 'the editor',
      // A rewrite asks for little thinking, so the longest text's reply fits
      // the editor's ceiling with it (`lib/app/judges/agents.ts`).
      request: () => ({ prompt: d.prompt, maxTokens: d.maxTokens, reasoningEffort: 'low' }),
      onText: (piece) => {
        draft += piece;
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
    end = failedEnding(rewriteId, draft, err);
  } finally {
    clearInterval(timer);
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
 * End the row and charge it, in one transaction. The row is written while it
 * runs, or once recovery has ended it `lost` (this process is not lost: its
 * ending is the true one). It is charged whatever its state, or even with
 * the row gone (its review deleted): see "Charged by the call" above. A row
 * gone answers the ending it missed.
 */
async function finish(d: Drive, end: Ending): Promise<RewriteView> {
  const { orgId, rewriteId } = d;
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.rewrite.updateMany({
        where: {
          id: rewriteId,
          orgId,
          OR: [{ status: 'RUNNING' }, { status: 'FAILED', errorCode: LOST_REWRITE_CODE }],
        },
        data: { ...end, completedAt: new Date(), leaseExpiresAt: null },
      });
      await chargeRewrite(tx, orgId, rewriteId, d.createdAt);
      const row = await tx.rewrite.findUnique({
        where: { id: rewriteId },
        select: REWRITE_VIEW_SELECT,
      });
      return row ? toRewriteView(row) : missing(d, end);
    });
  } catch (err) {
    // Billed already: the row keeps `RUNNING` until its lease runs out, and
    // recovery then fails and charges it.
    logger.error('A rewrite could not be ended', err, { rewriteId, status: end.status });
    return missing(d, end);
  }
}

/** The ending as the API would have answered it, for a row that is gone or could not be written. */
function missing(d: Drive, end: Ending): RewriteView {
  return {
    id: d.rewriteId,
    assessmentId: d.assessmentId,
    focus: d.focus,
    status: end.status === 'COMPLETED' ? 'completed' : 'failed',
    draft: end.draft,
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

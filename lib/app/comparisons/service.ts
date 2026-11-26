/**
 * The comparisons API's service (t-87): the routes parse, this does.
 *
 * A comparison is 2–5 drafts reviewed the same way: the review options are
 * resolved once (`resolveReviewOptions`, as a single review resolves them),
 * so every draft gets the same framework version, context, project, overlay
 * and judges. Each draft is then an ordinary review: listed in the
 * workspace's history, opened as its own report, queued and run as any other
 * (`enqueue.ts`, `run.ts`). Reviews past the workspace's running places wait
 * queued and start as places free; nothing here schedules them.
 *
 * **Refused whole.** Everything that can be refused is checked before
 * anything is written: the options, every draft's text, and the budget for
 * every draft together (`reserveComparisonBudget`), so a workspace that
 * cannot cover all of them stores none (402). Then every draft's content and
 * review, the set and its members are written in one transaction.
 *
 * **A review the workspace already has** (t-84) can be a draft, named by
 * `assessmentId`: the original a rewrite was made from, compared with the
 * rewrite. It joins the set as it is, so it is not run, held for or charged
 * again; only the drafts given as text are. It must have been reviewed the
 * way the set is (the same version, AI reviewers, context, weights and
 * project), or the scores would not compare like for like, and must have
 * completed: a failed, cancelled or partial one is not weighed by the
 * verdict, and one queued or running may yet end so. Both are refused with
 * 409 `REVIEW_NOT_COMPARABLE` (`reusedReviews`), its status checked again
 * under a lock as the set is written.
 *
 * Deleting a comparison deletes the set, not its reviews: each stays in the
 * workspace's history. Deleting or purging a review leaves its draft's place
 * in the set, read as purged (`views.ts`).
 *
 * Runs in the caller's tenant context (the route's guard). Every refusal is
 * an `APIError`.
 */
import type { Prisma } from '@prisma/client';
import { APIError, NotFoundError } from '@/lib/api/errors';
import { jsonEquals } from '@/lib/utils/json-equal';
import { requireOrgId } from '@/lib/tenancy/context';
import { prisma } from '@/lib/db/client';
import {
  enqueueAssessments,
  startAssessmentInBackground,
  storedProfileName,
} from '@/lib/app/assessments/enqueue';
import { assessableText } from '@/lib/app/assessments/text';
import {
  refusingAsApi,
  requestedViaOf,
  resolveReviewOptions,
  storedContext,
  type Caller,
  type ResolvedReviewOptions,
} from '@/lib/app/assessments/api/service';
import {
  assertReviewFits,
  reserveComparisonBudget,
  type BudgetHold,
  type ReviewRate,
} from '@/lib/app/usage/budget';
import { isTextDraft, type CreateComparisonBody } from '@/lib/app/comparisons/validations';
import { readComparison, type ComparisonDetail } from '@/lib/app/comparisons/views';
import {
  estimateComparisonVerdict,
  verdictRuns,
  type VerdictSkipReason,
} from '@/lib/app/comparisons/verdict';

/** A request checked as far as it can be without writing anything. */
export interface PreparedComparison extends ResolvedReviewOptions {
  /**
   * What the request holds of the budget, one hold per draft, taken by
   * {@link holdComparisonBudget}; empty when it holds nothing. Each is
   * released once the drafts are stored; whoever took them releases them
   * again however the request ends, which is safe.
   */
  holds: BudgetHold[];
  /** The cost per judge the budget check read, for the hold's check to reuse. */
  rate: ReviewRate | null;
  /**
   * What the editor's verdict is held at, in USD (t-88): checked and held
   * with the drafts, then kept on the comparison until its verdict ends.
   */
  verdictUsd: number;
  /**
   * The drafts named as existing reviews (t-84), by their place in `drafts`:
   * each review's id and text. Every other draft is reviewed with the set.
   */
  reused: ReadonlyMap<number, ReusedReview>;
  /** How many drafts the set reviews: those given as text. Each is held, counted and charged. */
  toReview: number;
}

/** A review that joins a comparison as it is (t-84). */
export interface ReusedReview {
  assessmentId: string;
  text: string;
}

/** What a review was reviewed with that a comparison's members must share (t-84). */
export type ReviewOptionField = 'version' | 'judges' | 'context' | 'weights' | 'project';

/**
 * Statuses a reused review is refused in, each with its `reason`: one ended
 * unscored has nothing to compare; one partly scored is not weighed by the
 * verdict, so a draft compared with it would get none; and one not finished
 * may yet end either way, so only a completed review joins.
 */
const NOT_COMPARABLE: ReadonlyMap<string, { reason: string; message: string }> = new Map([
  [
    'FAILED',
    {
      reason: 'not_scored',
      message: 'That review ended without a score, so it cannot be compared.',
    },
  ],
  [
    'CANCELLED',
    {
      reason: 'not_scored',
      message: 'That review ended without a score, so it cannot be compared.',
    },
  ],
  ...(['QUEUED', 'RUNNING'] as const).map(
    (status) =>
      [
        status,
        {
          reason: 'not_finished',
          message: 'That review has not finished yet. Compare it once it has.',
        },
      ] as const
  ),
  [
    'PARTIAL',
    {
      reason: 'partly_scored',
      message:
        'That review was only partly scored, so the editor could not weigh it in a comparison.',
    },
  ],
]);

/** Refuse a reused review that is gone (404) or not completed (409), at `position`. */
function assertComparable(
  row: { status: string } | undefined,
  position: number
): asserts row is { status: string } {
  if (!row) {
    throw new APIError('There is no such review in this workspace.', 'ASSESSMENT_NOT_FOUND', 404, {
      position,
    });
  }
  const refused = NOT_COMPARABLE.get(row.status);
  if (refused) {
    throw new APIError(refused.message, 'REVIEW_NOT_COMPARABLE', 409, {
      position,
      reason: refused.reason,
    });
  }
}

/**
 * The drafts `body` names as existing reviews, each checked to join a set
 * reviewed with `options` (t-84): in this workspace (404
 * `ASSESSMENT_NOT_FOUND`), completed, and reviewed the same way (409
 * `REVIEW_NOT_COMPARABLE`, `details.reason` `not_scored`, `partly_scored`,
 * `not_finished`, or `options_differ` with the fields that differ). Each
 * refusal carries the draft's `position`. Checked again, locked, as the set
 * is written ({@link lockReusedReviews}).
 */
async function reusedReviews(
  body: CreateComparisonBody,
  options: ResolvedReviewOptions
): Promise<Map<number, ReusedReview>> {
  const named = body.drafts.flatMap((draft, position) =>
    isTextDraft(draft) ? [] : [{ position, assessmentId: draft.assessmentId }]
  );
  const reused = new Map<number, ReusedReview>();
  if (named.length === 0) return reused;
  const rows = await prisma.assessment.findMany({
    where: { orgId: requireOrgId(), id: { in: named.map((n) => n.assessmentId) } },
    select: {
      id: true,
      status: true,
      frameworkVersionId: true,
      judges: true,
      context: true,
      overlay: true,
      projectId: true,
      content: { select: { text: true } },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const context = storedContext(options.ctx);
  for (const { position, assessmentId } of named) {
    const row = byId.get(assessmentId);
    assertComparable(row, position);
    const differs: ReviewOptionField[] = [];
    if (row.frameworkVersionId !== options.resolved.version.id) differs.push('version');
    if (!jsonEquals(row.judges, [...options.judges])) differs.push('judges');
    if (!jsonEquals(row.context, context)) differs.push('context');
    if (!jsonEquals(row.overlay ?? null, options.overlay ?? null)) differs.push('weights');
    if (row.projectId !== options.projectId) differs.push('project');
    if (differs.length > 0) {
      throw new APIError(
        'That review was not reviewed the way this comparison is, so its scores would not compare.',
        'REVIEW_NOT_COMPARABLE',
        409,
        { position, reason: 'options_differ', differs }
      );
    }
    reused.set(position, { assessmentId, text: row.content.text });
  }
  return reused;
}

/**
 * Lock the reviews `prepared` reuses in the set's transaction and check
 * again that each still exists and is completed: one deleted, purged or
 * re-run since {@link reusedReviews} read it is refused as it would have been
 * then, and held until the commit it cannot change before the set is stored.
 * The options it was reviewed with are not checked again: a review's are
 * written once, as it is made.
 */
async function lockReusedReviews(
  tx: Prisma.TransactionClient,
  orgId: string,
  reused: ReadonlyMap<number, ReusedReview>
): Promise<void> {
  if (reused.size === 0) return;
  const ids = [...reused.values()].map((r) => r.assessmentId);
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status::text AS status FROM "app_assessment"
    WHERE "orgId" = ${orgId} AND id = ANY(${ids})
    FOR SHARE`;
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const [position, { assessmentId }] of reused) {
    assertComparable(byId.get(assessmentId), position);
  }
}

/**
 * Everything that can be refused before anything is held or written: the
 * options (as a single review's), each draft's text, each review it names
 * ({@link reusedReviews}), and every draft's estimate it reviews with the
 * verdict's together against the workspace's credits and
 * monthly budget (402).
 * Holds nothing: once this has passed, the route checks the per-user cap,
 * holds with {@link holdComparisonBudget}, then counts the drafts against it.
 */
export async function prepareComparison(body: CreateComparisonBody): Promise<PreparedComparison> {
  const options = await resolveReviewOptions(body);
  for (const [position, draft] of body.drafts.entries()) {
    if (!isTextDraft(draft)) continue;
    try {
      await refusingAsApi(() => assessableText(draft.text));
    } catch (err) {
      // Which draft to fix, by its place in `drafts`.
      if (err instanceof APIError) err.details = { ...err.details, position };
      throw err;
    }
  }
  const reused = await reusedReviews(body, options);
  const toReview = body.drafts.length - reused.size;
  const orgId = requireOrgId();
  // The project's brief, which the verdict's call reads, for its ceiling.
  const project =
    options.projectId && verdictRuns(options.judges)
      ? await prisma.project.findFirst({
          where: { id: options.projectId, orgId },
          select: { brief: true },
        })
      : null;
  const verdictUsd = await estimateComparisonVerdict(
    orgId,
    options.resolved.engine,
    options.ctx,
    body.drafts.map((draft, position) => ({
      // Every review it names is in `reused` by now.
      text: isTextDraft(draft) ? draft.text : (reused.get(position)?.text ?? ''),
      label: draft.label,
    })),
    options.judges,
    project?.brief
  );
  const rate = await assertReviewFits(
    orgId,
    storedProfileName(options.profile),
    options.judges.length,
    true,
    toReview,
    verdictUsd
  );
  return { ...options, holds: [], rate, verdictUsd, reused, toReview };
}

/**
 * Check every draft it reviews against the budget again and hold their estimates under
 * the lock that orders requests arriving together, as `prepared.holds`: the
 * last step before {@link createComparison}. Throws 402 when requests checked
 * before it took what was left, holding nothing.
 */
export async function holdComparisonBudget(prepared: PreparedComparison): Promise<void> {
  prepared.holds = await reserveComparisonBudget(
    requireOrgId(),
    storedProfileName(prepared.profile),
    prepared.judges.length,
    prepared.toReview,
    prepared.rate ?? undefined,
    prepared.verdictUsd
  );
}

/** Release every hold a request took; safe to call again. */
export async function releaseHolds(prepared: PreparedComparison): Promise<void> {
  await Promise.all(prepared.holds.map((hold) => hold.release()));
}

/**
 * Store the review of every draft given as text and the set, with the
 * reviews it reuses as members, in one transaction, then start the new
 * reviews. Those the workspace has no running place for wait queued, and the
 * next of its runs to end starts one (`run.ts`).
 */
export async function createComparison(
  body: CreateComparisonBody,
  prepared: PreparedComparison,
  caller: Caller
): Promise<ComparisonDetail> {
  const orgId = requireOrgId();
  const context = storedContext(prepared.ctx);
  const textDrafts = body.drafts.flatMap((draft) => (isTextDraft(draft) ? [draft] : []));
  let written;
  try {
    written = await refusingAsApi(() =>
      enqueueAssessments(
        textDrafts.map((draft) => ({
          content: {
            text: draft.text,
            title: draft.label ?? null,
            sourceKind: 'TEXT' as const,
            projectId: prepared.projectId,
          },
          frameworkVersionId: prepared.resolved.version.id,
          profile: prepared.profile,
          context,
          overlay: prepared.overlay,
          requestedVia: requestedViaOf(caller),
          apiKeyId: caller.apiKeyId,
          userId: caller.userId,
        })),
        async (tx, enqueued) => {
          await lockReusedReviews(tx, orgId, prepared.reused);
          const set = await tx.assessmentSet.create({
            data: {
              orgId,
              kind: 'COMPARISON',
              projectId: prepared.projectId,
              frameworkVersionId: prepared.resolved.version.id,
              profile: storedProfileName(prepared.profile),
              judges: [...prepared.judges],
              context,
              createdByUserId: caller.userId,
              // Held from here until it ends (t-88); one that will not run holds nothing.
              ...(verdictRuns(prepared.judges)
                ? { verdictHeldUsd: prepared.verdictUsd }
                : {
                    verdictStatus: 'SKIPPED' as const,
                    verdictReason: 'too_few_judges' satisfies VerdictSkipReason,
                  }),
            },
            select: { id: true },
          });
          // The comparison holds the verdict's part from here: the request's
          // hold stops holding it in the same commit, so no check counts it twice.
          const [first] = prepared.holds;
          if (first && verdictRuns(prepared.judges)) {
            await tx.budgetHold.updateMany({ where: { id: first.id }, data: { extraUsd: 0 } });
          }
          // In the order sent: the new reviews fill the places not reused, in turn.
          const fresh = enqueued.map((review) => review.assessmentId);
          let next = 0;
          await tx.assessmentSetMember.createMany({
            data: body.drafts.map((draft, position) => ({
              orgId,
              setId: set.id,
              assessmentId: prepared.reused.get(position)?.assessmentId ?? fresh[next++],
              position,
              label: draft.label ?? null,
            })),
          });
          return set.id;
        },
        // A comparison writes a set and every draft's place, and waits on the
        // lock of a reused review a run is writing: never one review's share.
        { several: true }
      )
    );
  } finally {
    // Stored, each review is held in its place; refused, nothing is. Before
    // the runs are claimed, whose check would count these holds against the
    // reviews they became.
    await releaseHolds(prepared);
  }

  for (const review of written.enqueued) startAssessmentInBackground(review.assessmentId);
  const comparison = await readComparison(written.also);
  // Deleted under us, by another request, between the write and this read.
  if (!comparison) throw new NotFoundError('Comparison not found');
  return comparison;
}

/** One of this workspace's comparisons, or 404. */
export async function getComparison(id: string): Promise<ComparisonDetail> {
  const comparison = await readComparison(id);
  if (!comparison) throw new NotFoundError('Comparison not found');
  return comparison;
}

/**
 * Delete a comparison: the set and its drafts' places, not their reviews,
 * which stay in the workspace's history and are deleted as any review is.
 * A verdict whose call is still running charges itself as it ends; one whose
 * process was lost is charged by the recovery tick (`verdict.ts`).
 */
export async function removeComparison(id: string): Promise<{ deleted: true }> {
  const { count } = await prisma.assessmentSet.deleteMany({
    where: { id, orgId: requireOrgId(), kind: 'COMPARISON' },
  });
  if (count === 0) throw new NotFoundError('Comparison not found');
  return { deleted: true };
}

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
 * Deleting a comparison deletes the set, not its reviews: each stays in the
 * workspace's history. Deleting or purging a review leaves its draft's place
 * in the set, read as purged (`views.ts`).
 *
 * Runs in the caller's tenant context (the route's guard). Every refusal is
 * an `APIError`.
 */
import { APIError, NotFoundError } from '@/lib/api/errors';
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
import type { CreateComparisonBody } from '@/lib/app/comparisons/validations';
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
}

/**
 * Everything that can be refused before anything is held or written: the
 * options (as a single review's), each draft's text, and every draft's
 * estimate with the verdict's together against the workspace's credits and
 * monthly budget (402).
 * Holds nothing: once this has passed, the route checks the per-user cap,
 * holds with {@link holdComparisonBudget}, then counts the drafts against it.
 */
export async function prepareComparison(body: CreateComparisonBody): Promise<PreparedComparison> {
  const options = await resolveReviewOptions(body);
  for (const [position, draft] of body.drafts.entries()) {
    try {
      await refusingAsApi(() => assessableText(draft.text));
    } catch (err) {
      // Which draft to fix, by its place in `drafts`.
      if (err instanceof APIError) err.details = { ...err.details, position };
      throw err;
    }
  }
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
    body.drafts,
    options.judges,
    project?.brief
  );
  const rate = await assertReviewFits(
    orgId,
    storedProfileName(options.profile),
    options.judges.length,
    true,
    body.drafts.length,
    verdictUsd
  );
  return { ...options, holds: [], rate, verdictUsd };
}

/**
 * Check every draft against the budget again and hold their estimates under
 * the lock that orders requests arriving together, as `prepared.holds`: the
 * last step before {@link createComparison}. Throws 402 when requests checked
 * before it took what was left, holding nothing.
 */
export async function holdComparisonBudget(
  body: CreateComparisonBody,
  prepared: PreparedComparison
): Promise<void> {
  prepared.holds = await reserveComparisonBudget(
    requireOrgId(),
    storedProfileName(prepared.profile),
    prepared.judges.length,
    body.drafts.length,
    prepared.rate ?? undefined,
    prepared.verdictUsd
  );
}

/** Release every hold a request took; safe to call again. */
export async function releaseHolds(prepared: PreparedComparison): Promise<void> {
  await Promise.all(prepared.holds.map((hold) => hold.release()));
}

/**
 * Store every draft's review and the set in one transaction, then start the
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
  let written;
  try {
    written = await refusingAsApi(() =>
      enqueueAssessments(
        body.drafts.map((draft) => ({
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
          requestedVia: caller.apiKeyId ? ('API' as const) : ('APP' as const),
          apiKeyId: caller.apiKeyId,
          userId: caller.userId,
        })),
        async (tx, enqueued) => {
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
          await tx.assessmentSetMember.createMany({
            data: enqueued.map((review, position) => ({
              orgId,
              setId: set.id,
              assessmentId: review.assessmentId,
              position,
              label: body.drafts[position].label ?? null,
            })),
          });
          return set.id;
        }
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

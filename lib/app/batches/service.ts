/**
 * The batches API's service (t-101, `.context/app/batches.md`): the routes
 * parse, this does.
 *
 * A batch is many texts or pages reviewed the same way, with no verdict: a
 * comparison's set (`lib/app/comparisons/service.ts`) with more members and
 * nothing asked of the editor. The review options are resolved once
 * (`resolveReviewOptions`), so every item gets the same framework version,
 * context, project, overlay and AI reviewers. Each item is then an ordinary
 * review, listed in the workspace's history, opened as its own report,
 * queued and run as any other.
 *
 * **Refused whole.** Everything that can be refused is checked before
 * anything is written: the options, every pasted text, and the budget and
 * credits for every item together (`reserveSetBudget`), so a workspace that
 * cannot cover all of them stores none (402). The estimate comes from the
 * workspace's history, not the text, which is why a batch of pages can be
 * checked before any page is read. Then every item's content and review, the
 * set and its members are written in one transaction.
 *
 * **A page is fetched when its own review starts**, never here: its content
 * is stored with the address and no text, and its run fetches it
 * (`lib/app/assessments/run.ts`). One that cannot be read fails that item
 * alone, with intake's code, and the rest carry on.
 *
 * **Places.** A workspace runs {@link RUNNING_PER_WORKSPACE} reviews at once.
 * This starts at most that many of the batch's items; each run that ends
 * starts the workspace's next queued review (`startNextQueued`), and the
 * recovery job is the backstop. Starting all of a hundred at once would only
 * have ninety-seven claims refused.
 *
 * **No verdict.** The set is born `SKIPPED` (`not_asked`), so the verdict
 * machinery, which takes only `WAITING` sets, never picks it up and the
 * budget never holds a verdict for it. Its `app.batch.finished` event goes
 * once every item has ended (`lib/app/events/notify.ts`).
 *
 * Deleting a batch deletes the set, not its reviews: each stays in the
 * workspace's history. Runs in the caller's tenant context (the route's
 * guard). Every refusal is an `APIError`.
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
import { RUNNING_PER_WORKSPACE } from '@/lib/app/assessments/limits';
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
  reserveSetBudget,
  type BudgetHold,
  type ReviewRate,
} from '@/lib/app/usage/budget';
import type { VerdictSkipReason } from '@/lib/app/comparisons/verdict';
import { isTextItem, type CreateBatchBody } from '@/lib/app/batches/validations';
import { readBatch, type BatchDetail } from '@/lib/app/batches/views';

/** A request checked as far as it can be without writing anything. */
export interface PreparedBatch extends ResolvedReviewOptions {
  /**
   * What the request holds of the budget, one hold per item, taken by
   * {@link holdBatchBudget}; empty when it holds nothing. Released once the
   * items are stored; whoever took them releases them again however the
   * request ends, which is safe.
   */
  holds: BudgetHold[];
  /** The cost per judge the budget check read, for the hold's check to reuse. */
  rate: ReviewRate | null;
}

/**
 * Everything that can be refused before anything is held or written: the
 * options (as a single review's), each pasted text, and every item's
 * estimate together against the workspace's credits and monthly budget
 * (402). A page's address is checked by the schema; whether it can be read
 * is its own review's to find out. Holds nothing: once this has passed, the
 * route checks the per-user cap, holds with {@link holdBatchBudget}, then
 * counts the items against it.
 */
export async function prepareBatch(body: CreateBatchBody): Promise<PreparedBatch> {
  const options = await resolveReviewOptions(body);
  for (const [position, item] of body.items.entries()) {
    if (!isTextItem(item)) continue;
    try {
      await refusingAsApi(() => assessableText(item.text));
    } catch (err) {
      // Which item to fix, by its place in `items`.
      if (err instanceof APIError) err.details = { ...err.details, position };
      throw err;
    }
  }
  const rate = await assertReviewFits(
    requireOrgId(),
    storedProfileName(options.profile),
    options.judges.length,
    true,
    body.items.length
  );
  return { ...options, holds: [], rate };
}

/**
 * Check every item against the budget again and hold their estimates under
 * the lock that orders requests arriving together, as `prepared.holds`: the
 * last step before {@link createBatch}. Throws 402 when requests checked
 * before it took what was left, holding nothing.
 */
export async function holdBatchBudget(
  body: CreateBatchBody,
  prepared: PreparedBatch
): Promise<void> {
  prepared.holds = await reserveSetBudget(
    requireOrgId(),
    storedProfileName(prepared.profile),
    prepared.judges.length,
    body.items.length,
    prepared.rate ?? undefined
  );
}

/** Release every hold a request took; safe to call again. */
export async function releaseBatchHolds(prepared: PreparedBatch): Promise<void> {
  await Promise.all(prepared.holds.map((hold) => hold.release()));
}

/**
 * Store every item's review and the set in one transaction, then start as
 * many as the workspace has places for: see "Places" in the file header.
 *
 * `onStored` is told the batch's id as soon as it is written, so a caller
 * that cannot let a later failure lose it can still answer it.
 */
export async function createBatch(
  body: CreateBatchBody,
  prepared: PreparedBatch,
  caller: Caller,
  options: { onStored?: (batchId: string) => void } = {}
): Promise<BatchDetail> {
  const orgId = requireOrgId();
  const context = storedContext(prepared.ctx);
  let written;
  try {
    written = await refusingAsApi(() =>
      enqueueAssessments(
        body.items.map((item) => ({
          content: isTextItem(item)
            ? {
                text: item.text,
                title: item.label ?? null,
                sourceKind: 'TEXT' as const,
                projectId: prepared.projectId,
              }
            : {
                // Fetched when its review starts (`run.ts`); titled by the page then, unless labelled.
                text: null,
                title: item.label ?? null,
                sourceKind: 'URL' as const,
                sourceUrl: item.url,
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
          const set = await tx.assessmentSet.create({
            data: {
              orgId,
              kind: 'BATCH',
              projectId: prepared.projectId,
              frameworkVersionId: prepared.resolved.version.id,
              profile: storedProfileName(prepared.profile),
              judges: [...prepared.judges],
              context,
              createdByUserId: caller.userId,
              // Settled from birth: nothing is asked of the editor, and nothing held for it.
              verdictStatus: 'SKIPPED',
              verdictReason: 'not_asked' satisfies VerdictSkipReason,
            },
            select: { id: true },
          });
          await tx.assessmentSetMember.createMany({
            data: body.items.map((item, position) => ({
              orgId,
              setId: set.id,
              assessmentId: enqueued[position].assessmentId,
              position,
              label: item.label ?? null,
            })),
          });
          return set.id;
        },
        { several: true }
      )
    );
  } finally {
    // Stored, each review is held in its place; refused, nothing is. Before
    // the runs are claimed, whose check would count these holds against the
    // reviews they became.
    await releaseBatchHolds(prepared);
  }

  options.onStored?.(written.also);
  // In the order sent; the rest start as places free (`startNextQueued`).
  for (const review of written.enqueued.slice(0, RUNNING_PER_WORKSPACE)) {
    startAssessmentInBackground(review.assessmentId);
  }
  const batch = await readBatch(written.also);
  // Deleted under us, by another request, between the write and this read.
  if (!batch) throw new NotFoundError('Batch not found');
  return batch;
}

/** One of this workspace's batches, or 404. */
export async function getBatch(id: string): Promise<BatchDetail> {
  const batch = await readBatch(id);
  if (!batch) throw new NotFoundError('Batch not found');
  return batch;
}

/**
 * Delete a batch: the set and its items' places, not their reviews, which
 * stay in the workspace's history and are deleted as any review is. Items
 * still queued or running carry on.
 */
export async function removeBatch(id: string): Promise<{ deleted: true }> {
  const { count } = await prisma.assessmentSet.deleteMany({
    where: { id, orgId: requireOrgId(), kind: 'BATCH' },
  });
  if (count === 0) throw new NotFoundError('Batch not found');
  return { deleted: true };
}

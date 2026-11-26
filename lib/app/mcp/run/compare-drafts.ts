/**
 * The work of `compare_drafts` (t-93), loaded on its first call.
 *
 * The route's steps in the route's order (`app/api/v1/comparisons/route.ts`):
 * `prepareComparison`, the per-person cap peeked for every draft it reviews,
 * `holdComparisonBudget`, the cap peeked again and every draft counted with
 * no await between, `createComparison`, and the holds released however the
 * call ends. So credits, the budget and the cap hold exactly as they do over
 * the API. Before any of it, the key's creator must still be able to spend in
 * the key's workspace (`spender.ts`).
 *
 * The route answers 202 at once. A tool call that did would leave the
 * assistant nothing to say, so this waits up to `MCP_WAIT_MS`, as
 * `assess_draft` does, for the comparison to settle (`comparisonSettled`),
 * then answers what it has: the verdict, or the id and status to read back
 * with `get_comparison`. The drafts' reviews and the verdict run on either
 * way; they were started in the background by `createComparison`.
 */
import { NotFoundError } from '@/lib/api/errors';
import { aiAssessmentLimiter } from '@/lib/app/assessments/api/limiter';
import { stateOf } from '@/lib/app/assessments/api/views';
import { POLL_MS } from '@/lib/app/assessments/limits';
import {
  createComparison,
  getComparison,
  holdComparisonBudget,
  prepareComparison,
  releaseHolds,
} from '@/lib/app/comparisons/service';
import type { CreateComparisonBody } from '@/lib/app/comparisons/validations';
import { comparisonState } from '@/lib/app/comparisons/views';
import {
  comparisonSettled,
  summariseComparison,
  type ComparisonSummaryForAssistant,
} from '@/lib/app/mcp/comparison-summary';
import { refusalOf } from '@/lib/app/mcp/run/refusal';
import { capRefusal, spenderRefusal } from '@/lib/app/mcp/run/spender';
import { MCP_WAIT_MS, type ToolOutcome } from '@/lib/app/mcp/tool-support';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { requireOrgId } from '@/lib/tenancy/context';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether the comparison has settled, read from its drafts' and its
 * verdict's statuses alone: the full view (`readComparison`) loads every
 * draft's result and the framework's code, too much to read once a second.
 * Gone (deleted under us) counts as settled, for the final read to say so.
 */
async function settledNow(id: string): Promise<boolean> {
  const row = await prisma.assessmentSet.findUnique({
    where: { id, orgId: requireOrgId(), kind: 'COMPARISON' },
    select: {
      verdictStatus: true,
      members: { select: { assessment: { select: { status: true } } } },
    },
  });
  if (!row) return true;
  const drafts = row.members.map((m) => ({
    status: m.assessment ? stateOf(m.assessment.status) : ('purged' as const),
  }));
  return comparisonSettled({
    status: comparisonState(drafts),
    verdict: { status: row.verdictStatus.toLowerCase() },
  });
}

/** Wait until the comparison settles or `MCP_WAIT_MS` has passed, whichever is first. */
async function waitToSettle(id: string): Promise<void> {
  const deadline = Date.now() + MCP_WAIT_MS;
  while (Date.now() < deadline) {
    if (await settledNow(id)) return;
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  }
}

export async function compareDraftsTool(
  body: CreateComparisonBody,
  userId: string
): Promise<ToolOutcome<ComparisonSummaryForAssistant>> {
  const refused = await spenderRefusal(userId);
  if (refused) return { refusal: refused };
  // Set once the comparison is written: from then on, a failure answers its id.
  let storedId: string | undefined;
  try {
    const prepared = await prepareComparison(body);
    try {
      if (prepared.judges.length > 0) {
        // Each draft it reviews counts against the cap; a reused review does not.
        const key = `user:${userId}`;
        const refusedByCap = () => {
          const room = aiAssessmentLimiter.peek(key);
          return room.remaining < prepared.toReview ? capRefusal(room.reset, 'reviews') : null;
        };
        const early = refusedByCap();
        if (early) return { refusal: early };
        // Held before any draft is counted, so a set the budget refuses counts none.
        await holdComparisonBudget(prepared);
        // Checked again and counted with no await between, as the route does.
        const late = refusedByCap();
        if (late) return { refusal: late };
        for (let i = 0; i < prepared.toReview; i++) aiAssessmentLimiter.check(key);
      }
      await createComparison(
        body,
        prepared,
        { userId, apiKeyId: null, via: 'MCP' },
        {
          onStored: (id) => {
            storedId = id;
          },
        }
      );
    } finally {
      // The budget it held, however the call ended (a no-op once stored).
      await releaseHolds(prepared);
    }
    // Narrowed for the type: `createComparison` calls `onStored` before it returns.
    if (storedId === undefined) throw new Error('compare_drafts: the comparison was not stored');
    await waitToSettle(storedId);
    return { data: summariseComparison(await getComparison(storedId)) };
  } catch (err) {
    if (storedId !== undefined && err instanceof NotFoundError) {
      // Deleted while it ran, by someone in the workspace: reading it back would find nothing.
      return {
        refusal: {
          code: 'NOT_FOUND',
          message: `The comparison ${storedId} was deleted while it ran. Its drafts' reviews stay in the workspace.`,
        },
      };
    }
    if (storedId !== undefined) {
      // Stored, so possibly charged: an assistant told only "failed" would start another.
      logger.error('compare_drafts failed after storing its comparison', err, {
        comparisonId: storedId,
      });
      return {
        refusal: {
          code: 'STORED_UNREAD',
          message: `The comparison was stored as ${storedId} but could not be read back just now. Call get_comparison with that id; do not start another comparison.`,
        },
      };
    }
    const refusal = refusalOf(err);
    if (!refusal) throw err;
    return { refusal };
  }
}

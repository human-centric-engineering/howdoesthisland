/**
 * The work of `assess_draft` (t-92), loaded on its first call.
 *
 * The route's steps in the route's order (`prepareAssessment`, the per-person
 * cap, `holdReviewBudget`, `createAssessment`), so credits, the review budget
 * and the workspace's running limit hold exactly as they do over the API.
 *
 * Before any of it, the key's creator must still be able to spend in the
 * key's workspace (`spender.ts`).
 */
import { aiAssessmentLimiter } from '@/lib/app/assessments/api/limiter';
import {
  createAssessment,
  holdReviewBudget,
  prepareAssessment,
} from '@/lib/app/assessments/api/service';
import type { AssessmentRequest } from '@/lib/app/assessments/api/validations';
import { startWaitingReviews } from '@/lib/app/assessments/kick';
import { WorkspaceBusyError } from '@/lib/app/assessments/places';
import {
  storedButUnread,
  summariseAssessment,
  type AssessmentSummaryForAssistant,
} from '@/lib/app/mcp/assessment-summary';
import { refusalOf } from '@/lib/app/mcp/run/refusal';
import { capRefusal, spenderRefusal } from '@/lib/app/mcp/run/spender';
import { MCP_WAIT_MS, type ToolOutcome } from '@/lib/app/mcp/tool-support';
import { logger } from '@/lib/logging';
import { requireOrgId } from '@/lib/tenancy/context';

export async function assessDraftTool(
  body: AssessmentRequest,
  userId: string
): Promise<ToolOutcome<AssessmentSummaryForAssistant>> {
  const refused = await spenderRefusal(userId);
  if (refused) return { refusal: refused };
  // Set once the review's row is written: from then on, a failure answers its id.
  let storedId: string | undefined;
  try {
    const prepared = await prepareAssessment(body);
    try {
      if (prepared.judges.length > 0) {
        const limit = aiAssessmentLimiter.check(`user:${userId}`);
        if (!limit.success) return { refusal: capRefusal(limit.reset, 'reviews') };
        await holdReviewBudget(body, prepared);
      }
      const created = await createAssessment(
        body,
        prepared,
        { userId, apiKeyId: null, via: 'MCP' },
        {
          boundMs: MCP_WAIT_MS,
          onStored: (id) => {
            storedId = id;
          },
        }
      );
      // `wait: true` and stored, so never ephemeral; narrowed for the type.
      if (created.kind !== 'stored') {
        return { refusal: { code: 'NOT_STORED', message: 'The review was not stored.' } };
      }
      try {
        return { data: await summariseAssessment(created.assessment) };
      } catch (err) {
        // The review is stored and may be paid for: answer its id, never a bare failure.
        logger.error('assess_draft could not summarise a stored review', err, {
          assessmentId: created.assessment.id,
        });
        return { data: storedButUnread(created.assessment) };
      }
    } finally {
      await prepared.hold?.release();
    }
  } catch (err) {
    if (storedId !== undefined) {
      // Stored, so possibly charged: an assistant told only "failed" would start another.
      logger.error('assess_draft failed after storing its review', err, { assessmentId: storedId });
      return {
        refusal: {
          code: 'STORED_UNREAD',
          message: `The review was stored as ${storedId} but could not be read back just now. Call get_assessment with that id; do not start another review.`,
        },
      };
    }
    if (err instanceof WorkspaceBusyError && err.queueCanStart) {
      startWaitingReviews(requireOrgId());
    }
    const refusal = refusalOf(err);
    if (!refusal) throw err;
    return { refusal };
  }
}

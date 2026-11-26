/**
 * The work of `assess_draft` (t-92), loaded on its first call.
 *
 * The route's steps in the route's order (`prepareAssessment`, the per-person
 * cap, `holdReviewBudget`, `createAssessment`), so credits, the review budget
 * and the workspace's running limit hold exactly as they do over the API.
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
  summariseAssessment,
  type AssessmentSummaryForAssistant,
} from '@/lib/app/mcp/assessment-summary';
import { refusalOf } from '@/lib/app/mcp/run/refusal';
import { MCP_WAIT_MS, type ToolOutcome } from '@/lib/app/mcp/tool-support';
import { requireOrgId } from '@/lib/tenancy/context';

export async function assessDraftTool(
  body: AssessmentRequest,
  userId: string
): Promise<ToolOutcome<AssessmentSummaryForAssistant>> {
  try {
    const prepared = await prepareAssessment(body);
    try {
      if (prepared.judges.length > 0) {
        const limit = aiAssessmentLimiter.check(`user:${userId}`);
        if (!limit.success) {
          const seconds = Math.max(1, limit.reset - Math.floor(Date.now() / 1000));
          return {
            refusal: {
              code: 'RATE_LIMITED',
              message: `Too many reviews started in the last minute. Try again in ${seconds} seconds.`,
            },
          };
        }
        await holdReviewBudget(body, prepared);
      }
      const created = await createAssessment(
        body,
        prepared,
        { userId, apiKeyId: null, via: 'MCP' },
        { boundMs: MCP_WAIT_MS }
      );
      // `wait: true` and stored, so never ephemeral; narrowed for the type.
      if (created.kind !== 'stored') {
        return { refusal: { code: 'NOT_STORED', message: 'The review was not stored.' } };
      }
      return { data: await summariseAssessment(created.assessment) };
    } finally {
      await prepared.hold?.release();
    }
  } catch (err) {
    if (err instanceof WorkspaceBusyError && err.queueCanStart) {
      startWaitingReviews(requireOrgId());
    }
    const refusal = refusalOf(err);
    if (!refusal) throw err;
    return { refusal };
  }
}

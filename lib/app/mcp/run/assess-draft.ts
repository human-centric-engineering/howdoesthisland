/**
 * The work of `assess_draft` (t-92), loaded on its first call.
 *
 * The route's steps in the route's order (`prepareAssessment`, the per-person
 * cap, `holdReviewBudget`, `createAssessment`), so credits, the review budget
 * and the workspace's running limit hold exactly as they do over the API.
 *
 * Before any of it, the key's creator must still be a member of the key's
 * workspace: a key outlives its creator's removal (only erasure nulls
 * `createdBy`), and the person a review is charged to must be one who can
 * spend there.
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
import { MCP_WAIT_MS, type ToolOutcome } from '@/lib/app/mcp/tool-support';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { verifiedMembership } from '@/lib/tenancy/entry';
import { requireOrgId } from '@/lib/tenancy/context';

export async function assessDraftTool(
  body: AssessmentRequest,
  userId: string
): Promise<ToolOutcome<AssessmentSummaryForAssistant>> {
  const membership = await verifiedMembership(userId, requireOrgId(), prisma);
  if ('refused' in membership) {
    if (membership.refused === 'org-suspended') {
      return {
        refusal: {
          code: 'WORKSPACE_SUSPENDED',
          message: 'This workspace is suspended, so it cannot start work that spends credits.',
        },
      };
    }
    return {
      refusal: {
        code: 'KEY_HAS_NO_OWNER',
        message:
          'The person who made this MCP key is no longer in the workspace, so it cannot start work that spends credits. Ask a workspace owner for a new key.',
      },
    };
  }
  try {
    const prepared = await prepareAssessment(body);
    try {
      if (prepared.judges.length > 0) {
        const limit = aiAssessmentLimiter.check(`user:${userId}`);
        if (!limit.success) {
          const seconds = Math.max(1, limit.reset - Math.floor(Date.now() / 1000));
          return {
            refusal: {
              code: 'RATE_LIMIT_EXCEEDED',
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
    if (err instanceof WorkspaceBusyError && err.queueCanStart) {
      startWaitingReviews(requireOrgId());
    }
    const refusal = refusalOf(err);
    if (!refusal) throw err;
    return { refusal };
  }
}

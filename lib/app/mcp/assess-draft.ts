/**
 * `assess_draft` (t-92): `POST /api/v1/assessments` as an MCP tool.
 *
 * The route's steps in the route's order (`prepareAssessment`, the per-person
 * cap, `holdReviewBudget`, `createAssessment`), so credits, the review budget
 * and the workspace's running limit hold exactly as they do over the API.
 * What differs:
 *
 * - **The person is the key's creator.** The cap and the row's
 *   `createdByUserId` need one, so a key whose creator has gone is refused.
 * - **Always stored, and waited for up to {@link MCP_WAIT_MS}.** A review not
 *   kept could not be read back, and a tool call cannot hold its request for
 *   minutes; past the bound this answers the id and status, the review runs on
 *   (`keepRunningAfterResponse`), and `get_assessment` reads it.
 * - **Recorded as `MCP`**, not `APP`.
 *
 * Text or a public URL; a file needs the API's multipart upload.
 */
import { z } from 'zod';
import { aiAssessmentLimiter } from '@/lib/app/assessments/api/limiter';
import {
  createAssessment,
  holdReviewBudget,
  prepareAssessment,
} from '@/lib/app/assessments/api/service';
import { contextField, textField } from '@/lib/app/assessments/api/validations';
import type { AssessmentRequest } from '@/lib/app/assessments/api/validations';
import { MAX_URL_CHARS } from '@/lib/app/assessments/limits';
import { startWaitingReviews } from '@/lib/app/assessments/kick';
import { WorkspaceBusyError } from '@/lib/app/assessments/places';
import {
  summariseAssessment,
  type AssessmentSummaryForAssistant,
} from '@/lib/app/mcp/assessment-summary';
import { ASSESS_DRAFT } from '@/lib/app/mcp/definitions';
import {
  creatorOf,
  draftShape,
  isRefusal,
  MCP_WAIT_MS,
  refusalOf,
} from '@/lib/app/mcp/tool-support';
import {
  BaseCapability,
  type ProvenanceRedaction,
} from '@/lib/orchestration/capabilities/base-capability';
import type { CapabilityContext, CapabilityResult } from '@/lib/orchestration/capabilities/types';
import { requireOrgId } from '@/lib/tenancy/context';

export const assessDraftArgsSchema = z
  .strictObject({
    text: textField.optional(),
    url: z
      .url({ protocol: /^https?$/ })
      .max(MAX_URL_CHARS)
      .optional(),
    title: z.string().trim().min(1).max(200).optional(),
    projectId: z.string().min(1).max(64).optional(),
    context: contextField,
  })
  .refine((args) => (args.text === undefined) !== (args.url === undefined), {
    error: 'Give the draft as text or as a url, not both',
    path: ['text'],
  });

type Args = z.infer<typeof assessDraftArgsSchema>;

/** The tool's arguments as the API's request: stored, and waited for. */
export function assessmentRequestOf(args: Args): AssessmentRequest {
  return {
    source: args.text !== undefined ? { text: args.text } : { url: args.url ?? '' },
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
    ...(args.context !== undefined ? { context: args.context } : {}),
    wait: true,
  };
}

export class AssessDraftCapability extends BaseCapability<Args, AssessmentSummaryForAssistant> {
  readonly slug = ASSESS_DRAFT.name;
  readonly functionDefinition = ASSESS_DRAFT;
  /** A draft is the writer's own words, which may name people. */
  readonly processesPii = true;
  protected readonly schema = assessDraftArgsSchema;

  async execute(
    args: Args,
    context: CapabilityContext
  ): Promise<CapabilityResult<AssessmentSummaryForAssistant>> {
    const userId = creatorOf(context);
    if (isRefusal(userId)) return this.error(userId.message, userId.code);
    const body = assessmentRequestOf(args);
    try {
      const prepared = await prepareAssessment(body);
      try {
        if (prepared.judges.length > 0) {
          const limit = aiAssessmentLimiter.check(`user:${userId}`);
          if (!limit.success) {
            const seconds = Math.max(1, limit.reset - Math.floor(Date.now() / 1000));
            return this.error(
              `Too many reviews started in the last minute. Try again in ${seconds} seconds.`,
              'RATE_LIMITED'
            );
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
          return this.error('The review was not stored.', 'NOT_STORED');
        }
        return this.success(await summariseAssessment(created.assessment));
      } finally {
        await prepared.hold?.release();
      }
    } catch (err) {
      if (err instanceof WorkspaceBusyError && err.queueCanStart) {
        startWaitingReviews(requireOrgId());
      }
      const refusal = refusalOf(err);
      if (!refusal) throw err;
      return this.error(refusal.message, refusal.code);
    }
  }

  redactProvenance(
    args: Args,
    result: CapabilityResult<AssessmentSummaryForAssistant>
  ): ProvenanceRedaction {
    return {
      args: {
        ...draftShape(args),
        ...(args.title !== undefined ? { title: '[title]' } : {}),
        projectId: args.projectId,
        context: args.context,
      },
      resultPreview: result.success
        ? JSON.stringify({ id: result.data?.id, status: result.data?.status })
        : JSON.stringify(result.error),
    };
  }
}

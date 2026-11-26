/**
 * `compare_drafts` (t-93): `POST /api/v1/comparisons` as an MCP tool.
 *
 * The route's steps in the route's order (`run/compare-drafts.ts`), so
 * credits, the budget and the per-person cap hold exactly as they do over the
 * API. What differs:
 *
 * - **The person is the key's creator**, as for `assess_draft`: a key whose
 *   creator has gone is refused before anything is loaded or charged.
 * - **Waited for up to `MCP_WAIT_MS`.** The route answers 202 at once; this
 *   waits the same bound as `assess_draft`, then answers the verdict, or the
 *   id and status for `get_comparison` to read back.
 * - **Recorded as `MCP`**: each draft's review is.
 * - **Every draft is reviewed with the defaults** (the full panel), or a
 *   project's: the tool takes no profile, judges or framework version, as
 *   `assess_draft` takes none, so a review it made can join a comparison.
 *
 * The work is loaded on the first call: why, in `tool-support.ts`.
 */
import { z } from 'zod';
import { contextField } from '@/lib/app/assessments/api/validations';
import {
  comparisonDraftsField,
  hasTextDraft,
  HAS_TEXT_DRAFT_ERROR,
  namesEachReviewOnce,
  NAMES_EACH_REVIEW_ONCE_ERROR,
} from '@/lib/app/comparisons/validations';
import type { ComparisonSummaryForAssistant } from '@/lib/app/mcp/comparison-summary';
import { COMPARE_DRAFTS } from '@/lib/app/mcp/definitions';
import { contextShape, creatorOf } from '@/lib/app/mcp/tool-support';
import {
  BaseCapability,
  type ProvenanceRedaction,
} from '@/lib/orchestration/capabilities/base-capability';
import type { CapabilityContext, CapabilityResult } from '@/lib/orchestration/capabilities/types';

export const compareDraftsArgsSchema = z
  .strictObject({
    drafts: comparisonDraftsField,
    projectId: z.string().min(1).max(64).optional(),
    context: contextField,
  })
  .refine((args) => hasTextDraft(args.drafts), { error: HAS_TEXT_DRAFT_ERROR, path: ['drafts'] })
  .refine((args) => namesEachReviewOnce(args.drafts), {
    error: NAMES_EACH_REVIEW_ONCE_ERROR,
    path: ['drafts'],
  });

type Args = z.infer<typeof compareDraftsArgsSchema>;

export class CompareDraftsCapability extends BaseCapability<Args, ComparisonSummaryForAssistant> {
  readonly slug = COMPARE_DRAFTS.name;
  readonly functionDefinition = COMPARE_DRAFTS;
  /** Drafts are the writer's own words, which may name people. */
  readonly processesPii = true;
  protected readonly schema = compareDraftsArgsSchema;

  async execute(
    args: Args,
    context: CapabilityContext
  ): Promise<CapabilityResult<ComparisonSummaryForAssistant>> {
    const userId = creatorOf(context);
    if (typeof userId !== 'string') return this.error(userId.message, userId.code);
    const { compareDraftsTool } = await import('@/lib/app/mcp/run/compare-drafts');
    const outcome = await compareDraftsTool(args, userId);
    if ('refusal' in outcome) return this.error(outcome.refusal.message, outcome.refusal.code);
    return this.success(outcome.data);
  }

  redactProvenance(
    args: Args,
    result: CapabilityResult<ComparisonSummaryForAssistant>
  ): ProvenanceRedaction {
    return {
      args: {
        // Each draft's size or the review it names, never its words or label.
        drafts: args.drafts.map((draft) => ({
          ...('text' in draft
            ? { textChars: draft.text.length }
            : { assessmentId: draft.assessmentId }),
          ...(draft.label !== undefined ? { label: '[label]' } : {}),
        })),
        projectId: args.projectId,
        context: contextShape(args.context),
      },
      resultPreview: result.success
        ? JSON.stringify({ id: result.data?.id, status: result.data?.status })
        : JSON.stringify(result.error),
    };
  }
}

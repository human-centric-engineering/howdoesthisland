/**
 * `get_assessment` (t-92): `GET /api/v1/assessments/{id}` as an MCP tool,
 * answering the summary an assistant needs (`assessment-summary.ts`).
 *
 * A tool, not an MCP resource, though `lib/app/mcp-resources.ts` prefers
 * resources for reads: a workspace's own agents and workflows dispatch
 * capabilities, not resources, and this is how `assess_draft`'s answer is
 * read once the review has finished. Reads only, so it needs no person
 * behind the key; another workspace's id is not found, as over the API.
 *
 * The work is loaded on the first call: why, in `tool-support.ts`.
 */
import { z } from 'zod';
import { assessmentIdParamSchema } from '@/lib/app/assessments/api/validations';
import type { AssessmentSummaryForAssistant } from '@/lib/app/mcp/assessment-summary';
import { GET_ASSESSMENT } from '@/lib/app/mcp/definitions';
import {
  BaseCapability,
  type ProvenanceRedaction,
} from '@/lib/orchestration/capabilities/base-capability';
import type { CapabilityContext, CapabilityResult } from '@/lib/orchestration/capabilities/types';

export const getAssessmentArgsSchema = z.strictObject({
  assessmentId: assessmentIdParamSchema.shape.id,
});

type Args = z.infer<typeof getAssessmentArgsSchema>;

export class GetAssessmentCapability extends BaseCapability<Args, AssessmentSummaryForAssistant> {
  readonly slug = GET_ASSESSMENT.name;
  readonly functionDefinition = GET_ASSESSMENT;
  /** The summary quotes the draft. */
  readonly processesPii = true;
  protected readonly schema = getAssessmentArgsSchema;

  async execute(
    args: Args,
    _context: CapabilityContext
  ): Promise<CapabilityResult<AssessmentSummaryForAssistant>> {
    const { getAssessmentTool } = await import('@/lib/app/mcp/run/get-assessment');
    const outcome = await getAssessmentTool(args.assessmentId);
    if ('refusal' in outcome) return this.error(outcome.refusal.message, outcome.refusal.code);
    return this.success(outcome.data);
  }

  redactProvenance(
    args: Args,
    result: CapabilityResult<AssessmentSummaryForAssistant>
  ): ProvenanceRedaction {
    return {
      args,
      resultPreview: result.success
        ? JSON.stringify({ id: result.data?.id, status: result.data?.status })
        : JSON.stringify(result.error),
    };
  }
}

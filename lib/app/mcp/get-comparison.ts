/**
 * `get_comparison` (t-93): `GET /api/v1/comparisons/{id}` as an MCP tool,
 * answering the summary an assistant needs (`comparison-summary.ts`).
 *
 * A tool rather than an MCP resource for the reason `get_assessment` is one:
 * it is how `compare_drafts`'s answer is read once the comparison has
 * finished, and a workspace's own agents dispatch capabilities. Reads only,
 * so it needs no person behind the key; another workspace's id is not
 * found, as over the API.
 *
 * The work is loaded on the first call: why, in `tool-support.ts`.
 */
import { z } from 'zod';
import { comparisonIdParamSchema } from '@/lib/app/comparisons/validations';
import type { ComparisonSummaryForAssistant } from '@/lib/app/mcp/comparison-summary';
import { GET_COMPARISON } from '@/lib/app/mcp/definitions';
import {
  BaseCapability,
  type ProvenanceRedaction,
} from '@/lib/orchestration/capabilities/base-capability';
import type { CapabilityContext, CapabilityResult } from '@/lib/orchestration/capabilities/types';

export const getComparisonArgsSchema = z.strictObject({
  comparisonId: comparisonIdParamSchema.shape.id,
});

type Args = z.infer<typeof getComparisonArgsSchema>;

export class GetComparisonCapability extends BaseCapability<Args, ComparisonSummaryForAssistant> {
  readonly slug = GET_COMPARISON.name;
  readonly functionDefinition = GET_COMPARISON;
  /** Drafts' labels and the verdict's reasons can quote the drafts. */
  readonly processesPii = true;
  protected readonly schema = getComparisonArgsSchema;

  async execute(
    args: Args,
    _context: CapabilityContext
  ): Promise<CapabilityResult<ComparisonSummaryForAssistant>> {
    const { getComparisonTool } = await import('@/lib/app/mcp/run/get-comparison');
    const outcome = await getComparisonTool(args.comparisonId);
    if ('refusal' in outcome) return this.error(outcome.refusal.message, outcome.refusal.code);
    return this.success(outcome.data);
  }

  redactProvenance(
    args: Args,
    result: CapabilityResult<ComparisonSummaryForAssistant>
  ): ProvenanceRedaction {
    return {
      args,
      resultPreview: result.success
        ? JSON.stringify({ id: result.data?.id, status: result.data?.status })
        : JSON.stringify(result.error),
    };
  }
}

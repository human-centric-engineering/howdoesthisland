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
import { idShape } from '@/lib/app/mcp/tool-support';
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
    // Only the id, and only if it reads as one: a chat turn's trace passes the
    // arguments as sent, stray keys and all.
    const sent: unknown = args;
    const comparisonId: unknown =
      typeof sent === 'object' && sent !== null ? Reflect.get(sent, 'comparisonId') : undefined;
    return {
      args: { comparisonId: idShape(comparisonId) },
      resultPreview: result.success
        ? JSON.stringify({ id: result.data?.id, status: result.data?.status })
        : JSON.stringify(result.error),
    };
  }
}

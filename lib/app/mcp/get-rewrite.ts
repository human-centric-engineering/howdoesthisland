/**
 * `get_rewrite` (t-94): `GET /api/v1/rewrites/{id}` as an MCP tool,
 * answering the summary an assistant needs (`rewrite-summary.ts`).
 *
 * A tool rather than an MCP resource for the reason `get_assessment` is one:
 * it is how `rewrite_draft`'s answer is read once the rewrite has finished,
 * and a workspace's own agents dispatch capabilities. Reads only, but the
 * person behind the key must still be in its workspace (`run/caller.ts`);
 * another workspace's id is not found, as over the API.
 *
 * The work is loaded on the first call: why, in `tool-support.ts`.
 */
import { z } from 'zod';
import { GET_REWRITE } from '@/lib/app/mcp/definitions';
import type { RewriteSummaryForAssistant } from '@/lib/app/mcp/rewrite-summary';
import { callerOf, idShape } from '@/lib/app/mcp/tool-support';
import { rewriteIdParamSchema } from '@/lib/app/rewrites/validations';
import {
  BaseCapability,
  type ProvenanceRedaction,
} from '@/lib/orchestration/capabilities/base-capability';
import type { CapabilityContext, CapabilityResult } from '@/lib/orchestration/capabilities/types';

export const getRewriteArgsSchema = z.strictObject({
  rewriteId: rewriteIdParamSchema.shape.id,
});

type Args = z.infer<typeof getRewriteArgsSchema>;

export class GetRewriteCapability extends BaseCapability<Args, RewriteSummaryForAssistant> {
  readonly slug = GET_REWRITE.name;
  readonly functionDefinition = GET_REWRITE;
  /** The draft is the writer's words, with the facts they filled in. */
  readonly processesPii = true;
  protected readonly schema = getRewriteArgsSchema;

  async execute(
    args: Args,
    context: CapabilityContext
  ): Promise<CapabilityResult<RewriteSummaryForAssistant>> {
    const { getRewriteTool } = await import('@/lib/app/mcp/run/get-rewrite');
    const outcome = await getRewriteTool(args.rewriteId, callerOf(context));
    if ('refusal' in outcome) return this.error(outcome.refusal.message, outcome.refusal.code);
    return this.success(outcome.data);
  }

  redactProvenance(
    args: Args,
    result: CapabilityResult<RewriteSummaryForAssistant>
  ): ProvenanceRedaction {
    // Only the id, and only if it reads as one: a chat turn's trace passes the
    // arguments as sent, stray keys and all.
    const sent: unknown = args;
    const rewriteId: unknown =
      typeof sent === 'object' && sent !== null ? Reflect.get(sent, 'rewriteId') : undefined;
    return {
      args: { rewriteId: idShape(rewriteId) },
      resultPreview: result.success
        ? JSON.stringify({ id: result.data?.id, status: result.data?.status })
        : JSON.stringify(result.error),
    };
  }
}

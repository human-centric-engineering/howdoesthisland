/**
 * The work of `get_rewrite` (t-94), loaded on its first call: one of the
 * workspace's rewrites, summarised for an assistant.
 */
import { refusalOf } from '@/lib/app/mcp/run/refusal';
import { summariseRewrite, type RewriteSummaryForAssistant } from '@/lib/app/mcp/rewrite-summary';
import type { ToolOutcome } from '@/lib/app/mcp/tool-support';
import { getRewrite } from '@/lib/app/rewrites/service';

export async function getRewriteTool(
  rewriteId: string
): Promise<ToolOutcome<RewriteSummaryForAssistant>> {
  try {
    return { data: summariseRewrite(await getRewrite(rewriteId)) };
  } catch (err) {
    const refusal = refusalOf(err);
    if (!refusal) throw err;
    return { refusal };
  }
}

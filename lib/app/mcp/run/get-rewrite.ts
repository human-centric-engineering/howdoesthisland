/**
 * The work of `get_rewrite` (t-94), loaded on its first call: one of the
 * workspace's rewrites, summarised for an assistant.
 */
import { callerRefusal } from '@/lib/app/mcp/run/caller';
import { refusalOf } from '@/lib/app/mcp/run/refusal';
import { summariseRewrite, type RewriteSummaryForAssistant } from '@/lib/app/mcp/rewrite-summary';
import type { ToolCaller, ToolOutcome } from '@/lib/app/mcp/tool-support';
import { getRewrite } from '@/lib/app/rewrites/service';

export async function getRewriteTool(
  rewriteId: string,
  caller: ToolCaller
): Promise<ToolOutcome<RewriteSummaryForAssistant>> {
  const refused = await callerRefusal(caller);
  if (refused) return { refusal: refused };
  try {
    return { data: summariseRewrite(await getRewrite(rewriteId)) };
  } catch (err) {
    const refusal = refusalOf(err);
    if (!refusal) throw err;
    return { refusal };
  }
}

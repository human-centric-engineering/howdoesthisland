/**
 * The work of `get_comparison` (t-93), loaded on its first call: one of the
 * workspace's comparisons, summarised for an assistant.
 */
import { getComparison } from '@/lib/app/comparisons/service';
import {
  summariseComparison,
  type ComparisonSummaryForAssistant,
} from '@/lib/app/mcp/comparison-summary';
import { callerRefusal } from '@/lib/app/mcp/run/caller';
import { refusalOf } from '@/lib/app/mcp/run/refusal';
import type { ToolCaller, ToolOutcome } from '@/lib/app/mcp/tool-support';

export async function getComparisonTool(
  comparisonId: string,
  caller: ToolCaller
): Promise<ToolOutcome<ComparisonSummaryForAssistant>> {
  const refused = await callerRefusal(caller);
  if (refused) return { refusal: refused };
  try {
    return { data: summariseComparison(await getComparison(comparisonId)) };
  } catch (err) {
    const refusal = refusalOf(err);
    if (!refusal) throw err;
    return { refusal };
  }
}

/**
 * The work of `get_assessment` (t-92), loaded on its first call: one of the
 * workspace's reviews, summarised for an assistant.
 */
import {
  readAssessmentSummary,
  type AssessmentSummaryForAssistant,
} from '@/lib/app/mcp/assessment-summary';
import { callerRefusal } from '@/lib/app/mcp/run/caller';
import { refusalOf } from '@/lib/app/mcp/run/refusal';
import type { ToolCaller, ToolOutcome } from '@/lib/app/mcp/tool-support';

export async function getAssessmentTool(
  assessmentId: string,
  caller: ToolCaller
): Promise<ToolOutcome<AssessmentSummaryForAssistant>> {
  const refused = await callerRefusal(caller);
  if (refused) return { refusal: refused };
  try {
    return { data: await readAssessmentSummary(assessmentId) };
  } catch (err) {
    const refusal = refusalOf(err);
    if (!refusal) throw err;
    return { refusal };
  }
}

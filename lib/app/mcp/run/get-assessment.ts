/**
 * The work of `get_assessment` (t-92), loaded on its first call: one of the
 * workspace's reviews, summarised for an assistant.
 */
import {
  readAssessmentSummary,
  type AssessmentSummaryForAssistant,
} from '@/lib/app/mcp/assessment-summary';
import { refusalOf } from '@/lib/app/mcp/run/refusal';
import type { ToolOutcome } from '@/lib/app/mcp/tool-support';

export async function getAssessmentTool(
  assessmentId: string
): Promise<ToolOutcome<AssessmentSummaryForAssistant>> {
  try {
    return { data: await readAssessmentSummary(assessmentId) };
  } catch (err) {
    const refusal = refusalOf(err);
    if (!refusal) throw err;
    return { refusal };
  }
}

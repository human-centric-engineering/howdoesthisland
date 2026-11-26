/**
 * `assess_draft` (t-92): `POST /api/v1/assessments` as an MCP tool.
 *
 * The route's steps in the route's order (`run/assess-draft.ts`), so credits,
 * the review budget and the workspace's running limit hold exactly as they do
 * over the API. What differs:
 *
 * - **The person is the key's creator.** The cap and the row's
 *   `createdByUserId` need one, so a key whose creator has gone is refused
 *   before anything is loaded or charged.
 * - **Always stored, and waited for up to `MCP_WAIT_MS`.** A review not kept
 *   could not be read back, and a tool call cannot hold its request for
 *   minutes; past the bound this answers the id and status, the review runs on
 *   (`keepRunningAfterResponse`), and `get_assessment` reads it.
 * - **Recorded as `MCP`**, not `APP`.
 *
 * Text or a public URL; a file needs the API's multipart upload. The work is
 * loaded on the first call: why, in `tool-support.ts`.
 */
import { z } from 'zod';
import { contextField, textField } from '@/lib/app/assessments/api/validations';
import type { AssessmentRequest } from '@/lib/app/assessments/api/validations';
import { MAX_URL_CHARS } from '@/lib/app/assessments/limits';
import type { AssessmentSummaryForAssistant } from '@/lib/app/mcp/assessment-summary';
import { ASSESS_DRAFT } from '@/lib/app/mcp/definitions';
import { creatorOf, draftShape } from '@/lib/app/mcp/tool-support';
import {
  BaseCapability,
  type ProvenanceRedaction,
} from '@/lib/orchestration/capabilities/base-capability';
import type { CapabilityContext, CapabilityResult } from '@/lib/orchestration/capabilities/types';

export const assessDraftArgsSchema = z
  .strictObject({
    text: textField.optional(),
    url: z
      .url({ protocol: /^https?$/ })
      .max(MAX_URL_CHARS)
      .optional(),
    title: z.string().trim().min(1).max(200).optional(),
    projectId: z.string().min(1).max(64).optional(),
    context: contextField,
  })
  .refine((args) => (args.text === undefined) !== (args.url === undefined), {
    error: 'Give the draft as text or as a url, not both',
    path: ['text'],
  });

type Args = z.infer<typeof assessDraftArgsSchema>;

/** The tool's arguments as the API's request: stored, and waited for. */
export function assessmentRequestOf(args: Args): AssessmentRequest {
  return {
    source: args.text !== undefined ? { text: args.text } : { url: args.url ?? '' },
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
    ...(args.context !== undefined ? { context: args.context } : {}),
    wait: true,
  };
}

export class AssessDraftCapability extends BaseCapability<Args, AssessmentSummaryForAssistant> {
  readonly slug = ASSESS_DRAFT.name;
  readonly functionDefinition = ASSESS_DRAFT;
  /** A draft is the writer's own words, which may name people. */
  readonly processesPii = true;
  protected readonly schema = assessDraftArgsSchema;

  async execute(
    args: Args,
    context: CapabilityContext
  ): Promise<CapabilityResult<AssessmentSummaryForAssistant>> {
    const userId = creatorOf(context);
    if (typeof userId !== 'string') return this.error(userId.message, userId.code);
    const { assessDraftTool } = await import('@/lib/app/mcp/run/assess-draft');
    const outcome = await assessDraftTool(assessmentRequestOf(args), userId);
    if ('refusal' in outcome) return this.error(outcome.refusal.message, outcome.refusal.code);
    return this.success(outcome.data);
  }

  redactProvenance(
    args: Args,
    result: CapabilityResult<AssessmentSummaryForAssistant>
  ): ProvenanceRedaction {
    return {
      args: {
        ...draftShape(args),
        ...(args.title !== undefined ? { title: '[title]' } : {}),
        projectId: args.projectId,
        context: args.context,
      },
      resultPreview: result.success
        ? JSON.stringify({ id: result.data?.id, status: result.data?.status })
        : JSON.stringify(result.error),
    };
  }
}

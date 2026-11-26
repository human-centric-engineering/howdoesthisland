/**
 * `rewrite_draft` (t-94): `POST /api/v1/rewrites` as an MCP tool.
 *
 * The route's steps in the route's order (`run/rewrite-draft.ts`): the
 * per-person cap (`rewriteLimiter`, keyed `user:<id>` as the route keys it),
 * then `startRewrite`, so the budget hold and the charge are the API's. What
 * differs:
 *
 * - **The person is the key's creator**, as for `assess_draft`: a key whose
 *   creator has gone is refused before anything is loaded or charged.
 * - **Never streamed, and waited for up to `MCP_WAIT_MS`.** A rewrite can run
 *   for up to `REWRITE_CALL_MS`; past the bound this answers the id and
 *   status, the rewrite runs on (`startRewrite` hands it to
 *   `keepRunningAfterResponse`), and `get_rewrite` reads it.
 * - **Filling placeholders is a second call** with `fromRewriteId` and
 *   `answers`, as over the API.
 *
 * The work is loaded on the first call: why, in `tool-support.ts`.
 */
import { z } from 'zod';
import { REWRITE_DRAFT } from '@/lib/app/mcp/definitions';
import type { RewriteSummaryForAssistant } from '@/lib/app/mcp/rewrite-summary';
import { creatorOf, idShape } from '@/lib/app/mcp/tool-support';
import {
  answersSchema,
  createRewriteSchema,
  fillsTogether,
  FILLS_TOGETHER_ERROR,
  focusField,
} from '@/lib/app/rewrites/validations';
import {
  BaseCapability,
  type ProvenanceRedaction,
} from '@/lib/orchestration/capabilities/base-capability';
import type { CapabilityContext, CapabilityResult } from '@/lib/orchestration/capabilities/types';

export const rewriteDraftArgsSchema = z
  .strictObject({
    assessmentId: createRewriteSchema.shape.assessmentId,
    focus: focusField,
    fromRewriteId: createRewriteSchema.shape.fromRewriteId,
    answers: answersSchema.optional(),
  })
  .refine(fillsTogether, { error: FILLS_TOGETHER_ERROR, path: ['answers'] });

type Args = z.infer<typeof rewriteDraftArgsSchema>;

/** A placeholder id as `parsePlaceholders` numbers them: the only answer key the trail keeps. */
const PLACEHOLDER_ID = /^p\d{1,3}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class RewriteDraftCapability extends BaseCapability<Args, RewriteSummaryForAssistant> {
  readonly slug = REWRITE_DRAFT.name;
  readonly functionDefinition = REWRITE_DRAFT;
  /** The draft is the writer's words, and an answer is a fact about them. */
  readonly processesPii = true;
  protected readonly schema = rewriteDraftArgsSchema;

  async execute(
    args: Args,
    context: CapabilityContext
  ): Promise<CapabilityResult<RewriteSummaryForAssistant>> {
    const userId = creatorOf(context);
    if (typeof userId !== 'string') return this.error(userId.message, userId.code);
    const { rewriteDraftTool } = await import('@/lib/app/mcp/run/rewrite-draft');
    const outcome = await rewriteDraftTool({ ...args, stream: false }, userId);
    if ('refusal' in outcome) return this.error(outcome.refusal.message, outcome.refusal.code);
    return this.success(outcome.data);
  }

  redactProvenance(
    args: Args,
    result: CapabilityResult<RewriteSummaryForAssistant>
  ): ProvenanceRedaction {
    // Typed as validated, but a chat turn's trace passes them as sent (see
    // `compare-drafts.ts`), so each is read defensively.
    const sent: Record<string, unknown> = isRecord(args) ? args : {};
    return {
      args: {
        assessmentId: idShape(sent.assessmentId),
        focus: idShape(sent.focus),
        fromRewriteId: idShape(sent.fromRewriteId),
        // Which placeholders were answered, never the answers: they are the writer's
        // facts. A key that is not a placeholder id may be one too, sent as sent.
        answers: isRecord(sent.answers)
          ? Object.keys(sent.answers).map((key) => (PLACEHOLDER_ID.test(key) ? key : '[value]'))
          : undefined,
      },
      resultPreview: result.success
        ? JSON.stringify({ id: result.data?.id, status: result.data?.status })
        : JSON.stringify(result.error),
    };
  }
}

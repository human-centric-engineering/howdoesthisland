/**
 * What the `rewrites` routes accept (t-81).
 *
 * The route registry (`lib/app/api/registry.ts`) imports these, so the
 * contract is the schema the handler parses with. `focus` is checked against
 * the review's framework version once that is known (`rewriteFocuses()`).
 */
import { z } from 'zod';
import { holdsPlaceholder, MAX_PLACEHOLDERS } from '@/lib/app/frameworks/placeholders';

const id = z.string().min(1).max(64);

/** The longest one answer to a placeholder may be. */
export const MAX_ANSWER_CHARS = 500;

/**
 * The writer's answers to an earlier rewrite's placeholders (t-83), keyed by
 * placeholder id (`p1`, …). Each is checked against that rewrite's
 * placeholders once it is read. Exported for `rewrite_draft` (t-94).
 */
export const answersSchema = z
  .record(
    z.string().min(1).max(16),
    z
      .string()
      .trim()
      .min(1)
      .max(MAX_ANSWER_CHARS)
      .refine((answer) => !holdsPlaceholder(answer), 'An answer cannot be a placeholder itself.')
  )
  .refine((answers) => Object.keys(answers).length > 0, 'Answer at least one placeholder.')
  .refine(
    (answers) => Object.keys(answers).length <= MAX_PLACEHOLDERS,
    `At most ${MAX_PLACEHOLDERS} answers.`
  );

/** A rewrite's focus, checked against the review's framework once that is known. */
export const focusField = z.string().min(1).max(32).optional();

/** Both or neither: a fill names the rewrite its answers are for. */
export const fillsTogether = (body: { fromRewriteId?: string; answers?: unknown }): boolean =>
  (body.fromRewriteId === undefined) === (body.answers === undefined);
export const FILLS_TOGETHER_ERROR = 'Send fromRewriteId and answers together, or neither.';

/** POST /api/v1/rewrites. */
export const createRewriteSchema = z
  .strictObject({
    assessmentId: id,
    /**
     * `balanced` (the default), or an appeal the framework names. With
     * `fromRewriteId`, that rewrite's focus is the default.
     */
    focus: focusField,
    /** Stream the draft as server-sent events, rather than answer once it is done. */
    stream: z.boolean().default(false),
    /** A finished rewrite of the same review whose placeholders `answers` fills (t-83). */
    fromRewriteId: id.optional(),
    /** Answers to `fromRewriteId`'s placeholders, by id. Those left out stay in the draft. */
    answers: answersSchema.optional(),
  })
  .refine(fillsTogether, { message: FILLS_TOGETHER_ERROR, path: ['answers'] });
export type CreateRewriteRequest = z.infer<typeof createRewriteSchema>;

/** GET /api/v1/rewrites: one review's rewrites, newest first. */
export const listRewritesQuerySchema = z.object({ assessmentId: id });

/** GET /api/v1/rewrites/{id}. */
export const rewriteIdParamSchema = z.object({ id });

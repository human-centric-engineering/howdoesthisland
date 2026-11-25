/**
 * What the `rewrites` routes accept (t-81).
 *
 * The route registry (`lib/app/api/registry.ts`) imports these, so the
 * contract is the schema the handler parses with. `focus` is checked against
 * the review's framework version once that is known (`rewriteFocuses()`).
 */
import { z } from 'zod';
import { MAX_PLACEHOLDERS } from '@/lib/app/frameworks/placeholders';

const id = z.string().min(1).max(64);

/** The longest one answer to a placeholder may be. */
export const MAX_ANSWER_CHARS = 500;

/**
 * The writer's answers to an earlier rewrite's placeholders (t-83), keyed by
 * placeholder id (`p1`, …). Each is checked against that rewrite's
 * placeholders once it is read.
 */
const answersSchema = z
  .record(z.string().min(1).max(16), z.string().trim().min(1).max(MAX_ANSWER_CHARS))
  .refine((answers) => Object.keys(answers).length > 0, 'Answer at least one placeholder.')
  .refine(
    (answers) => Object.keys(answers).length <= MAX_PLACEHOLDERS,
    `At most ${MAX_PLACEHOLDERS} answers.`
  );

/** POST /api/v1/rewrites. */
export const createRewriteSchema = z
  .strictObject({
    assessmentId: id,
    /**
     * `balanced` (the default), or an appeal the framework names. With
     * `fromRewriteId`, that rewrite's focus is the default.
     */
    focus: z.string().min(1).max(32).optional(),
    /** Stream the draft as server-sent events, rather than answer once it is done. */
    stream: z.boolean().default(false),
    /** A finished rewrite of the same review whose placeholders `answers` fills (t-83). */
    fromRewriteId: id.optional(),
    /** Answers to `fromRewriteId`'s placeholders, by id. Those left out stay in the draft. */
    answers: answersSchema.optional(),
  })
  .refine((body) => (body.fromRewriteId === undefined) === (body.answers === undefined), {
    message: 'Send fromRewriteId and answers together, or neither.',
    path: ['answers'],
  });
export type CreateRewriteRequest = z.infer<typeof createRewriteSchema>;

/** GET /api/v1/rewrites: one review's rewrites, newest first. */
export const listRewritesQuerySchema = z.object({ assessmentId: id });

/** GET /api/v1/rewrites/{id}. */
export const rewriteIdParamSchema = z.object({ id });

/**
 * What the `rewrites` routes accept (t-81).
 *
 * The route registry (`lib/app/api/registry.ts`) imports these, so the
 * contract is the schema the handler parses with. `focus` is checked against
 * the review's framework version once that is known (`rewriteFocuses()`).
 */
import { z } from 'zod';

const id = z.string().min(1).max(64);

/** POST /api/v1/rewrites. */
export const createRewriteSchema = z.strictObject({
  assessmentId: id,
  /** `balanced` (the default), or an appeal the framework names. */
  focus: z.string().min(1).max(32).optional(),
  /** Stream the draft as server-sent events, rather than answer once it is done. */
  stream: z.boolean().default(false),
});
export type CreateRewriteRequest = z.infer<typeof createRewriteSchema>;

/** GET /api/v1/rewrites: one review's rewrites, newest first. */
export const listRewritesQuerySchema = z.object({ assessmentId: id });

/** GET /api/v1/rewrites/{id}. */
export const rewriteIdParamSchema = z.object({ id });

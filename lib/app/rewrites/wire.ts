/**
 * A rewrite on the wire (t-81): the API's answer and its stream's events,
 * for the route registry and for a client to parse with.
 */
import { z } from 'zod';

const isoDateTime = z.iso.datetime();

/** `RewriteView` in `views.ts`. */
export const rewriteSchema = z.object({
  id: z.string(),
  assessmentId: z.string(),
  focus: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  draft: z.string(),
  /** The draft's gaps, `[ADD: …]`, each once: `Placeholder` in `placeholders.ts` (t-83). */
  placeholders: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      /** Each place it sits, as `[start, end)` offsets into `draft`. */
      at: z.array(z.object({ start: z.number().int(), end: z.number().int() })),
    })
  ),
  error: z.string().nullable(),
  errorCode: z.string().nullable(),
  model: z.string().nullable(),
  costUsd: z.number(),
  createdAt: isoDateTime,
  completedAt: isoDateTime.nullable(),
});

/** `RewriteEvent` in `service.ts`: the stream's events, in order. */
export const rewriteEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rewrite'), rewrite: rewriteSchema }),
  z.object({ type: z.literal('rewrite_text'), text: z.string() }),
  z.object({ type: z.literal('rewrite_done'), rewrite: rewriteSchema }),
]);

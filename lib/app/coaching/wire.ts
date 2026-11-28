/**
 * A review's gaps on the wire (t-108): `GET /api/v1/assessments/{id}/gaps`,
 * for the route registry and for a client to parse with.
 */
import { z } from 'zod';

/** `GapSource` in `gaps.ts`: where in the report a gap came from, by the report's own numbering. */
export const gapSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('placeholder'), placeholderId: z.string() }),
  z.object({ kind: z.literal('recommendation'), number: z.number().int() }),
  z.object({ kind: z.literal('note'), number: z.number().int() }),
  /** The appeal's id, as the report's "How it lands" lists it. */
  z.object({ kind: z.literal('appeal'), appeal: z.string() }),
  z.object({
    kind: z.literal('brief'),
    field: z.enum(['offer', 'audience', 'voice', 'markets', 'goals']),
  }),
]);

/** `Gap` in `gaps.ts`. */
export const gapSchema = z.object({
  id: z.string(),
  missing: z.string(),
  question: z.string(),
  why: z.string(),
  found: z.array(z.string()),
  sources: z.array(gapSourceSchema),
});

/** `GapsView` in `service.ts`. */
export const gapsSchema = z.object({
  assessmentId: z.string(),
  gaps: z.array(gapSchema),
});

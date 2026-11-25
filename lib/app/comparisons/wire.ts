/**
 * A comparison on the wire (t-87): the API's answer, for the route registry
 * and for a client to parse with. Held to `views.ts`'s types by the
 * registry's type test.
 */
import { z } from 'zod';
import { ASSESSMENT_STATES } from '@/lib/app/assessments/api/validations';

const isoDateTime = z.iso.datetime();

const frameworkRef = z.object({ slug: z.string(), version: z.string() });

/** `DraftSummary` in `views.ts`. */
const draftSummarySchema = z.object({
  position: z.number().int(),
  label: z.string().nullable(),
  assessmentId: z.string().nullable(),
  status: z.enum([...ASSESSMENT_STATES, 'purged']),
  overall: z.number().nullable(),
  band: z.string().nullable(),
});

const appealScoreSchema = z.object({ appeal: z.string(), score: z.number() });

/** `ComparisonSummary` in `views.ts`. */
export const comparisonSummarySchema = z.object({
  id: z.string(),
  kind: z.literal('comparison'),
  status: z.enum(['running', 'completed', 'partial', 'failed']),
  framework: frameworkRef,
  profile: z.string(),
  judges: z.array(z.string()),
  projectId: z.string().nullable(),
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  createdAt: isoDateTime,
  drafts: z.array(draftSummarySchema),
});

/** `ComparisonDetail` in `views.ts`. */
export const comparisonDetailSchema = comparisonSummarySchema.extend({
  context: z.unknown(),
  drafts: z.array(
    draftSummarySchema.extend({
      appeals: z
        .array(appealScoreSchema)
        .nullable()
        .meta({ description: 'Its score on each appeal once scored; `null` before.' }),
    })
  ),
  appeals: z
    .array(
      z.object({
        appeal: z.string(),
        leaders: z
          .array(z.number().int())
          .meta({
            description: 'The positions of the drafts with the best score; more than one on a tie.',
          }),
        drafts: z.array(
          z.object({
            position: z.number().int(),
            score: z.number().nullable(),
            delta: z
              .number()
              .nullable()
              .meta({
                description:
                  '`score` less the best score: `0` for a leader, negative for the rest; `null` when not scored.',
              }),
          })
        ),
      })
    )
    .meta({ description: 'Per appeal, once at least two drafts are scored; empty before.' }),
});

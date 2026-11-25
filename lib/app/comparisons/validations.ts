/**
 * What the `comparisons` routes accept (t-87).
 *
 * The route registry (`lib/app/api/registry.ts`) imports these, so the
 * contract is the schema the handler parses with. The review options are an
 * assessment's (`lib/app/assessments/api/validations.ts`), given once for
 * every draft; `context` is checked against the version once it is known.
 */
import { z } from 'zod';
import { contextField, textField, versionChoice } from '@/lib/app/assessments/api/validations';

/** The fewest drafts a comparison takes. */
export const MIN_DRAFTS = 2;
/** The most: each is a review, so a comparison costs up to this many. */
export const MAX_DRAFTS = 5;

/** What a writer calls a draft ("Subject line A"); shown beside its scores. */
export const DRAFT_LABEL_MAX = 80;

const draftSchema = z.strictObject({
  /** Pasted copy; checked against the length limit with its own message (`assessableText`). */
  text: textField,
  label: z.string().trim().min(1).max(DRAFT_LABEL_MAX).optional(),
});

/** POST /api/v1/comparisons. */
export const createComparisonSchema = z
  .strictObject({
    drafts: z
      .array(draftSchema)
      .min(MIN_DRAFTS, `Give at least ${MIN_DRAFTS} drafts to compare`)
      .max(MAX_DRAFTS, `Give at most ${MAX_DRAFTS} drafts to compare`),
    ...versionChoice,
    context: contextField,
    /** The workspace's project every draft is reviewed in; its defaults fill what is left out. */
    projectId: z.string().min(1).max(64).optional(),
    /** `quick`, `full` (the default) or one of the version's catalogue groups. */
    profile: z.string().trim().min(1).max(64).optional(),
    /** An explicit list of judge slots, in place of a profile. */
    judges: z.array(z.string().trim().min(1).max(64)).min(1).max(32).optional(),
  })
  .refine((body) => !(body.profile !== undefined && body.judges !== undefined), {
    error: 'Give a profile or a list of judges, not both',
    path: ['judges'],
  });

export type CreateComparisonBody = z.infer<typeof createComparisonSchema>;

/** GET /api/v1/comparisons. */
export const listComparisonsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Only the comparisons in this project. */
  projectId: z.string().min(1).max(64).optional(),
});

/** `{id}` in `/api/v1/comparisons/{id}`. */
export const comparisonIdParamSchema = z.object({ id: z.string().min(1).max(64) });

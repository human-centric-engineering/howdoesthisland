/**
 * What the `comparisons` routes accept (t-87).
 *
 * The route registry (`lib/app/api/registry.ts`) imports these, so the
 * contract is the schema the handler parses with. The review options are an
 * assessment's (`lib/app/assessments/api/validations.ts`), given once for
 * every draft; `context` is checked against the version once it is known.
 *
 * A draft is pasted text, or (t-84) a review the workspace already has,
 * named by `assessmentId`: it joins the set as it is, not reviewed again,
 * once the service has checked it was reviewed the way the set is. A set
 * needs at least one draft as text, and names a review at most once.
 */
import { z } from 'zod';
import { contextField, textField, versionChoice } from '@/lib/app/assessments/api/validations';

import { DRAFT_LABEL_MAX, MAX_DRAFTS, MIN_DRAFTS } from '@/lib/app/comparisons/limits';

export { DRAFT_LABEL_MAX, MAX_DRAFTS, MIN_DRAFTS };

const labelField = z.string().trim().min(1).max(DRAFT_LABEL_MAX).optional();

const textDraftSchema = z.strictObject({
  /** Pasted copy; checked against the length limit with its own message (`assessableText`). */
  text: textField,
  label: labelField,
});

const reviewedDraftSchema = z.strictObject({
  /** A review in the workspace, reviewed as the set is: joins it without running again (t-84). */
  assessmentId: z.string().min(1).max(64),
  label: labelField,
});

/** One draft: pasted text, or a review the workspace has. The MCP tool (t-93) takes it as is. */
export const comparisonDraftSchema = z.union([textDraftSchema, reviewedDraftSchema], {
  // A draft matching neither: most often one giving both, or neither, of the two.
  error: 'Give each draft as text or as an assessmentId, not both',
});

export type ComparisonDraftInput = z.infer<typeof comparisonDraftSchema>;

/** A draft given as text, reviewed with the set; otherwise an existing review. */
export const isTextDraft = (
  draft: ComparisonDraftInput
): draft is z.infer<typeof textDraftSchema> => 'text' in draft;

/** The drafts a set is made of: 2–5 of {@link comparisonDraftSchema}. */
export const comparisonDraftsField = z
  .array(comparisonDraftSchema)
  .min(MIN_DRAFTS, `Give at least ${MIN_DRAFTS} drafts to compare`)
  .max(MAX_DRAFTS, `Give at most ${MAX_DRAFTS} drafts to compare`);

/** At least one draft is text: a set of reviews alone would review nothing. */
export const hasTextDraft = (drafts: readonly ComparisonDraftInput[]): boolean =>
  drafts.some(isTextDraft);
export const HAS_TEXT_DRAFT_ERROR =
  'Give at least one draft as text: the others may be reviews you already have';

/** No review is named twice. */
export const namesEachReviewOnce = (drafts: readonly ComparisonDraftInput[]): boolean => {
  const named = drafts.flatMap((d) => (isTextDraft(d) ? [] : [d.assessmentId]));
  return new Set(named).size === named.length;
};
export const NAMES_EACH_REVIEW_ONCE_ERROR = 'Name each review at most once';

/** POST /api/v1/comparisons. */
export const createComparisonSchema = z
  .strictObject({
    drafts: comparisonDraftsField,
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
  })
  .refine((body) => hasTextDraft(body.drafts), { error: HAS_TEXT_DRAFT_ERROR, path: ['drafts'] })
  .refine((body) => namesEachReviewOnce(body.drafts), {
    error: NAMES_EACH_REVIEW_ONCE_ERROR,
    path: ['drafts'],
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

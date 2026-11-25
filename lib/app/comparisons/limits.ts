/**
 * A comparison's limits (t-87), apart from its route schemas so the
 * workbench can import them without the server's validation modules.
 */

/** The fewest drafts a comparison takes. */
export const MIN_DRAFTS = 2;
/** The most: each is a review, so a comparison costs up to this many. */
export const MAX_DRAFTS = 5;

/** What a writer calls a draft ("Subject line A"); shown beside its scores. */
export const DRAFT_LABEL_MAX = 80;

/**
 * The names people see for things the code calls otherwise (app-plan §4
 * "The words we use", owner rulings 2026-11-15). Code, API paths and fields
 * keep `assessment`, `judge` and `contentType`; every visible label comes
 * from here, so renaming one is one change.
 */
export const WORDS = {
  /** An assessment. */
  review: 'review',
  Review: 'Review',
  /** The judges. */
  aiReviewers: 'AI reviewers',
  AiReviewers: 'AI reviewers',
  /** A content type. */
  typeOfCopy: 'type of copy',
  TypeOfCopy: 'Type of copy',
} as const;

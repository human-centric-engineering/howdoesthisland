/**
 * Why an assessment was refused before anything was stored (t-22).
 *
 * The API (t-24) maps each code to a 4xx; nothing here is a server fault.
 */
export type AssessmentInputErrorCode =
  /** The text is empty once trimmed. */
  | 'content_empty'
  /** The text is longer than `MAX_CONTENT_CHARS` (§8.2): refused, never truncated. */
  | 'content_too_long'
  /** No published framework version has that id. */
  | 'version_not_found'
  /** The profile, or a judge in an explicit list, is unknown or switched off. */
  | 'profile_unknown'
  /** The project it is in was archived after the request was checked (t-70). */
  | 'project_archived';

/**
 * How each refusal reaches a caller: the code and status the API answers
 * with, and the code a review whose own run met it is failed with (a page a
 * batch fetches, t-101, `run.ts`).
 */
export const INPUT_ERRORS: Record<AssessmentInputErrorCode, { code: string; status: number }> = {
  content_empty: { code: 'CONTENT_EMPTY', status: 400 },
  // The code intake uses for the same limit on an upload (`IntakeErrorCodes`).
  content_too_long: { code: 'TEXT_TOO_LONG', status: 422 },
  version_not_found: { code: 'FRAMEWORK_VERSION_NOT_FOUND', status: 404 },
  profile_unknown: { code: 'PROFILE_UNKNOWN', status: 400 },
  project_archived: { code: 'PROJECT_ARCHIVED', status: 409 },
};

export class AssessmentInputError extends Error {
  readonly code: AssessmentInputErrorCode;

  constructor(code: AssessmentInputErrorCode, message: string) {
    super(message);
    this.name = 'AssessmentInputError';
    this.code = code;
  }
}

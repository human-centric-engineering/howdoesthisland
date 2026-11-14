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
  | 'profile_unknown';

export class AssessmentInputError extends Error {
  readonly code: AssessmentInputErrorCode;

  constructor(code: AssessmentInputErrorCode, message: string) {
    super(message);
    this.name = 'AssessmentInputError';
    this.code = code;
  }
}

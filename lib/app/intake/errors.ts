/**
 * Why a file could not be turned into text (t-15).
 *
 * An `APIError`, so a route that lets one propagate answers with its status
 * and code through the guard, with no mapping of its own. The size and type
 * codes reuse the platform's upload codes so a client handles them the same
 * way it handles any other refused upload.
 */

import { APIError, ErrorCodes } from '@/lib/api/errors';
import { logger } from '@/lib/logging';

export const IntakeErrorCodes = {
  /** Not one of the formats intake reads. */
  UNSUPPORTED_TYPE: ErrorCodes.INVALID_FILE_TYPE,
  /** Over the byte cap, or (PPTX) its slides expand past the cap. */
  TOO_LARGE: ErrorCodes.FILE_TOO_LARGE,
  /** More pages (PDF) or slides (PPTX) than intake reads. */
  TOO_MANY_PAGES: 'TOO_MANY_PAGES',
  /** A PDF with no text layer: scanned, image-only, or blank. */
  PDF_HAS_NO_TEXT: 'PDF_HAS_NO_TEXT',
  /** Any other file that produced no text. */
  NO_TEXT: 'NO_TEXT',
  /** More text than an assessment takes (§8.2: refused, never truncated). */
  TEXT_TOO_LONG: 'TEXT_TOO_LONG',
  /** Named as a supported type but could not be read as one. */
  UNREADABLE: 'FILE_UNREADABLE',
} as const;

export type IntakeErrorCode = (typeof IntakeErrorCodes)[keyof typeof IntakeErrorCodes];

const STATUS: Record<IntakeErrorCode, number> = {
  [IntakeErrorCodes.UNSUPPORTED_TYPE]: 415,
  [IntakeErrorCodes.TOO_LARGE]: 413,
  [IntakeErrorCodes.TOO_MANY_PAGES]: 422,
  [IntakeErrorCodes.PDF_HAS_NO_TEXT]: 422,
  [IntakeErrorCodes.NO_TEXT]: 422,
  [IntakeErrorCodes.TEXT_TOO_LONG]: 422,
  [IntakeErrorCodes.UNREADABLE]: 422,
};

export class IntakeError extends APIError {
  constructor(
    readonly intakeCode: IntakeErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message, intakeCode, STATUS[intakeCode], details);
    this.name = 'IntakeError';
  }
}

/**
 * A file that could not be read as `kind` (`'a PowerPoint presentation'`,
 * `'PDF'`). The cause is logged, not returned: it names our parsers and their
 * internals.
 */
export function unreadableFile(kind: string, cause: unknown): IntakeError {
  logger.warn('Intake could not read the file', {
    kind,
    reason: cause instanceof Error ? cause.message : String(cause),
  });
  return new IntakeError(IntakeErrorCodes.UNREADABLE, `This file could not be read as ${kind}.`);
}

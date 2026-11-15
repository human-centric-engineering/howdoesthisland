/**
 * The text an assessment scores, as every way in checks it (t-22, t-24).
 *
 * One function, so the stored job, the run that keeps nothing and the free
 * quick scan refuse the same texts with the same codes.
 */
import { AssessmentInputError } from '@/lib/app/assessments/errors';
import { MAX_CONTENT_CHARS } from '@/lib/app/assessments/limits';

/**
 * The text with NUL dropped, or an {@link AssessmentInputError}:
 * `content_empty` once trimmed, `content_too_long` past
 * {@link MAX_CONTENT_CHARS} (refused, never truncated).
 */
export function assessableText(raw: string): string {
  // NUL is never text (a PDF or DOCX extraction can leave one), and Postgres
  // refuses it in a text column, so it is dropped rather than failing the insert.
  const text = raw.replaceAll('\u0000', '');
  if (text.trim() === '') {
    throw new AssessmentInputError('content_empty', 'There is no text to assess.');
  }
  // Counted in code points, as an editor counts characters, not UTF-16 units.
  let chars = 0;
  for (const _char of text) chars += 1;
  if (chars > MAX_CONTENT_CHARS) {
    throw new AssessmentInputError(
      'content_too_long',
      `The text is ${chars.toLocaleString('en-GB')} characters long. The most an assessment takes is ${MAX_CONTENT_CHARS.toLocaleString('en-GB')}.`
    );
  }
  return text;
}

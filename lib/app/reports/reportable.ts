/**
 * Which assessments have a report: the one rule the PDF (t-31) and share
 * links (t-32) both gate on, so they cannot disagree.
 *
 * The two statuses that store a result (`drive` in
 * `lib/app/assessments/run.ts`) are the ones with a report, and a finished
 * run records when it finished. Checked by status, so the result need not be
 * loaded to decide.
 */
import type { AssessmentStatus } from '@prisma/client';

const REPORTABLE: ReadonlySet<AssessmentStatus> = new Set(['COMPLETED', 'PARTIAL']);

export function hasReport<T extends { status: AssessmentStatus; completedAt: Date | null }>(
  row: T
): row is T & { completedAt: Date } {
  return REPORTABLE.has(row.status) && row.completedAt !== null;
}

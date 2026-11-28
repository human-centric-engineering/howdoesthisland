/**
 * A finished review's gaps, read for the API (t-108, `.context/app/coaching.md`).
 *
 * Three reads: the report, as every report reads it (`loadReport`, through
 * the services the API answers from), which also scopes the review to the
 * workspace in context; the review's latest finished rewrite and its
 * project's brief as it is now, in one query; then {@link buildGaps}. No AI
 * call, and nothing is written.
 *
 * Errors:
 * - 404 `NOT_FOUND` — no such review in this workspace (another workspace's id too).
 * - 409 `ASSESSMENT_NOT_FINISHED` — still queued or running, or it ended
 *   with no result (failed or cancelled): there is nothing to find gaps in.
 * - 500 — the stored result or its model version could not be read.
 */
import { APIError, NotFoundError } from '@/lib/api/errors';
import { buildGaps, modelVocabulary, type Gap } from '@/lib/app/coaching/gaps';
import { briefSchema, type Brief } from '@/lib/app/projects/validations';
import { loadReport } from '@/lib/app/reports/load';
import { printReportSource } from '@/lib/app/reports/pdf/print-source';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { requireOrgId } from '@/lib/tenancy/context';

export interface GapsView {
  assessmentId: string;
  gaps: Gap[];
}

export async function getGaps(id: string): Promise<GapsView> {
  const report = await loadReport(id, printReportSource);
  if (report.kind === 'pending') {
    throw new APIError(
      'This review has not finished yet. Ask for its gaps once it has.',
      'ASSESSMENT_NOT_FINISHED',
      409
    );
  }
  if (report.kind === 'no_result') {
    throw new APIError(
      'This review ended without a result, so it has no gaps to ask about.',
      'ASSESSMENT_NOT_FINISHED',
      409
    );
  }
  if (report.kind === 'unreadable') throw new Error('The review could not be read for its gaps');

  const row = await prisma.assessment.findFirst({
    where: { id, orgId: requireOrgId() },
    select: {
      project: { select: { brief: true } },
      rewrites: {
        where: { status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { draft: true },
      },
    },
  });
  // Deleted between the two reads.
  if (!row) throw new NotFoundError('Assessment not found');

  let brief: Brief | null = null;
  if (row.project) {
    const parsed = briefSchema.safeParse(row.project.brief);
    if (parsed.success) brief = parsed.data;
    // Read as no project: nothing is dropped and no brief field is asked for,
    // rather than asking for fields the writer may have filled.
    else logger.warn('Project brief unreadable for a review’s gaps', { assessmentId: id });
  }

  return {
    assessmentId: id,
    gaps: buildGaps({
      view: report.view,
      rewriteDraft: row.rewrites[0]?.draft ?? null,
      known: { brief },
      vocabulary: modelVocabulary(report.model),
    }),
  };
}

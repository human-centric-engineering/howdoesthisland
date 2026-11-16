/**
 * A review's report as a PDF (t-31): from the cache when it has been made,
 * otherwise rendered, kept and returned.
 *
 * Runs in the caller's tenant context (the route's guard), so another
 * workspace's id is not found, as for every assessments route.
 *
 * Two requests for the same uncached PDF in one process share one render.
 * A render checks its assessment is still there after writing the file. If
 * not, it deletes the file and answers not found rather than serve the
 * deleted review. With the deleting side's sweep after the row
 * (`sweepReportPdfs`), a delete that races a render cannot leave a PDF behind.
 */
import { APIError, NotFoundError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import type { AssessmentStatus } from '@prisma/client';
import { logger } from '@/lib/logging';
import { requireOrgId } from '@/lib/tenancy/context';
import type { RateLimitResult } from '@/lib/security/rate-limit';
import {
  deleteReportPdfs,
  readCachedPdf,
  reportPdfKey,
  reportPdfStore,
  writeCachedPdf,
} from '@/lib/app/reports/pdf/cache';
import { PdfRenderError, renderReportPdf } from '@/lib/app/reports/pdf/render';
import { mintRenderToken } from '@/lib/app/reports/pdf/render-token';

export interface ReportPdf {
  pdf: Buffer;
  /** True when served from the cache. */
  cached: boolean;
  /** When the run finished, for the file name. */
  completedAt: Date;
}

export interface ReportPdfOptions {
  /**
   * Asked before a render, never before a cache hit: the route's rate limit
   * for the expensive path. A refusal comes back as `{ limited }`.
   */
  limit?: () => RateLimitResult;
}

/** A render the caller's rate limit refused. */
export interface ReportPdfLimited {
  limited: RateLimitResult;
}

const REPORTABLE: ReadonlySet<AssessmentStatus> = new Set(['COMPLETED', 'PARTIAL']);

/** Renders in flight in this process, by cache key. */
const inFlight = new Map<string, Promise<Buffer>>();

export async function getReportPdf(
  id: string,
  options: ReportPdfOptions = {}
): Promise<ReportPdf | ReportPdfLimited> {
  const orgId = requireOrgId();
  const row = await prisma.assessment.findUnique({
    where: { id, orgId },
    select: { status: true, completedAt: true },
  });
  if (!row) throw new NotFoundError('Assessment not found');
  // The two statuses that store a result (`drive` in `lib/app/assessments/run.ts`) are
  // the ones with a report. Checked by status so the result is not loaded.
  if (!REPORTABLE.has(row.status) || row.completedAt === null) {
    throw new APIError(
      'This review has no report yet: it is still running, or it failed or was cancelled.',
      'REPORT_NOT_READY',
      409,
      { status: row.status.toLowerCase() }
    );
  }
  const { completedAt } = row;

  const key = reportPdfKey(orgId, id, completedAt);
  const store = reportPdfStore(orgId);
  if (store) {
    const cached = await readCachedPdf(store, key);
    if (cached) return { pdf: cached, cached: true, completedAt };
  }

  const pending = inFlight.get(key);
  if (pending) return { pdf: await pending, cached: false, completedAt };

  const limit = options.limit?.();
  if (limit && !limit.success) return { limited: limit };
  const render = (async () => {
    let pdf: Buffer;
    try {
      pdf = await renderReportPdf(id, () => mintRenderToken(id, orgId));
    } catch (err) {
      // Deleted (or its workspace suspended) before the print page loaded: the
      // page was not found, which is the answer, not a failed render.
      if (err instanceof PdfRenderError && err.reason === 'not-rendered') {
        await refuseIfDeleted(orgId, id, false);
      }
      throw err;
    }
    const written = store ? await writeCachedPdf(store, key, pdf) : false;
    await refuseIfDeleted(orgId, id, written);
    return pdf;
  })();
  inFlight.set(key, render);
  try {
    return { pdf: await render, cached: false, completedAt };
  } finally {
    inFlight.delete(key);
  }
}

/**
 * A review deleted while it rendered has no report to serve: its PDF is not
 * returned, and the file just written for it goes too. Checked after the
 * write, so with the deleting side's sweep (`sweepReportPdfs`) no file
 * outlives the row.
 */
async function refuseIfDeleted(orgId: string, id: string, written: boolean): Promise<void> {
  const stillThere = await prisma.assessment.count({ where: { id, orgId } });
  if (stillThere > 0) return;
  if (written) {
    try {
      await deleteReportPdfs(orgId, id);
    } catch (err) {
      logger.error('Report PDF: a file for a deleted review could not be removed', err, {
        assessmentId: id,
      });
    }
  }
  throw new NotFoundError('Assessment not found');
}

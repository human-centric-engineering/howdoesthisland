/**
 * A review's report as a PDF (t-31).
 *
 * GET /api/v1/assessments/{id}/report.pdf — the report's print variant,
 * rendered by headless Chromium and kept in the workspace's private storage,
 * so later downloads of the same review are served from the file.
 *
 * Authentication: a browser session, or an API key with the `reports` scope.
 * The response is the PDF itself (`application/pdf`, as an attachment), not
 * the JSON envelope; errors are the standard envelope.
 *
 * Rate limit: on top of the section cap, `PDF_RENDERS_PER_MINUTE`
 * (`lib/app/reports/pdf/limiter.ts`) renders per caller per minute. A download served from the cache does not
 * count.
 *
 * Errors:
 * - 401 `UNAUTHORIZED` — no session or key.
 * - 403 `FORBIDDEN` — an API key without the `reports` scope.
 * - 404 `NOT_FOUND` — no such assessment in this workspace.
 * - 409 `REPORT_NOT_READY` — still queued or running, or it failed or was
 *   cancelled, so there is no report. `details.status` says which.
 * - 429 `RATE_LIMIT_EXCEEDED` — too many renders.
 * - 404 also when the review is deleted while its PDF renders.
 * - 422 `REPORT_UNREADABLE` — the stored result cannot be read (the web report
 *   shows "can't be shown"), so no PDF can be made of it.
 * - 500 `PDF_RENDER_FAILED` — the renderer failed or timed out.
 * - 503 `PDF_RENDER_BUSY` — every render slot and the queue are full.
 */
import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/guards';
import { errorResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { logger } from '@/lib/logging';
import { createRateLimitResponse } from '@/lib/security/rate-limit';
import { assessRoute, REPORTS_SCOPE } from '@/lib/app/assessments/api/route-auth';
import { assessmentIdParamSchema } from '@/lib/app/assessments/api/validations';
import { reportPdfLimiter } from '@/lib/app/reports/pdf/limiter';
import { PdfRenderError } from '@/lib/app/reports/pdf/render';
import { getReportPdf } from '@/lib/app/reports/pdf/service';

/** A render launches a browser; give it room beyond the default. */
export const maxDuration = 60;

export const GET = withAuth<{ id: string }>(async (_request: NextRequest, session, { params }) => {
  const { id } = validateQueryParams(new URLSearchParams(await params), assessmentIdParamSchema);

  let result;
  try {
    result = await getReportPdf(id, {
      limit: () => reportPdfLimiter.check(`user:${session.user.id}`),
    });
  } catch (err) {
    if (!(err instanceof PdfRenderError)) throw err;
    return renderFailure(err, id);
  }
  if ('limited' in result) return createRateLimitResponse(result.limited);

  const day = result.completedAt.toISOString().slice(0, 10);
  return new Response(new Uint8Array(result.pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(result.pdf.byteLength),
      'Content-Disposition': `attachment; filename="review-${day}-${id}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Report-Cache': result.cached ? 'hit' : 'miss',
    },
  });
}, assessRoute<{ id: string }>(REPORTS_SCOPE));

/** How each render failure reaches the caller. */
function renderFailure(err: PdfRenderError, assessmentId: string): Response {
  if (err.reason === 'unreadable') {
    // The same stored result the web report shows as "can't be shown":
    // rendering again will not change it.
    logger.warn('Report PDF: the review cannot be read', { assessmentId });
    return errorResponse("This review's report can't be shown, so there is no PDF of it.", {
      code: 'REPORT_UNREADABLE',
      status: 422,
    });
  }
  if (err.reason === 'busy') {
    return errorResponse('Too many PDFs are being made. Try again shortly.', {
      code: 'PDF_RENDER_BUSY',
      status: 503,
      headers: { 'Retry-After': '10' },
    });
  }
  logger.error('Report PDF could not be rendered', err, { assessmentId, reason: err.reason });
  return errorResponse('The PDF could not be made. Try again shortly.', {
    code: 'PDF_RENDER_FAILED',
    status: 500,
  });
}

/**
 * GET /api/v1/shared-reports/{token} — what a share link opens (t-32).
 *
 * Public: the token is the access. The answer is the assessment as a shared
 * report shows it (no id, cost, source, workspace or author) and the model
 * version it ran on, so a reader needs no second call. Each answer counts as
 * a view of the link.
 *
 * The token enters the link's workspace (`runAsShareOrg`,
 * `lib/app/reports/share/share-org.ts`). An unknown, malformed, revoked or
 * expired token, or one whose workspace is suspended, is a 404, all alike, so
 * a caller learns nothing about which.
 *
 * Rate limiting: `SHARED_REPORT_VIEWS_PER_MINUTE` per IP, by the
 * `shared-report` rule in `lib/app/rate-limit.ts`, whoever is calling.
 *
 * Errors:
 * - 404 `NOT_FOUND` — the link opens nothing.
 * - 422 `REPORT_UNREADABLE` — the model version the review ran on no longer
 *   resolves, so the report cannot be read.
 * - 429 `RATE_LIMIT_EXCEEDED` — over the per-IP cap.
 */
import type { NextRequest } from 'next/server';
import { handleAPIError, NotFoundError } from '@/lib/api/errors';
import { errorResponse, successResponse } from '@/lib/api/responses';
import { validateQueryParams } from '@/lib/api/validation';
import { readSharedReport } from '@/lib/app/reports/share/service';
import { shareTokenParamSchema } from '@/lib/app/reports/share/validations';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  try {
    const { token } = validateQueryParams(new URLSearchParams(await params), shareTokenParamSchema);
    const read = await readSharedReport(token);
    if (!read.ok) throw new NotFoundError('Shared report not found');
    const { model, ...rest } = read.report;
    if (model === null) {
      return errorResponse("This review's report can't be shown.", {
        code: 'REPORT_UNREADABLE',
        status: 422,
      });
    }
    // A link is a credential: nothing between here and the reader keeps a copy.
    return successResponse({ ...rest, model }, undefined, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return handleAPIError(error);
  }
}

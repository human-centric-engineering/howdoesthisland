/**
 * The print page's report source (t-31): the services the API routes answer
 * from, called directly.
 *
 * The print page is opened by the PDF route's own headless browser, which has
 * no session and no API key to call the API with. So it reads what
 * `GET /api/v1/assessments/{id}` and `GET /api/v1/frameworks/{slug}/versions/{version}`
 * would have sent, from the same functions, and round-trips each answer
 * through JSON so the parser sees the wire shape (a `Date` as an ISO string),
 * exactly as it does for the web page.
 *
 * Must run inside the assessment's org (`runAsReportOrg`), as the API would:
 * `getAssessment` reads the org in context.
 */
import { getAssessment } from '@/lib/app/assessments/api/service';
import {
  FrameworkApiError,
  resolveVersion,
  versionDocument,
} from '@/lib/app/frameworks/api/service';
import type { ReportSource } from '@/lib/app/reports/load';

/** A value as it would arrive in a JSON response body. */
function asOnTheWire(value: unknown): unknown {
  const wire: unknown = JSON.parse(JSON.stringify(value));
  return wire;
}

export const printReportSource: ReportSource = {
  // An id not found in the org throws `NotFoundError`, which the print page
  // answers with its not-found page.
  async assessment(id) {
    return asOnTheWire(await getAssessment(id));
  },
  async model(slug, version) {
    try {
      const { data } = await versionDocument(await resolveVersion(slug, version));
      return asOnTheWire(data);
    } catch (err) {
      if (err instanceof FrameworkApiError) return null;
      throw err;
    }
  },
};

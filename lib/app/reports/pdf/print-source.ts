/**
 * The print page's report source (t-31): the services the API routes answer
 * from, called directly.
 *
 * The print page is opened by the PDF route's own headless browser, which has
 * no session and no API key to call the API with. So it reads what
 * `GET /api/v1/assessments/{id}` would have sent, and the model version (which
 * every report reads in process, t-67), from the same functions, and
 * round-trips each answer
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
export function asOnTheWire(value: unknown): unknown {
  const wire: unknown = JSON.parse(JSON.stringify(value));
  return wire;
}

/**
 * The model document a framework version holds, or `null` when that version
 * no longer resolves. Shared with the web report's and the share link's reads
 * (`lib/app/reports/load.ts`, `lib/app/reports/share/service.ts`), so all three
 * resolve it alike.
 */
export async function loadModelDocument(
  slug: string,
  version: string
): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await versionDocument(await resolveVersion(slug, version));
    return data;
  } catch (err) {
    if (err instanceof FrameworkApiError) return null;
    throw err;
  }
}

export const printReportSource: ReportSource = {
  // An id not found in the org throws `NotFoundError`, which the print page
  // answers with its not-found page.
  async assessment(id) {
    return asOnTheWire(await getAssessment(id));
  },
  async model(slug, version) {
    const data = await loadModelDocument(slug, version);
    return data === null ? null : asOnTheWire(data);
  },
};

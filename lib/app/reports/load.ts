/**
 * Loading a report for a server component (t-29).
 *
 * Two reads: the assessment, through the API (`requireServerData`), and the
 * model version it ran on, which names everything the result holds by id,
 * read in process (t-67: the whole model is for platform admins only over
 * HTTP). That is one page's worth of data in two reads, never one per row. A 404 on
 * the assessment (another workspace's id included) renders the not-found
 * page. A 404 on the model version is an `unreadable` report, since retrying
 * cannot bring it back. Any other failure throws to the route's error boundary.
 *
 * Each answer is parsed with Zod. A result the schema rejects is an
 * `unreadable` report: logged, and shown as an error rather than a page with
 * gaps.
 *
 * **Where the answers come from is a {@link ReportSource}** (t-31). The web
 * page reads the assessment through the API ({@link apiReportSource}). The PDF's print page
 * has no session to call the API with, so it reads the same services the API
 * routes answer from (`lib/app/reports/pdf/print-source.ts`). Both go through
 * the parsing and building below, so the PDF cannot drift from the page.
 */
import { requireServerData } from '@/lib/api/server-load';
import { logger } from '@/lib/logging';
import {
  readableAssessment,
  reportAssessmentSchema,
  reportModelSchema,
  reportResultSchema,
  type ReportAssessment,
} from '@/lib/app/reports/input';
import { asOnTheWire, loadModelDocument } from '@/lib/app/reports/pdf/print-source';
import { buildReportView, type ReportView } from '@/lib/app/reports/view';

export type ReportLoad =
  /** Final, with a result: the report. */
  | {
      kind: 'ready';
      view: ReportView;
      /** Its project, or `null` for none (or a share link's, which does not say). */
      projectId: string | null;
    }
  /** Still queued or running. */
  | { kind: 'pending'; assessment: ReportAssessment }
  /** Final with no result: failed, or cancelled (a cancel never stores one). */
  | { kind: 'no_result'; assessment: ReportAssessment }
  /** The API answered, and the answer is not one the report can read. */
  | { kind: 'unreadable' };

export const assessmentPath = (id: string): string =>
  `/api/v1/assessments/${encodeURIComponent(id)}`;

/**
 * Where a report's two answers come from, each as the API would send it.
 *
 * - `assessment`: the `GET /api/v1/assessments/{id}` data. An id that is not
 *   found never returns: the API source renders the not-found page, and the
 *   print source throws `NotFoundError`, which the print page answers the
 *   same way.
 * - `model`: the model version's document, as
 *   `GET /api/v1/frameworks/{slug}/versions/{version}` would send it, or
 *   `null` when that version is not found. Any other failure throws.
 */
export interface ReportSource {
  assessment(id: string): Promise<unknown>;
  model(slug: string, version: string): Promise<unknown>;
}

/**
 * The web page's source: the assessment through the API, as the signed-in
 * caller (scoped to their workspace), and the model in process. The model is
 * shared config, the same for every caller, so it needs no caller scope; it
 * is read only for an assessment the caller could already read.
 */
export const apiReportSource: ReportSource = {
  async assessment(id) {
    const { data } = await requireServerData<unknown>(assessmentPath(id), { notFound: true });
    return data;
  },
  // In process, as the PDF and a share link read it (t-67): the whole model
  // is for platform admins only over HTTP, and the report parses only the
  // fields it shows, so the rest never reaches the browser.
  async model(slug, version) {
    const data = await loadModelDocument(slug, version);
    return data === null ? null : asOnTheWire(data);
  },
};

/**
 * `logAs` is what the diagnostics name the report by: the assessment's id,
 * unless the caller has a better handle (a shared report passes its share's
 * id, since the id it reads by is not an assessment's).
 */
export async function loadReport(
  id: string,
  source: ReportSource,
  logAs: Record<string, string> = { assessmentId: id }
): Promise<ReportLoad> {
  const assessment = reportAssessmentSchema.safeParse(await source.assessment(id));
  if (!assessment.success) {
    logger.error('Report: the assessment did not parse', undefined, {
      ...logAs,
      issues: assessment.error.issues.slice(0, 5),
    });
    return { kind: 'unreadable' };
  }
  const a = assessment.data;
  if (a.status === 'queued' || a.status === 'running') return { kind: 'pending', assessment: a };
  if (a.result === null) return { kind: 'no_result', assessment: a };
  // A result comes only with its text: a page a batch could not read has
  // neither (t-101). Read as unreadable rather than drawn without its copy.
  const readable = readableAssessment(a);
  if (!readable) {
    logger.error('Report: a result with no text', undefined, logAs);
    return { kind: 'unreadable' };
  }

  const result = reportResultSchema.safeParse(a.result);
  if (!result.success) {
    logger.error('Report: the result did not parse', undefined, {
      ...logAs,
      framework: a.framework,
      issues: result.error.issues.slice(0, 5),
    });
    return { kind: 'unreadable' };
  }

  // The version a stored result ran on no longer resolving is not something
  // "Try again" fixes, so a missing one is an unreadable report, not a throw.
  const modelData = await source.model(a.framework.slug, a.framework.version);
  if (modelData === null) {
    logger.error('Report: the model version it ran on was not found', undefined, {
      ...logAs,
      framework: a.framework,
    });
    return { kind: 'unreadable' };
  }
  const model = reportModelSchema.safeParse(modelData);
  if (!model.success) {
    logger.error('Report: the model did not parse', undefined, {
      ...logAs,
      framework: a.framework,
      issues: model.error.issues.slice(0, 5),
    });
    return { kind: 'unreadable' };
  }

  return {
    kind: 'ready',
    view: buildReportView({ assessment: readable, result: result.data, model: model.data }),
    projectId: a.projectId ?? null,
  };
}

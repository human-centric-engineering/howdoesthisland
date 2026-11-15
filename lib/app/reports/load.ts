/**
 * Loading a report for a server component (t-29).
 *
 * Two API reads, both through `requireServerData`: the assessment, and the
 * model version it ran on, which names everything the result holds by id.
 * That is one page's worth of data in two calls, never one per row. A 404 on
 * the assessment (another workspace's id included) renders the not-found
 * page. A 404 on the model version is an `unreadable` report, since retrying
 * cannot bring it back. Any other failure throws to the route's error boundary.
 *
 * Each answer is parsed with Zod. A result the schema rejects is an
 * `unreadable` report: logged, and shown as an error rather than a page with
 * gaps.
 */
import { loadServerData, requireServerData, ServerLoadError } from '@/lib/api/server-load';
import { logger } from '@/lib/logging';
import {
  reportAssessmentSchema,
  reportModelSchema,
  reportResultSchema,
  type ReportAssessment,
} from '@/lib/app/reports/input';
import { buildReportView, type ReportView } from '@/lib/app/reports/view';

export type ReportLoad =
  /** Final, with a result: the report. */
  | { kind: 'ready'; view: ReportView }
  /** Still queued or running. */
  | { kind: 'pending'; assessment: ReportAssessment }
  /** Final with no result: failed, or cancelled before any judge landed. */
  | { kind: 'no_result'; assessment: ReportAssessment }
  /** The API answered, and the answer is not one the report can read. */
  | { kind: 'unreadable' };

export const assessmentPath = (id: string): string =>
  `/api/v1/assessments/${encodeURIComponent(id)}`;

export const modelPath = (slug: string, version: string): string =>
  `/api/v1/frameworks/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`;

export async function loadReport(id: string): Promise<ReportLoad> {
  const { data } = await requireServerData<unknown>(assessmentPath(id), { notFound: true });
  const assessment = reportAssessmentSchema.safeParse(data);
  if (!assessment.success) {
    logger.error('Report: the assessment did not parse', undefined, {
      assessmentId: id,
      issues: assessment.error.issues.slice(0, 5),
    });
    return { kind: 'unreadable' };
  }
  const a = assessment.data;
  if (a.status === 'queued' || a.status === 'running') return { kind: 'pending', assessment: a };
  if (a.result === null) return { kind: 'no_result', assessment: a };

  const result = reportResultSchema.safeParse(a.result);
  if (!result.success) {
    logger.error('Report: the result did not parse', undefined, {
      assessmentId: id,
      framework: a.framework,
      issues: result.error.issues.slice(0, 5),
    });
    return { kind: 'unreadable' };
  }

  // The version a stored result ran on no longer resolving is not something
  // "Try again" fixes, so a 404 here is an unreadable report, not a throw.
  const path = modelPath(a.framework.slug, a.framework.version);
  const loaded = await loadServerData<unknown>(path);
  if (!loaded.ok) {
    if (loaded.failure.kind !== 'not_found') throw new ServerLoadError(path, loaded.failure);
    logger.error('Report: the model version it ran on was not found', undefined, {
      assessmentId: id,
      framework: a.framework,
    });
    return { kind: 'unreadable' };
  }
  const model = reportModelSchema.safeParse(loaded.data);
  if (!model.success) {
    logger.error('Report: the model did not parse', undefined, {
      assessmentId: id,
      framework: a.framework,
      issues: model.error.issues.slice(0, 5),
    });
    return { kind: 'unreadable' };
  }

  return {
    kind: 'ready',
    view: buildReportView({ assessment: a, result: result.data, model: model.data }),
  };
}

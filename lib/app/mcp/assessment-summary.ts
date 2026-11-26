/**
 * An assessment as an AI assistant reads it back (t-92): what the report
 * says, in the report's own words, without the parts only a page can use.
 *
 * Built from the report's view (`buildReportView` through `loadReport`), not
 * from the framework's raw `result`, so an assistant hears the same verdict,
 * changes and recommendations a person reads on the report, and a new
 * framework version that changes the result's shape changes this through the
 * one place that already reads it. Left out: character offsets, dimension
 * scores, lenses and duties, which an assistant cannot place and which would
 * crowd out what it needs. The report's URL is there for the rest.
 */
import { getAssessment } from '@/lib/app/assessments/api/service';
import { isFinal, type AssessmentDetail } from '@/lib/app/assessments/api/views';
import { loadReport, type ReportSource } from '@/lib/app/reports/load';
import { asOnTheWire, printReportSource } from '@/lib/app/reports/pdf/print-source';
import type { ReportView } from '@/lib/app/reports/view';
import { env } from '@/lib/env';

/** The most recommendations a summary carries; the report has the rest. */
export const SUMMARY_RECOMMENDATIONS = 10;

type Header = {
  id: string;
  status: AssessmentDetail['status'];
  title: string | null;
  /** The report, for a person in the workspace to open. */
  reportUrl: string;
};

export type AssessmentSummaryForAssistant =
  | (Header & {
      ready: false;
      /** What to do next, in a sentence an assistant can follow. */
      next: string;
      /** The quick scan's early read while the judges work, or `null`. */
      early: { overall: number | null; band: string | null } | null;
    })
  | (Header & {
      ready: false;
      /** Why there is no result: failed, cancelled, or refused for credits. */
      error: string | null;
      errorCode: string | null;
    })
  | (Header & {
      ready: true;
      overall: number;
      band: string;
      wordCount: number;
      /** The editor's one-paragraph verdict, or `null` for a quick-scan review. */
      verdict: string | null;
      changes: { change: string; why: string }[];
      works: string[];
      appeals: { name: string; score: number; question: string }[];
      recommendations: {
        appeal: string;
        dimension: string;
        issue: string;
        original: string;
        rewrite: string;
        impact: string;
        /**
         * `original` and `rewrite` are the model's illustration of the move,
         * not a line of this draft and its fix. The report marks them so; an
         * assistant that missed it would quote words the writer never wrote.
         */
        example: boolean;
      }[];
      /** Recommendations past {@link SUMMARY_RECOMMENDATIONS}, on the report only. */
      moreRecommendations: number;
      flags: { name: string; severity: string; quote: string; note: string | null }[];
    });

export function reportUrlOf(id: string): string {
  return new URL(`/assessments/${encodeURIComponent(id)}`, env.NEXT_PUBLIC_APP_URL).toString();
}

function header(detail: AssessmentDetail): Header {
  return {
    id: detail.id,
    status: detail.status,
    title: detail.title,
    reportUrl: reportUrlOf(detail.id),
  };
}

function fromView(detail: AssessmentDetail, view: ReportView): AssessmentSummaryForAssistant {
  const recommendations = view.recommendations.map((r) => ({
    appeal: r.appealName,
    dimension: r.dimensionName,
    issue: r.issue,
    original: r.original,
    rewrite: r.rewrite,
    impact: r.impact,
    example: r.example,
  }));
  return {
    ...header(detail),
    ready: true,
    overall: view.verdict.overall,
    band: view.verdict.band,
    wordCount: view.cover.wordCount,
    verdict: view.verdict.editor?.verdict ?? null,
    changes: (view.verdict.editor?.changes ?? []).map(({ change, why }) => ({ change, why })),
    works: view.verdict.editor?.works ?? [],
    appeals: view.lands.appeals.map(({ name, score, question }) => ({ name, score, question })),
    recommendations: recommendations.slice(0, SUMMARY_RECOMMENDATIONS),
    moreRecommendations: Math.max(0, recommendations.length - SUMMARY_RECOMMENDATIONS),
    flags: view.flags.map(({ name, severity, quote, note }) => ({ name, severity, quote, note })),
  };
}

/**
 * The summary of an assessment already read, in the caller's workspace.
 * A final one with a result the report cannot read answers as having none,
 * which the report's own logs explain.
 */
export async function summariseAssessment(
  detail: AssessmentDetail
): Promise<AssessmentSummaryForAssistant> {
  if (!isFinal(detail.status)) {
    return {
      ...header(detail),
      ready: false,
      next: 'The reviewers are still working. Call get_assessment again with this id in a minute.',
      early: detail.quickScan
        ? { overall: detail.quickScan.overall, band: detail.quickScan.band }
        : null,
    };
  }
  // The detail was just read: hand the report that copy rather than read it again.
  const source: ReportSource = {
    assessment: () => Promise.resolve(asOnTheWire(detail)),
    model: (slug, version) => printReportSource.model(slug, version),
  };
  const load = await loadReport(detail.id, source);
  if (load.kind === 'ready') return fromView(detail, load.view);
  return {
    ...header(detail),
    ready: false,
    error:
      load.kind === 'unreadable'
        ? 'This assessment finished, but its result could not be read. Open the report to see it.'
        : detail.error,
    errorCode: detail.errorCode,
  };
}

/**
 * A stored assessment whose summary could not be built: its id and status, so
 * an assistant reads it back with `get_assessment` rather than starting (and
 * paying for) another.
 */
export function storedButUnread(detail: AssessmentDetail): AssessmentSummaryForAssistant {
  return {
    ...header(detail),
    ready: false,
    next: 'The review was stored but could not be read back just now. Call get_assessment with this id; do not start another review.',
    early: null,
  };
}

/** One of the workspace's assessments, summarised; `NotFoundError` for any other id. */
export async function readAssessmentSummary(id: string): Promise<AssessmentSummaryForAssistant> {
  return summariseAssessment(await getAssessment(id));
}

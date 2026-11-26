/**
 * A comparison as an AI assistant reads it back (t-93): the comparison's own
 * view (`readComparison`, what `GET /api/v1/comparisons/{id}` answers),
 * trimmed to what an assistant can use.
 *
 * Left out: the context every draft was given (the caller sent it), the
 * judge slots, and the verdict's model, cost and timestamps. Each draft keeps
 * its review's `assessmentId`, which `get_assessment` reads for that draft's
 * recommendations; the comparison's page has the rest.
 *
 * **`ready`** is true once nothing about the comparison will change: every
 * draft's review has ended and so has the editor's verdict (completed,
 * failed or skipped). A verdict `waiting` to be asked again is not ready.
 */
import type { ComparisonDetail, ComparisonState, DraftState } from '@/lib/app/comparisons/views';
import { env } from '@/lib/env';

/** A verdict that will not change: written, given up on, or never to run. */
const VERDICT_ENDED: ReadonlySet<string> = new Set(['completed', 'failed', 'skipped']);

export type ComparisonSummaryForAssistant = {
  id: string;
  status: ComparisonState;
  /** See the file header. */
  ready: boolean;
  /** While not ready: what to do next, in a sentence an assistant can follow. */
  next: string | null;
  /** The comparison, for a person in the workspace to open. */
  compareUrl: string;
  drafts: {
    position: number;
    label: string | null;
    /** Its review, for `get_assessment`; `null` once purged. */
    assessmentId: string | null;
    status: DraftState;
    overall: number | null;
    band: string | null;
  }[];
  /** Per appeal, once two drafts are scored: the leaders, and each draft's score and gap to the best. */
  appeals: {
    appeal: string;
    leaders: number[];
    drafts: { position: number; score: number | null; delta: number | null }[];
  }[];
  verdict: {
    status: ComparisonDetail['verdict']['status'];
    /** The position of the draft that lands better, once completed. */
    draft: number | null;
    why: string | null;
    appeals: { appeal: string; why: string }[];
    /** Why there is none, when skipped or failed. */
    reason: string | null;
  };
};

export function compareUrlOf(id: string): string {
  return new URL(`/compare/${encodeURIComponent(id)}`, env.NEXT_PUBLIC_APP_URL).toString();
}

/** Whether `comparison` will change no further: see the file header. */
export function comparisonSettled(comparison: {
  status: ComparisonState;
  verdict: { status: string };
}): boolean {
  return comparison.status !== 'running' && VERDICT_ENDED.has(comparison.verdict.status);
}

export function summariseComparison(detail: ComparisonDetail): ComparisonSummaryForAssistant {
  const ready = comparisonSettled(detail);
  return {
    id: detail.id,
    status: detail.status,
    ready,
    next: ready
      ? null
      : 'Still running. Call get_comparison with this id in a minute or two; do not start another comparison.',
    compareUrl: compareUrlOf(detail.id),
    drafts: detail.drafts.map(({ position, label, assessmentId, status, overall, band }) => ({
      position,
      label,
      assessmentId,
      status,
      overall,
      band,
    })),
    appeals: detail.appeals.map(({ appeal, leaders, drafts }) => ({
      appeal,
      leaders: [...leaders],
      drafts: drafts.map(({ position, score, delta }) => ({ position, score, delta })),
    })),
    verdict: {
      status: detail.verdict.status,
      draft: detail.verdict.draft,
      why: detail.verdict.why,
      appeals: detail.verdict.appeals.map(({ appeal, why }) => ({ appeal, why })),
      reason: detail.verdict.reason,
    },
  };
}

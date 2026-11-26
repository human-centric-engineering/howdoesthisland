/**
 * A rewrite as an AI assistant reads it back (t-94): the rewrite's own view
 * (`toRewriteView`, what `GET /api/v1/rewrites/{id}` answers), trimmed to
 * what an assistant can use.
 *
 * **The draft is given only once the rewrite has completed.** While it runs,
 * the row holds what the editor has written so far, and a failed one keeps
 * what it wrote before it stopped; an assistant handed either could pass a
 * half-finished draft off as the rewrite. The review's page shows both.
 *
 * Left out: each placeholder's offsets (an assistant cannot place them), the
 * model and the cost.
 */
import type { RewriteState, RewriteView } from '@/lib/app/rewrites/views';
import { env } from '@/lib/env';

export type RewriteSummaryForAssistant = {
  id: string;
  /** The review it rewrites. */
  assessmentId: string;
  focus: string;
  status: RewriteState;
  /** True once it will change no further: completed or failed. */
  ready: boolean;
  /** What to do next, in a sentence an assistant can follow; `null` once there is nothing to do. */
  next: string | null;
  /** The review's page, where the rewrite sits, for a person in the workspace to open. */
  reviewUrl: string;
  /** The new draft, once completed; see the file header. */
  draft: string | null;
  /** Each gap the draft leaves for a fact only the writer knows, once completed. */
  placeholders: { id: string; label: string }[];
  /** Why it failed, and the editor's code for it (`timed_out`, `refused`, …). */
  error: string | null;
  errorCode: string | null;
};

const STILL_RUNNING =
  'Still running. Call get_rewrite with this id in a minute or two; do not start another rewrite.';

const TO_FILL =
  'The draft has placeholders for facts only the writer knows. Ask the writer for them, then call rewrite_draft with fromRewriteId set to this id and answers keyed by placeholder id. Never fill them in yourself.';

/** The review's page, as `reportUrlOf` builds it; not imported, since that module loads the assessment service. */
function reviewUrlOf(assessmentId: string): string {
  return new URL(
    `/assessments/${encodeURIComponent(assessmentId)}`,
    env.NEXT_PUBLIC_APP_URL
  ).toString();
}

export function summariseRewrite(view: RewriteView): RewriteSummaryForAssistant {
  const completed = view.status === 'completed';
  const placeholders = completed ? view.placeholders.map(({ id, label }) => ({ id, label })) : [];
  return {
    id: view.id,
    assessmentId: view.assessmentId,
    focus: view.focus,
    status: view.status,
    ready: view.status !== 'running',
    next: view.status === 'running' ? STILL_RUNNING : placeholders.length > 0 ? TO_FILL : null,
    reviewUrl: reviewUrlOf(view.assessmentId),
    draft: completed ? view.draft : null,
    placeholders,
    error: view.error,
    errorCode: view.errorCode,
  };
}

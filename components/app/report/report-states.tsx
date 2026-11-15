import type { ReportAssessment } from '@/lib/app/reports/input';
import { WORDS } from '@/lib/app/reports/words';

/**
 * What `/assessments/[id]` shows when there is no report to show yet, or
 * none at all. Live progress is the workbench's (f-workbench b1); until then
 * a run still going says so and asks for a reload.
 */
function Panel({
  slug,
  title,
  children,
}: {
  slug: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="report-state-heading"
      className="hd-sheet mx-auto max-w-3xl px-6 py-10 md:px-10"
    >
      <p className="hd-slug">{slug}</p>
      <h1 id="report-state-heading" className="mt-3 text-3xl font-bold">
        {title}
      </h1>
      <div className="mt-4 max-w-prose text-lg text-(--hd-muted)">{children}</div>
    </section>
  );
}

export function ReportPending({ assessment }: { assessment: ReportAssessment }) {
  return (
    <Panel slug={`${WORDS.Review} · ${assessment.status}`} title="Still reviewing">
      <p>
        The {WORDS.aiReviewers} are still reading this copy. Reload the page in a minute to see the
        report.
      </p>
    </Panel>
  );
}

export function ReportNoResult({ assessment }: { assessment: ReportAssessment }) {
  const cancelled = assessment.status === 'cancelled';
  return (
    <Panel
      slug={`${WORDS.Review} · ${assessment.status}`}
      title={cancelled ? 'This review was cancelled' : 'This review did not finish'}
    >
      <p>
        {cancelled
          ? 'It was cancelled before it finished, so there is no report.'
          : 'Something went wrong while scoring it, so there is no report. Run the review again.'}
      </p>
      {!cancelled && assessment.error ? (
        <p className="mt-3 font-mono text-sm">{assessment.error}</p>
      ) : null}
    </Panel>
  );
}

export function ReportUnreadable() {
  return (
    <Panel slug={WORDS.Review} title="This report can't be shown">
      <p>
        The review finished, but its result isn&rsquo;t in a shape this page can read. It has been
        logged for us to look at.
      </p>
    </Panel>
  );
}

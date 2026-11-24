import Link from 'next/link';
import type { ReportAssessment } from '@/lib/app/reports/input';
import { WORDS } from '@/lib/app/reports/words';
import { USAGE_PAGE } from '@/lib/app/usage/wire';
import { LiveReportPending } from '@/components/app/workbench/live-report-pending';

/**
 * What `/assessments/[id]` shows when there is no report to show yet, or
 * none at all. A run still going shows its live progress, the workbench's
 * (t-78), and the report replaces it once the run is final.
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

export interface ReportPendingProps {
  /** The review's id: the stream it follows. */
  assessmentId: string;
  assessment: ReportAssessment;
  /** Judge slot → the name its AI reviewer goes by. */
  reviewerNames: Record<string, string>;
  /** Appeal id → name, for the quick scan. */
  appealNames: Record<string, string>;
}

export function ReportPending({
  assessmentId,
  assessment,
  reviewerNames,
  appealNames,
}: ReportPendingProps) {
  return (
    <div className="hd-sheet mx-auto max-w-3xl px-6 py-10 md:px-10">
      <LiveReportPending
        assessmentId={assessmentId}
        reviewers={assessment.judges.map((slot) => ({
          slot,
          name: reviewerNames[slot] ?? slot,
        }))}
        appealNames={appealNames}
        headingLevel={1}
        initial={{
          status: assessment.status,
          // The stream sends the quick scan as it opens.
          quickScan: null,
          runs: assessment.judgeRuns.map((r) => ({
            judge: r.judge,
            status: r.status,
            errorCode: null,
          })),
        }}
      />
    </div>
  );
}

/** What a review refused as it was claimed was refused for, by its `errorCode` (t-53, t-58). */
const REFUSED_FOR: Record<string, string> = {
  INSUFFICIENT_CREDITS: 'the workspace’s CopyCredits',
  BUDGET_EXCEEDED: 'the workspace’s monthly AI budget',
};

export function ReportNoResult({ assessment }: { assessment: ReportAssessment }) {
  const cancelled = assessment.status === 'cancelled';
  const refusedFor = cancelled ? null : REFUSED_FOR[assessment.errorCode ?? ''];
  if (!cancelled && assessment.errorCode === 'PROJECT_CONTEXT_NOT_SET_UP') {
    return (
      <Panel slug={`${WORDS.Review} · ${assessment.status}`} title="This review was not started">
        <p>
          Its project&rsquo;s background documents could not be searched, so no AI reviewer was
          started for it. Running it again will fail the same way until an admin fixes the knowledge
          base&rsquo;s embedding setup.
        </p>
      </Panel>
    );
  }
  if (refusedFor) {
    return (
      <Panel slug={`${WORDS.Review} · ${assessment.status}`} title="This review was not started">
        <p>
          By the time its turn came, {refusedFor} no longer covered it, so no AI reviewer was
          started for it.
        </p>
        {assessment.error ? <p className="mt-3 text-base">{assessment.error}</p> : null}
        <p className="mt-3 text-base">
          <Link href={USAGE_PAGE} className="underline">
            See this month&rsquo;s usage
          </Link>
          .
        </p>
      </Panel>
    );
  }
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

'use client';

/**
 * A running review, live (t-78): its quick scan at once, then each AI
 * reviewer as it lands, from the review's event stream
 * (`useReviewEvents`). Shown on `/assess` after a review is started, and
 * on its report page while it runs (`ReportPending`), so a report opened
 * mid-run fills in by itself. `onDone` is called once the review is final:
 * the caller opens or refreshes the report.
 */
import { CheckCircle, CircleAlert, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QuickScanScores } from '@/components/app/quick-scan/quick-scan-scores';
import { QUICK_SCAN_CAVEAT, appealScoresOf } from '@/lib/app/quick-scan/summary';
import { WORDS } from '@/lib/app/reports/words';
import {
  useReviewEvents,
  type InitialProgress,
  type ReviewProgress as Progress,
} from '@/components/app/workbench/use-review-events';
import { reportPath, type ReviewState } from '@/components/app/workbench/schemas';

export interface ReviewProgressProps {
  assessmentId: string;
  /** The AI reviewers it runs, by slot and the name to show, in the version's order. */
  reviewers: Array<{ slot: string; name: string }>;
  /** Appeal id → name, for the quick scan's scores. */
  appealNames: Record<string, string>;
  initial: InitialProgress;
  onDone: (status: ReviewState) => void;
  /** 1 where it is the page's own heading (a report still running); 2 under the page's. */
  headingLevel?: 1 | 2;
}

function ConnectionNote({ progress, reconnect }: { progress: Progress; reconnect: () => void }) {
  if (progress.ended === 'gone') {
    return (
      <p role="status" className="text-(--hd-muted)">
        This {WORDS.review} has been deleted, so there is nothing more to show.
      </p>
    );
  }
  if (progress.connection === 'reconnecting') {
    return (
      <p role="status" className="text-sm text-(--hd-muted)">
        Lost touch with the {WORDS.review} for a moment. Reconnecting…
      </p>
    );
  }
  if (progress.connection === 'lost') {
    return (
      <div role="status" className="space-y-2">
        <p className="text-sm">
          This page has lost touch with the {WORDS.review}. It carries on without you: try again, or
          come back to this page later.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={reconnect}>
          Try again
        </Button>
      </div>
    );
  }
  return null;
}

export function ReviewProgress({
  assessmentId,
  reviewers,
  appealNames,
  initial,
  onDone,
  headingLevel = 2,
}: ReviewProgressProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const { progress, reconnect } = useReviewEvents(assessmentId, initial, onDone);
  const landed = reviewers.filter((r) => progress.runs[r.slot]).length;
  const finished = progress.ended === 'done';
  const gone = progress.ended === 'gone';

  return (
    <section aria-labelledby="review-progress-heading" className="space-y-8">
      <div className="space-y-2">
        <p className="hd-slug">
          {WORDS.Review} · {progress.status}
        </p>
        <Heading id="review-progress-heading" className="text-3xl font-bold">
          {finished
            ? 'Opening the report…'
            : gone
              ? `This ${WORDS.review} was deleted`
              : 'Still reviewing'}
        </Heading>
        {finished ? (
          // A plain link, so it loads the page afresh: if opening the report
          // by itself failed (a refresh lost to the network), this still works.
          <p className="text-(--hd-muted)">
            If it does not open,{' '}
            <a href={reportPath(assessmentId)} className="underline">
              open the report
            </a>
            .
          </p>
        ) : gone ? null : (
          <p className="text-(--hd-muted)">
            {landed} of {reviewers.length} {WORDS.aiReviewers} have finished. This page fills in as
            each one does, and opens the report when they all have.
          </p>
        )}
      </div>

      <ConnectionNote progress={progress} reconnect={reconnect} />

      <div aria-live="polite" className="space-y-8">
        {progress.quickScan ? (
          <div className="space-y-4" data-testid="review-quick-scan">
            <h3 className="text-xl font-semibold">The quick scan, while you wait</h3>
            <QuickScanScores
              overall={progress.quickScan.overall}
              band={progress.quickScan.band}
              appeals={appealScoresOf(progress.quickScan.result)}
              nameOf={(id) => appealNames[id] ?? id}
              caveat={QUICK_SCAN_CAVEAT}
            />
          </div>
        ) : null}

        <div className="space-y-3">
          <h3 className="text-xl font-semibold">The {WORDS.aiReviewers}</h3>
          <ol className="grid gap-2" data-testid="review-reviewers">
            {reviewers.map((r) => {
              const run = progress.runs[r.slot];
              return (
                <li
                  key={r.slot}
                  className="flex items-center gap-3 border-b border-(--hd-rule) pb-2"
                  data-state={run ? run.status : 'waiting'}
                >
                  {!run && gone ? (
                    <CircleAlert className="h-4 w-4 text-(--hd-muted)" aria-hidden />
                  ) : !run ? (
                    <Loader2 className="h-4 w-4 animate-spin text-(--hd-muted)" aria-hidden />
                  ) : run.status === 'succeeded' ? (
                    <CheckCircle
                      className="h-4 w-4 text-green-700 dark:text-green-400"
                      aria-hidden
                    />
                  ) : (
                    <CircleAlert className="h-4 w-4 text-(--hd-red)" aria-hidden />
                  )}
                  <span className="font-semibold">{r.name}</span>
                  <span className="ml-auto text-sm text-(--hd-muted)">
                    {!run && gone
                      ? 'Stopped'
                      : !run
                        ? 'Reading…'
                        : run.status === 'succeeded'
                          ? 'Done'
                          : 'Could not finish: its scores come from the quick scan'}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}

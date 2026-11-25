'use client';

/**
 * `/compare/[id]`'s comparison (t-89): the drafts side by side with their
 * scores, the best on each appeal, and the editor's verdict on which lands
 * better.
 *
 * One table, a column per draft: its overall score, then each appeal. The
 * draft that leads an appeal is marked "Best" (more than one on a tie); each
 * other one shows how far behind it is. A draft that failed, was cancelled,
 * or whose review was deleted keeps its column and says so, so the places
 * still line up with what was sent. While drafts run, or the verdict is still
 * to come, it is read again (`useComparison`).
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { WORDS } from '@/lib/app/reports/words';
import { reportPath } from '@/components/app/workbench/schemas';
import { useComparison } from '@/components/app/compare/use-comparison';
import {
  draftName,
  isMoving,
  type Comparison,
  type ComparisonDraft,
  type DraftState,
} from '@/components/app/compare/schemas';
import { percentOf, trackOf } from '@/components/app/report/charts/marks';
import { Track } from '@/components/app/report/charts/chart-figure';

export interface ComparisonViewProps {
  comparison: Comparison;
  /** Appeal id → name, in the framework's order. An appeal not named shows its id. */
  appealNames: Record<string, string>;
}

const DRAFT_STATUS: Record<DraftState, string> = {
  queued: 'Waiting to start',
  running: 'Being reviewed',
  completed: 'Reviewed',
  partial: 'Partly reviewed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  purged: 'Deleted',
};

/** The line under a draft's status, when its state needs one. */
const DRAFT_NOTE: Partial<Record<DraftState, string>> = {
  partial: 'Not every AI reviewer answered, so the editor leaves it out of the verdict.',
  failed: `Its ${WORDS.review} failed, so it has no scores.`,
  cancelled: `Its ${WORDS.review} was cancelled, so it has no scores.`,
  purged: `Its ${WORDS.review} was deleted, so its scores are gone.`,
};

const SCORED: ReadonlySet<DraftState> = new Set(['completed', 'partial']);

/** The appeals' colours, as the report draws them. */
const appealColour = (id: string): string =>
  ['ethos', 'pathos', 'logos', 'kairos'].includes(id) ? `var(--hd-${id})` : 'var(--hd-ink)';

const SKIPPED_FOR: Record<string, string> = {
  too_few_completed: `Fewer than two drafts were read by every one of their ${WORDS.aiReviewers}, so there is nothing for the editor to weigh. The scores below are all there is.`,
  too_few_judges: `These drafts were read by fewer than two ${WORDS.aiReviewers}, so the editor gives no verdict on them. Compare their scores below.`,
  predates_verdicts:
    'This comparison was made before the editor gave verdicts. Compare the scores below.',
};

/** Passing failures the verdict is asked again after. */
const RETRYING = new Set(['rate_limited', 'provider_error']);

function Verdict({
  comparison,
  appealNames,
}: {
  comparison: Comparison;
  appealNames: Record<string, string>;
}) {
  const { verdict, drafts } = comparison;
  const draftsRunning = drafts.some((d) => d.status === 'queued' || d.status === 'running');
  const winner =
    verdict.status === 'completed' ? drafts.find((d) => d.position === verdict.draft) : undefined;

  let body: ReactNode;
  if (verdict.status === 'completed' && winner) {
    body = (
      <>
        <p className="text-2xl font-bold">{draftName(winner)} lands better with this reader.</p>
        {verdict.why ? <p className="mt-3 max-w-prose text-lg">{verdict.why}</p> : null}
        {verdict.appeals.length > 0 ? (
          <dl className="mt-5 grid gap-3">
            {verdict.appeals.map((a) => (
              <div
                key={a.appeal}
                className="border-l-4 pl-3"
                style={{ borderColor: appealColour(a.appeal) }}
              >
                <dt className="font-semibold">{appealNames[a.appeal] ?? a.appeal}</dt>
                <dd className="max-w-prose text-(--hd-muted)">{a.why}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </>
    );
  } else if (verdict.status === 'running' || (verdict.status === 'waiting' && !draftsRunning)) {
    body = (
      <p className="flex items-center gap-2 text-lg">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {verdict.status === 'waiting' && verdict.reason && RETRYING.has(verdict.reason)
          ? 'The editor could not be reached just now. It will be asked again in a few minutes.'
          : 'The editor is reading the drafts.'}
      </p>
    );
  } else if (verdict.status === 'waiting') {
    body = (
      <p className="text-lg text-(--hd-muted)">
        The editor says which draft lands better once every draft has been reviewed.
      </p>
    );
  } else if (verdict.status === 'skipped') {
    body = (
      <p className="max-w-prose text-lg text-(--hd-muted)">
        {SKIPPED_FOR[verdict.reason ?? ''] ?? 'The editor gives no verdict on this comparison.'}
      </p>
    );
  } else {
    // `failed`, or `completed` naming a draft this read does not hold.
    body = (
      <p className="max-w-prose text-lg text-(--hd-muted)">
        The editor could not give a verdict on these drafts. The scores below still compare them.
      </p>
    );
  }

  return (
    <section aria-labelledby="verdict-heading" className="hd-sheet px-6 py-8 md:px-10">
      <h2 id="verdict-heading" className="hd-slug">
        The editor&rsquo;s verdict
      </h2>
      <div className="mt-3" aria-live="polite">
        {body}
      </div>
    </section>
  );
}

/** One score in a draft's column: the figure, a bar, and where it stands. */
function ScoreCell({
  score,
  colour,
  leads,
  delta,
}: {
  score: number | null;
  colour: string;
  leads: boolean;
  delta: number | null;
}) {
  if (score === null) return <span className="text-sm text-(--hd-muted)">Not scored</span>;
  return (
    <div className="min-w-[7rem] space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-lg font-semibold tabular-nums">{Math.round(score)}</span>
        {leads ? (
          <Badge variant="secondary">Best</Badge>
        ) : delta !== null ? (
          <span className="font-mono text-sm text-(--hd-muted) tabular-nums">
            {Math.round(Math.abs(delta)) === 0 ? '<1' : Math.round(Math.abs(delta))} behind
          </span>
        ) : null}
      </div>
      <Track height={8}>
        <rect x="0" y="0" width="100%" height="8" fill={trackOf(colour)} />
        <rect x="0" y="0" width={`${percentOf(score, 100)}%`} height="8" fill={colour} />
      </Track>
    </div>
  );
}

function DraftHeader({ draft, winner }: { draft: ComparisonDraft; winner: boolean }) {
  const note = DRAFT_NOTE[draft.status];
  const working = draft.status === 'queued' || draft.status === 'running';
  return (
    <th scope="col" className="min-w-[10rem] px-3 py-3 text-left align-top font-normal">
      <span className="block text-base font-bold">{draftName(draft)}</span>
      <span className="mt-1 flex items-center gap-1 text-sm text-(--hd-muted)">
        {working ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
        {DRAFT_STATUS[draft.status]}
      </span>
      {winner ? <Badge className="mt-2">Lands better</Badge> : null}
      {note ? <span className="mt-1 block text-xs text-(--hd-muted)">{note}</span> : null}
      {draft.assessmentId && draft.status !== 'purged' ? (
        <Link href={reportPath(draft.assessmentId)} className="mt-2 block text-sm underline">
          {working ? 'Watch its review' : 'Open its report'}
        </Link>
      ) : null}
    </th>
  );
}

export function ComparisonView({ comparison: initial, appealNames }: ComparisonViewProps) {
  const { comparison, stale, ended } = useComparison(initial);
  const { drafts, appeals, verdict } = comparison;
  const winnerAt = verdict.status === 'completed' ? verdict.draft : null;

  // The appeals in the framework's order: the compare's once it has one, else
  // the version's names, else whatever a scored draft carries.
  const appealIds =
    appeals.length > 0
      ? appeals.map((a) => a.appeal)
      : Object.keys(appealNames).length > 0
        ? Object.keys(appealNames)
        : (drafts.find((d) => d.appeals)?.appeals?.map((a) => a.appeal) ?? []);
  const compareOf = new Map(appeals.map((a) => [a.appeal, a]));

  // The best overall, among the drafts scored, when two are.
  const overalls = drafts
    .filter((d) => SCORED.has(d.status) && d.overall !== null)
    .map((d) => d.overall ?? 0);
  const bestOverall = overalls.length >= 2 ? Math.max(...overalls) : null;

  const scoredCount = drafts.filter((d) => SCORED.has(d.status)).length;
  const done = drafts.filter((d) => d.status !== 'queued' && d.status !== 'running').length;

  return (
    <div className="space-y-6">
      <header className="hd-sheet px-6 py-8 md:px-10">
        <p className="hd-slug">Comparison</p>
        <h1 className="mt-3 text-3xl font-bold">Which draft lands better</h1>
        <p className="mt-2 text-(--hd-muted)">
          {drafts.length} drafts, each reviewed the same way
          {comparison.project ? (
            <>
              {' '}
              in{' '}
              <Link
                href={`/projects/${encodeURIComponent(comparison.project.id)}`}
                className="underline"
              >
                {comparison.project.name}
              </Link>
            </>
          ) : null}
          .
        </p>
        {isMoving(comparison) && ended === null && done < drafts.length ? (
          <p className="mt-3 flex items-center gap-2" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {done} of {drafts.length} drafts reviewed
          </p>
        ) : null}
        {stale ? (
          <p role="status" className="mt-3 text-sm">
            This page could not check for progress just now, so it may be behind. It keeps trying;
            reload the page to check yourself.
          </p>
        ) : null}
        {ended ? (
          <p role="status" className="mt-3 text-sm">
            {ended === 'gone'
              ? 'This comparison has been deleted, so this page has stopped checking for progress.'
              : 'You are no longer signed in, so this page has stopped checking for progress. Sign in again to see it.'}
          </p>
        ) : null}
      </header>

      <Verdict comparison={comparison} appealNames={appealNames} />

      <section aria-labelledby="scores-heading" className="hd-sheet px-6 py-8 md:px-10">
        <h2 id="scores-heading" className="hd-slug">
          Side by side
        </h2>
        {scoredCount < 2 && !isMoving(comparison) ? (
          <p className="mt-3 text-(--hd-muted)">
            Fewer than two drafts were scored, so there is nothing to set side by side.
          </p>
        ) : null}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse">
            <caption className="sr-only">
              Each draft&rsquo;s overall score and its score on each appeal, out of 100. The best
              draft on each appeal is marked Best; the others show how far behind it they are.
            </caption>
            <thead>
              <tr className="border-b border-(--hd-rule)">
                <td className="sticky left-0 z-10 w-24 bg-(--hd-paper) md:w-40" />
                {drafts.map((d) => (
                  <DraftHeader key={d.position} draft={d} winner={d.position === winnerAt} />
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-(--hd-rule)">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-(--hd-paper) px-3 py-3 text-left align-top"
                >
                  Overall
                </th>
                {drafts.map((d) => {
                  const score = SCORED.has(d.status) ? d.overall : null;
                  return (
                    <td key={d.position} className="px-3 py-3 align-top">
                      <ScoreCell
                        score={score}
                        colour="var(--hd-ink)"
                        leads={score !== null && bestOverall !== null && score === bestOverall}
                        delta={score !== null && bestOverall !== null ? score - bestOverall : null}
                      />
                      {score !== null && d.band ? (
                        <span className="mt-1 block text-xs text-(--hd-muted)">{d.band}</span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
              {appealIds.map((appeal) => {
                const compare = compareOf.get(appeal);
                return (
                  <tr key={appeal} className="border-b border-(--hd-rule) last:border-0">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-(--hd-paper) px-3 py-3 text-left align-top"
                    >
                      {appealNames[appeal] ?? appeal}
                    </th>
                    {drafts.map((d) => {
                      const own = d.appeals?.find((a) => a.appeal === appeal)?.score ?? null;
                      const row = compare?.drafts.find((x) => x.position === d.position);
                      return (
                        <td key={d.position} className="px-3 py-3 align-top">
                          <ScoreCell
                            score={row ? row.score : own}
                            colour={appealColour(appeal)}
                            leads={compare?.leaders.includes(d.position) ?? false}
                            delta={row?.delta ?? null}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

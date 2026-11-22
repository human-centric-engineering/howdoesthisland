import { ScoreBars } from '@/components/app/report/charts/score-bars';
import { HOME_APPEALS } from '@/components/app/marketing/home-copy';
import type { SelfScore, SelfScoreAppeal } from '@/lib/app/quick-scan/self-score';

const NAME = Object.fromEntries(HOME_APPEALS.map((a) => [a.id, a.name])) as Record<
  SelfScoreAppeal,
  string
>;

/**
 * "We ran this page through HowDoesThisLand" (t-62): the landing page's own
 * copy, scored by the quick scan (once per framework version). Shown only when
 * `selfScore()` answered, which it does only with the quick-scan switch on.
 */
export function SelfScorePanel({ score }: { score: SelfScore }) {
  const weakest = NAME[score.weakest];
  return (
    <section
      aria-labelledby="self-score-heading"
      data-testid="self-score"
      className="border border-(--hd-rule) bg-(--hd-paper) p-6 sm:p-7"
    >
      <p className="hd-slug">Quick scan · {score.scoredWith}</p>
      <h2 id="self-score-heading" className="mt-2 text-2xl leading-tight font-bold">
        We ran this page through HowDoesThisLand
      </h2>
      <p className="mt-1 text-sm text-(--hd-muted)">
        Scored by the quick scan alone, no AI reviewers, and again when a new framework version is
        published.
      </p>
      <p className="mt-5 flex items-baseline gap-3">
        <span className="font-serif text-6xl leading-none font-extrabold tabular-nums">
          {score.overall}
        </span>
        <span className="font-mono text-xs tracking-wider text-(--hd-muted) uppercase">
          {score.band} · out of 100
        </span>
      </p>
      <div className="mt-6">
        <ScoreBars
          title="Appeal scores"
          max={100}
          testId="self-score-appeals"
          rows={score.appeals.map((a) => ({
            id: a.id,
            label: NAME[a.id],
            score: a.score,
            colour: `var(--hd-${a.id})`,
          }))}
        />
      </div>
      <p className="mt-5 border-t border-dashed border-(--hd-rule) pt-4 text-sm">
        <b>{score.band}.</b> Weakest appeal: {weakest.toLowerCase()}. We’re new, so there are no
        customer quotes here yet, and we won’t invent them.
      </p>
    </section>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Button } from '@/components/ui/button';
import { MarkedUpCopy } from '@/components/app/report/marked-up-copy';
import { HowItLands, Recommendations, Verdict } from '@/components/app/report/report';
import { ScoreBars } from '@/components/app/report/charts/score-bars';
import { BeforeAfter } from '@/components/app/example/before-after';
import { ReviewSteps } from '@/components/app/example/review-steps';
import { loadExampleViews } from '@/components/app/example/load';
import { isQuickScanEnabled } from '@/lib/app/quick-scan/switch';
import { REDEEM_PATH } from '@/lib/app/credits/codes/wire';
import { BRAND } from '@/lib/brand';
import type { ReportView } from '@/lib/app/reports/view';

/**
 * `/example-review`: one cold email taken through a review, step by step, as
 * the app shows it (t-69). The route in `app/(public)/example-review/` is one
 * line over this. Every score and note is the engine's, over the example in
 * `lib/app/example/`, laid out by the report's own components.
 */

const COPY = {
  slug: 'See a review',
  h1: 'One cold email, from first draft to one worth sending.',
  lead: 'Tom wants a meeting with Sarah, an operations director who has never heard of him. Here is his first draft, what HowDoesThisLand found, and what he sent instead.',
  steps: {
    draft: {
      label: 'The draft',
      title: 'Tom’s first draft',
      body: 'A cold email, to a reader who owes him nothing. It looks like hundreds of others. Let’s see how it lands.',
    },
    quick: {
      label: 'Quick scan',
      title: 'The quick scan: a first look, in a moment',
      body: 'No AI yet: a free surface check of word patterns. It catches the hype and the missing numbers, but it can’t tell how Sarah will actually read it.',
    },
    review: {
      label: 'AI review',
      title: 'The AI reviewers mark it up',
      body: 'Each reviewer reads the email as Sarah would, through one lens, and quotes the exact words behind every note. Red marks what would lose her; each comes with a rewrite.',
    },
    report: {
      label: 'The report',
      title: 'The verdict, and how it lands',
      body: 'The scores say how the email lands with this reader, appeal by appeal, against the mix a cold sales email needs.',
    },
    rewrite: {
      label: 'The rewrite',
      title: 'What Tom sent instead',
      body: 'Same sender, same offer. Tom made the edits in his own words, filling the gaps the reviewers left for facts only he had, and ran the review again.',
    },
  },
  meta: {
    title: 'See a review: one cold email, from first draft to one worth sending',
    description:
      'Watch HowDoesThisLand review a cold sales email step by step: the quick scan, the AI reviewers’ mark-up and rewrites, the scores, and the final draft.',
  },
  ctaH: 'Your turn.',
  cta: 'Have a free review code? Put the message that matters most this week through the same review.',
} as const;

export const metadata: Metadata = {
  title: { absolute: COPY.meta.title },
  description: COPY.meta.description,
  alternates: { canonical: '/example-review' },
  openGraph: { title: `${COPY.meta.title} - ${BRAND.name}`, description: COPY.meta.description },
  twitter: {
    card: 'summary_large_image',
    title: `${COPY.meta.title} - ${BRAND.name}`,
    description: COPY.meta.description,
  },
};

const APPEAL_COLOUR: Readonly<Record<string, string>> = {
  ethos: 'var(--hd-ethos)',
  pathos: 'var(--hd-pathos)',
  logos: 'var(--hd-logos)',
  kairos: 'var(--hd-kairos)',
};

/**
 * A view as one step shows it. The page shows a part of each report, so a
 * link in a note or the verdict to a recommendation or a dimension the step
 * does not show is taken out, rather than left pointing nowhere. With
 * `recommendations`, only those (the editor's choices, in its order) are kept
 * and linked to.
 */
function forStep(view: ReportView, recommendations: readonly number[] = []): ReportView {
  const shown = new Set(recommendations);
  return {
    ...view,
    recommendations: recommendations.flatMap((n) =>
      view.recommendations.filter((r) => r.number === n)
    ),
    copy: {
      ...view.copy,
      notes: view.copy.notes.map((n) => ({
        ...n,
        dimensionShown: false,
        recommendation:
          n.recommendation !== null && shown.has(n.recommendation) ? n.recommendation : null,
      })),
    },
    verdict: {
      ...view.verdict,
      editor: view.verdict.editor
        ? {
            ...view.verdict.editor,
            changes: view.verdict.editor.changes.map((c) => ({
              ...c,
              recommendation:
                c.recommendation !== null && shown.has(c.recommendation) ? c.recommendation : null,
            })),
          }
        : null,
    },
  };
}

/** The recommendations the editor chose, by number, in its order. */
function editorsPicks(view: ReportView): number[] {
  return (view.verdict.editor?.changes ?? [])
    .map((c) => c.recommendation)
    .filter((n): n is number => n !== null);
}

function StepIntro({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-8 max-w-[60ch]">
      <h2 className="text-3xl leading-tight font-bold sm:text-4xl">{title}</h2>
      <p className="mt-3 text-lg leading-relaxed text-(--hd-muted)">{body}</p>
    </div>
  );
}

function Email({ text }: { text: string }) {
  return (
    <div className="border border-(--hd-rule) bg-(--hd-paper) shadow-sm">
      <dl className="grid grid-cols-[4.5rem_1fr] gap-y-1 border-b border-(--hd-rule) px-5 py-4 text-sm">
        <dt className="text-(--hd-muted)">To</dt>
        <dd>Sarah, Operations Director</dd>
        <dt className="text-(--hd-muted)">From</dt>
        <dd>Tom, BrightPath Consulting</dd>
        <dt className="text-(--hd-muted)">Subject</dt>
        <dd className="font-semibold">Digital transformation for your business</dd>
      </dl>
      <p className="px-5 py-6 text-lg leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  );
}

function Score({ view, label }: { view: ReportView; label: string }) {
  return (
    <div>
      <p className="hd-slug">{label}</p>
      <p className="mt-2 flex items-baseline gap-3">
        <span className="font-serif text-7xl leading-none font-bold tabular-nums">
          {view.verdict.overall}
        </span>
        <span className="font-mono text-sm uppercase">{view.verdict.band}</span>
      </p>
    </div>
  );
}

export default async function ExampleReviewPage() {
  await connection();
  const views = await loadExampleViews();
  if (!views) notFound();
  const picks = editorsPicks(views.draft);
  const draftQuick = forStep(views.draftQuick);
  const draftReviewed = forStep(views.draft, picks);
  const draftReport = forStep(views.draft);
  const final = forStep(views.final);
  const S = COPY.steps;
  // The quick scan is shown only while it is offered (its switch), as on every page.
  const quickScan = isQuickScanEnabled();
  const quickStep = (
    <section key="quick" data-testid="step-quick">
      <StepIntro title={S.quick.title} body={S.quick.body} />
      <div className="grid gap-10 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="grid content-start gap-8">
          <Score view={draftQuick} label="Quick scan" />
          <ScoreBars
            title="Appeal scores"
            description="From word patterns alone."
            max={100}
            testId="example-quick-appeals"
            rows={draftQuick.lands.appeals.map((a) => ({
              id: a.id,
              label: a.name,
              score: a.score,
              colour: APPEAL_COLOUR[a.id],
            }))}
          />
        </div>
        <MarkedUpCopy copy={draftQuick.copy} idPrefix="quick-" />
      </div>
    </section>
  );

  return (
    <div className="container mx-auto px-4 py-6 md:py-10">
      <article className="hd-sheet">
        <div className="px-4 py-10 sm:px-6 md:px-12 md:py-14">
          <p className="hd-slug">{COPY.slug}</p>
          <h1 className="mt-4 max-w-[18ch] text-4xl leading-[1.05] font-extrabold sm:text-6xl">
            {COPY.h1}
          </h1>
          <p className="mt-6 max-w-[60ch] text-lg leading-relaxed text-(--hd-muted)">{COPY.lead}</p>
        </div>

        <div className="border-t border-(--hd-rule) px-4 py-10 sm:px-6 md:px-12 md:py-14">
          <ReviewSteps
            steps={[
              { id: 'draft', label: S.draft.label },
              ...(quickScan ? [{ id: 'quick', label: S.quick.label }] : []),
              { id: 'review', label: S.review.label },
              { id: 'report', label: S.report.label },
              { id: 'rewrite', label: S.rewrite.label },
            ]}
          >
            {[
              <section key="draft" data-testid="step-draft">
                <StepIntro title={S.draft.title} body={S.draft.body} />
                <div className="max-w-3xl">
                  <Email text={views.draftText} />
                </div>
              </section>,

              ...(quickScan ? [quickStep] : []),

              <section key="review" data-testid="step-review">
                <StepIntro title={S.review.title} body={S.review.body} />
                <MarkedUpCopy copy={draftReviewed.copy} idPrefix="review-" />
                {draftReviewed.recommendations.length > 0 && (
                  <div className="mt-12 border-t border-(--hd-rule) pt-8">
                    <h3 className="text-2xl font-bold">The rewrites that matter most</h3>
                    <p className="mt-2 mb-6 text-(--hd-muted)">
                      Square brackets mark a fact only Tom has: the reviewers leave a gap rather
                      than invent one.
                    </p>
                    <Recommendations view={draftReviewed} idPrefix="review-" />
                  </div>
                )}
              </section>,

              <section key="report" data-testid="step-report">
                <StepIntro title={S.report.title} body={S.report.body} />
                <Verdict view={draftReport} idPrefix="report-" />
                <div className="mt-12 border-t border-(--hd-rule) pt-8">
                  <HowItLands view={draftReport} />
                </div>
              </section>,

              <section key="rewrite" data-testid="step-rewrite">
                <StepIntro title={S.rewrite.title} body={S.rewrite.body} />
                <BeforeAfter
                  before={{
                    label: 'First draft',
                    text: views.draftText,
                    score: draftReport.verdict.overall,
                    band: draftReport.verdict.band,
                  }}
                  after={{
                    label: 'Final draft',
                    text: views.finalText,
                    score: final.verdict.overall,
                    band: final.verdict.band,
                  }}
                />
                <div className="mt-12 border-t border-(--hd-rule) pt-8">
                  <h3 className="mb-6 text-2xl font-bold">The review of the final draft</h3>
                  <Verdict view={final} idPrefix="final-" />
                </div>
                <div className="mt-12 border-t border-(--hd-rule) pt-8">
                  <h3 className="mb-6 text-2xl font-bold">What works now</h3>
                  <MarkedUpCopy copy={final.copy} idPrefix="final-" />
                </div>
              </section>,
            ]}
          </ReviewSteps>
        </div>

        <div className="border-t border-(--hd-rule) px-4 py-10 sm:px-6 md:px-12 md:py-14">
          <div className="grid items-end gap-6 bg-(--hd-ink) p-6 text-(--hd-paper) sm:p-10 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <h2 className="text-4xl leading-none font-bold">{COPY.ctaH}</h2>
              <p className="mt-4 max-w-[56ch] leading-relaxed opacity-80">{COPY.cta}</p>
            </div>
            <Button
              asChild
              size="lg"
              className="bg-(--hd-paper) text-(--hd-ink) hover:bg-(--hd-paper)/90"
            >
              <Link href={REDEEM_PATH}>Have a code? Get your free review</Link>
            </Button>
          </div>
        </div>
      </article>
    </div>
  );
}

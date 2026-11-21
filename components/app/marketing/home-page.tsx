import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Button } from '@/components/ui/button';
import { CodeEntryForm } from '@/components/app/redeem/redeem-states';
import {
  HOME_APPEALS,
  HOME_CONTEXT,
  HOME_COPY as C,
  HOME_PAGE_TEXT,
} from '@/components/app/marketing/home-copy';
import { SampleMarkUp } from '@/components/app/marketing/sample-mark-up';
import { SelfScorePanel } from '@/components/app/marketing/self-score-panel';
import { REDEEM_PATH } from '@/lib/app/credits/codes/wire';
import { selfScore } from '@/lib/app/quick-scan/self-score';

/**
 * `/`: HowDoesThisLand's landing page (t-62). `app/(public)/page.tsx` is a
 * one-line shim re-exporting this (CUSTOMIZATION.md §6; ledger row 24).
 *
 * The way in is a free review code: "Have a code?" goes to `/redeem`, and so
 * does the code box. Sign-up without a code is secondary.
 *
 * The hero's panel is the page's own copy scored live by the quick scan, with
 * the quick-scan switch on, or a static marked-up sample with it off
 * (`selfScore()` returns `null` off, before any engine call). Rendered per
 * request, so the switch is the running server's; the score is kept per
 * published framework version (`self-score.ts`), not rerun per view.
 */

const description =
  'HowDoesThisLand reads your CV, pitch or proposal the way your reader will. Nine AI reviewers score its credibility, emotion, logic and timing, and show you how to strengthen the case.';
const title = 'HowDoesThisLand: find out why your words aren’t landing';

export const metadata: Metadata = {
  // Absolute: the group's `%s - HowDoesThisLand` template would name the brand twice.
  title: { absolute: title },
  description,
  openGraph: { title, description, type: 'website' },
  twitter: { card: 'summary_large_image', title, description },
};

const APPEAL_COLOUR: Readonly<Record<string, string>> = {
  ethos: 'var(--hd-ethos)',
  pathos: 'var(--hd-pathos)',
  logos: 'var(--hd-logos)',
  kairos: 'var(--hd-kairos)',
};

function WayIn({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <Button asChild size="lg" className="bg-(--hd-red) text-white hover:bg-(--hd-red)/90">
        <Link href={REDEEM_PATH} data-testid={`${id}-redeem`}>
          Have a code? Get your free review
        </Link>
      </Button>
      <span className="text-sm text-(--hd-muted)">
        No code?{' '}
        <Link href="/signup" className="text-(--hd-ink) underline underline-offset-4">
          Create an account
        </Link>
      </span>
    </div>
  );
}

function Band({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`border-t border-(--hd-rule) px-6 py-12 md:px-12 md:py-16 ${className}`}>
      {children}
    </div>
  );
}

export default async function HomePage() {
  await connection();
  const score = await selfScore(HOME_PAGE_TEXT, HOME_CONTEXT);

  return (
    <div className="container mx-auto px-4 py-6 md:py-10">
      <article className="hd-sheet">
        {/* Hero */}
        <div className="grid items-start gap-10 px-6 py-10 md:px-12 md:py-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div>
            <p className="hd-slug">{C.slug}</p>
            <h1 className="mt-4 max-w-[13ch] text-5xl leading-[0.95] font-extrabold sm:text-6xl xl:text-7xl">
              {C.h1Lead}{' '}
              <em className="font-sans font-normal text-(--hd-red) italic">{C.h1Turn}</em>
            </h1>
            <p className="mt-6 max-w-[54ch] text-lg leading-relaxed text-(--hd-muted)">{C.sub}</p>
            <div className="mt-8">
              <WayIn id="hero" />
            </div>
            <div className="mt-8 max-w-xl border-t border-dashed border-(--hd-rule) pt-6">
              <CodeEntryForm />
            </div>
          </div>
          {score ? <SelfScorePanel score={score} /> : <SampleMarkUp />}
        </div>

        {/* The problem */}
        <Band className="grid items-start gap-8 lg:grid-cols-2">
          <p className="max-w-[22ch] font-sans text-3xl leading-[1.12] italic sm:text-4xl">
            {C.story}
          </p>
          <div className="max-w-[56ch] leading-relaxed text-(--hd-muted) lg:pt-3">
            <p>{C.story2}</p>
            <p className="mt-4 text-(--hd-ink)">{C.compare}</p>
          </div>
        </Band>

        {/* Why now */}
        <Band className="grid gap-8 lg:grid-cols-2">
          <h2 className="max-w-[12ch] text-4xl leading-none font-bold sm:text-5xl">{C.nowH}</h2>
          <p className="max-w-[56ch] leading-relaxed text-(--hd-muted) lg:pt-2">{C.now}</p>
        </Band>

        {/* Roots: the four appeals */}
        <Band>
          <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <h2 className="max-w-[14ch] text-4xl leading-[1.02] font-bold sm:text-5xl">
              {C.rootsH}
            </h2>
            <p className="max-w-[58ch] leading-relaxed text-(--hd-muted)">{C.roots}</p>
          </div>
          <ul className="mt-10 grid grid-cols-2 gap-6 lg:grid-cols-4">
            {HOME_APPEALS.map((a) => (
              <li
                key={a.id}
                className="border-t-2 pt-4"
                style={{ borderColor: APPEAL_COLOUR[a.id] }}
              >
                <h3
                  className="text-2xl leading-none font-bold"
                  style={{ color: APPEAL_COLOUR[a.id] }}
                >
                  {a.name}
                </h3>
                <p className="mt-1 text-(--hd-muted)" lang="grc">
                  {a.greek}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-(--hd-muted)">{a.question}</p>
              </li>
            ))}
          </ul>
        </Band>

        {/* How it works */}
        <Band>
          <h2 className="text-4xl leading-tight font-bold">{C.stepsH}</h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {C.steps.map((s, i) => (
              <li key={s.title} className="relative pl-14">
                <span
                  aria-hidden="true"
                  className="absolute top-0 left-0 grid h-10 w-10 place-items-center rounded-full border border-(--hd-rule) font-serif text-xl tabular-nums"
                >
                  {i + 1}
                </span>
                <h3 className="mb-1.5 text-lg font-semibold">{s.title}</h3>
                <p className="leading-relaxed text-(--hd-muted)">{s.body}</p>
              </li>
            ))}
          </ol>
        </Band>

        {/* Honest */}
        <Band>
          <h2 className="max-w-[18ch] text-4xl leading-[1.05] font-bold">{C.honestH}</h2>
          <p className="mt-5 max-w-[64ch] leading-relaxed text-(--hd-muted)">{C.honest}</p>
          <p className="mt-4 max-w-[64ch] leading-relaxed">{C.good}</p>
        </Band>

        {/* Who, and the way in again */}
        <Band>
          <p className="text-(--hd-muted)">{C.who}</p>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Types of copy">
            {C.kinds.map((k) => (
              <li
                key={k}
                className="inline-flex h-9 items-center rounded-full border border-(--hd-rule) px-3.5 text-sm"
              >
                {k}
              </li>
            ))}
          </ul>
          <div className="mt-12 grid items-end gap-8 bg-(--hd-ink) p-8 text-(--hd-paper) sm:p-12 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <h2 className="max-w-[16ch] text-4xl leading-none font-bold sm:text-5xl">{C.ctaH}</h2>
              <p className="mt-5 max-w-[58ch] leading-relaxed opacity-75">{C.cta}</p>
            </div>
            <Button
              asChild
              size="lg"
              className="bg-(--hd-paper) text-(--hd-ink) hover:bg-(--hd-paper)/90"
            >
              <Link href={REDEEM_PATH} data-testid="cta-redeem">
                Have a code? Get your free review
              </Link>
            </Button>
          </div>
        </Band>
      </article>
    </div>
  );
}

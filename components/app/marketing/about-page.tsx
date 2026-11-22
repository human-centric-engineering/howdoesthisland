import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ABOUT_COPY as C } from '@/components/app/marketing/about-copy';
import { REDEEM_PATH } from '@/lib/app/credits/codes/wire';
import { BRAND } from '@/lib/brand';
import { source } from '@/lib/app/explainer/sources';
import { SourceChip } from '@/components/app/model/source-chip';

/**
 * `/about`: why HowDoesThisLand exists and where the idea comes from (t-63).
 * `app/(public)/about/page.tsx` is a one-line shim re-exporting this
 * (CUSTOMIZATION.md §6; ledger row 27).
 *
 * Static copy only: it reads no model, so it never goes stale when the model
 * changes. The model's detail is on `/model`.
 */

const description = `Why ${BRAND.name} exists: you can never know for certain how a message will land, but you can cut down the guesswork.`;
const title = 'About';

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title: `About - ${BRAND.name}`, description },
  twitter: { card: 'summary_large_image', title: `About - ${BRAND.name}`, description },
};

const APPEAL_COLOUR: Readonly<Record<string, string>> = {
  Ethos: 'var(--hd-ethos)',
  Pathos: 'var(--hd-pathos)',
  Logos: 'var(--hd-logos)',
  Kairos: 'var(--hd-kairos)',
};

function Band({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`border-t border-(--hd-rule) px-4 py-10 sm:px-6 md:px-12 md:py-16 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A heading beside its text, on one grid for every such band on the page, so
 * the text column starts in the same place each time. Aligned on the first
 * line's baseline, so the heading and the first line of text sit level.
 */
const SPLIT_GRID =
  'grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-baseline lg:gap-8';

function Split({
  heading,
  italic = false,
  children,
}: {
  heading: string;
  /** The story's heading is set as a line of italic prose, not a bold head. */
  italic?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Band className={SPLIT_GRID}>
      <h2
        className={
          italic
            ? 'max-w-[18ch] font-sans text-3xl leading-[1.12] italic sm:text-4xl'
            : 'max-w-[16ch] text-3xl leading-[1.05] font-bold sm:text-4xl'
        }
      >
        {heading}
      </h2>
      <div className="max-w-[60ch] space-y-4 leading-relaxed text-(--hd-muted)">{children}</div>
    </Band>
  );
}

export default function AboutPage() {
  return (
    <div className="container mx-auto px-4 py-6 md:py-10">
      <article className="hd-sheet">
        <Band className="border-t-0">
          <p className="hd-slug">{C.slug}</p>
          <h1 className="mt-4 text-5xl leading-[1.02] font-extrabold sm:text-7xl">{C.h1}</h1>
          <p className="mt-6 max-w-[54ch] text-lg leading-relaxed text-(--hd-muted)">{C.sub}</p>
        </Band>

        <Split heading={C.storyH} italic>
          <p>{C.story}</p>
          <p className="text-(--hd-ink)">{C.story2}</p>
        </Split>

        <Split heading={C.perceiveH}>
          <p>{C.perceive}</p>
          <p>{C.bias}</p>
          <p className="text-(--hd-ink)">{C.unknowable}</p>
        </Split>

        <Split heading={C.helpH}>
          <p>{C.help}</p>
          <p className="text-(--hd-ink)">{C.help2}</p>
        </Split>

        <Band>
          <h2 className="text-3xl leading-tight font-bold sm:text-4xl">{C.qualitiesH}</h2>
          <p className="mt-4 max-w-[60ch] leading-relaxed text-(--hd-muted)">{C.qualitiesLead}</p>
          <dl className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            {C.qualities.map((q) => (
              <div key={q.name} className="border-t border-(--hd-rule) pt-3">
                <dt className="text-lg font-semibold">{q.name}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-(--hd-muted)">{q.body}</dd>
              </div>
            ))}
          </dl>
        </Band>

        <Band>
          <div className={SPLIT_GRID}>
            <h2 className="max-w-[16ch] text-3xl leading-[1.05] font-bold sm:text-4xl">
              {C.layerH}
            </h2>
            <p className="max-w-[60ch] leading-relaxed text-(--hd-muted)">{C.layer}</p>
          </div>
          <ul className="mt-8 grid grid-cols-2 gap-6 lg:grid-cols-4">
            {C.appeals.map((a) => (
              <li
                key={a.name}
                className="border-t-2 pt-3"
                style={{ borderColor: APPEAL_COLOUR[a.name] }}
              >
                <h3
                  className="text-xl leading-none font-bold"
                  style={{ color: APPEAL_COLOUR[a.name] }}
                >
                  {a.name}
                </h3>
                <p className="mt-1 text-(--hd-muted)" lang="grc">
                  {a.greek}
                </p>
                <p className="mt-2 text-sm leading-relaxed">{a.question}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 max-w-[64ch] leading-relaxed text-(--hd-muted)">{C.layer2}</p>
        </Band>

        <Split heading={C.trustH}>
          <p>{C.trust}</p>
          <p className="text-(--hd-ink)">{C.limits}</p>
        </Split>

        <Band>
          <h2 className="text-2xl leading-tight font-bold">{C.sourcesH}</h2>
          <p className="mt-2 text-sm text-(--hd-muted)">{C.sourcesLead}</p>
          <ul className="mt-4 flex flex-wrap gap-2" data-testid="about-sources">
            {C.sources.map((id) => (
              <li key={id}>
                <SourceChip source={source(id)} />
              </li>
            ))}
          </ul>
        </Band>

        <Band>
          <div className="grid items-end gap-8 bg-(--hd-ink) p-6 text-(--hd-paper) sm:p-12 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <h2 className="max-w-[16ch] text-3xl leading-none font-bold sm:text-5xl">{C.ctaH}</h2>
              <p className="mt-5 max-w-[58ch] leading-relaxed opacity-75">{C.cta}</p>
            </div>
            <Button
              asChild
              size="lg"
              className="bg-(--hd-paper) text-(--hd-ink) hover:bg-(--hd-paper)/90"
            >
              <Link href={REDEEM_PATH} data-testid="about-redeem">
                Have a code? Get your free review
              </Link>
            </Button>
          </div>
          <p className="mt-6 text-sm">
            <Link href="/model" className="underline underline-offset-4">
              {C.modelLink}
            </Link>
          </p>
        </Band>
      </article>
    </div>
  );
}

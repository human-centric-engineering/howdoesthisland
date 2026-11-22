import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CHAPTERS, MODEL_HUB, chapter, type Entry, type Group } from '@/lib/app/explainer/chapters';
import { SOURCES, source } from '@/lib/app/explainer/sources';
import { REDEEM_PATH } from '@/lib/app/credits/codes/wire';
import { Button } from '@/components/ui/button';
import { BRAND } from '@/lib/brand';
import { SourceChip } from '@/components/app/model/source-chip';

/**
 * The model, explained (t-63): `/model`, a page per chapter, and
 * `/model/sources`. The routes in `app/(public)/model/` are one line each
 * over these.
 *
 * Guided reading rather than a web of cross-links: each chapter reads top to
 * bottom, its detail opens in place (an entry's explanation in a disclosure,
 * a source in a popover), and the only links lead on to the next chapter or
 * out to a source. Entries are server-rendered HTML, folded detail included,
 * so a search engine reads every word. A source's details mount only when
 * its popover opens; they are all in the HTML of `/model/sources`.
 *
 * Reads the explainer (`lib/app/explainer/`), never the model: nothing here
 * can publish what makes the model work, and no page names a version.
 */

const BASE = '/model';
const chapterHref = (slug: string) => `${BASE}/${slug}`;

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="container mx-auto px-4 py-6 md:py-10">
      <article className="hd-sheet">{children}</article>
    </div>
  );
}

function Band({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`border-t border-(--hd-rule) px-4 py-10 sm:px-6 md:px-12 md:py-14 ${className}`}
    >
      {children}
    </div>
  );
}

function Sources({
  ids,
  label = 'Where this comes from',
}: {
  ids?: readonly string[];
  label?: string;
}) {
  if (!ids?.length) return null;
  return (
    <div className="mt-4">
      <p className="text-xs tracking-wide text-(--hd-muted) uppercase">{label}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {ids.map((id) => (
          <li key={id}>
            <SourceChip source={source(id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EntryItem({ entry }: { entry: Entry }) {
  return (
    <details id={entry.id} className="group scroll-mt-24 border-t border-(--hd-rule) py-4">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
        <span>
          <span className="block text-xl leading-tight font-semibold">{entry.title}</span>
          {entry.aside && (
            <span className="mt-1 block text-sm text-(--hd-muted) italic">{entry.aside}</span>
          )}
          <span className="mt-1 block leading-relaxed text-(--hd-muted)">{entry.summary}</span>
        </span>
        <span
          aria-hidden="true"
          className="mt-1 shrink-0 text-xl leading-none text-(--hd-muted) transition-transform group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <div className="mt-4 max-w-[64ch] space-y-3 leading-relaxed">
        {entry.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {entry.example && (
          <dl className="grid gap-2 border-l-2 border-(--hd-rule) pl-4 text-sm sm:grid-cols-[5rem_1fr]">
            <dt className="text-(--hd-muted)">Before</dt>
            <dd>{entry.example.before}</dd>
            <dt className="text-(--hd-muted)">After</dt>
            <dd>{entry.example.after}</dd>
          </dl>
        )}
        <Sources ids={entry.sources} />
      </div>
    </details>
  );
}

function GroupSection({ group }: { group: Group }) {
  return (
    <section id={group.id} aria-labelledby={`${group.id}-title`} className="scroll-mt-24">
      <h2 id={`${group.id}-title`} className="text-3xl leading-tight font-bold">
        {group.title}
      </h2>
      {group.intro?.map((p, i) => (
        <p key={i} className="mt-4 max-w-[64ch] leading-relaxed text-(--hd-muted)">
          {p}
        </p>
      ))}
      <Sources ids={group.sources} />
      <div className="mt-6">
        {group.entries.map((e) => (
          <EntryItem key={e.id} entry={e} />
        ))}
      </div>
    </section>
  );
}

function WayIn() {
  return (
    <Band>
      <div className="grid items-end gap-6 bg-(--hd-ink) p-6 text-(--hd-paper) sm:p-10 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <h2 className="text-3xl leading-tight font-bold">See it read your own copy.</h2>
          <p className="mt-3 max-w-[56ch] leading-relaxed opacity-80">
            A full review applies all of this to your draft, for the reader you choose, and shows
            you what to change.
          </p>
        </div>
        <Button
          asChild
          size="lg"
          className="bg-(--hd-paper) text-(--hd-ink) hover:bg-(--hd-paper)/90"
        >
          <Link href={REDEEM_PATH}>Have a code? Get your free review</Link>
        </Button>
      </div>
    </Band>
  );
}

function meta(title: string, description: string, path: string): Metadata {
  // The `%s - Brand` template reaches only <title>; a share card names the brand itself.
  const card = `${title} - ${BRAND.name}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title: card, description },
    twitter: { card: 'summary_large_image', title: card, description },
  };
}

// ─── The hub ────────────────────────────────────────────────────────────────

export const hubMetadata: Metadata = meta(MODEL_HUB.title, MODEL_HUB.description, BASE);

export function ModelHubPage() {
  return (
    <Sheet>
      <Band className="border-t-0">
        <p className="hd-slug">{MODEL_HUB.slug}</p>
        <h1 className="mt-4 max-w-[16ch] text-4xl leading-[1.05] font-extrabold sm:text-6xl">
          {MODEL_HUB.title}
        </h1>
        {MODEL_HUB.lead.map((p, i) => (
          <p key={i} className="mt-6 max-w-[60ch] text-lg leading-relaxed text-(--hd-muted)">
            {p}
          </p>
        ))}
      </Band>
      <Band>
        <ol className="grid gap-8 sm:grid-cols-2" data-testid="model-chapters">
          {CHAPTERS.map((c, i) => (
            <li key={c.slug} className="border-t-2 border-(--hd-ink) pt-4">
              <p className="text-sm text-(--hd-muted) tabular-nums">{i + 1}</p>
              <h2 className="mt-1 text-2xl leading-tight font-bold">
                <Link href={chapterHref(c.slug)} className="hover:underline">
                  {c.title}
                </Link>
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-(--hd-muted)">{c.description}</p>
            </li>
          ))}
        </ol>
        <p className="mt-10 text-sm">
          <Link href={`${BASE}/sources`} className="underline underline-offset-4">
            {MODEL_HUB.sourcesTitle}: the thinkers, books and studies behind it
          </Link>
        </p>
      </Band>
      <WayIn />
    </Sheet>
  );
}

// ─── A chapter ──────────────────────────────────────────────────────────────

export function chapterMetadata(slug: string): Metadata {
  const c = chapter(slug);
  return c ? meta(c.title, c.description, chapterHref(c.slug)) : { title: MODEL_HUB.title };
}

export function ChapterPage({ slug }: { slug: string }) {
  const c = chapter(slug);
  if (!c) notFound();
  const index = CHAPTERS.indexOf(c);
  const next = CHAPTERS[index + 1];

  return (
    <Sheet>
      <Band className="border-t-0">
        <p className="hd-slug">
          <Link href={BASE} className="hover:underline">
            {MODEL_HUB.title}
          </Link>{' '}
          · {index + 1} of {CHAPTERS.length}
        </p>
        <h1 className="mt-4 max-w-[20ch] text-4xl leading-[1.05] font-extrabold sm:text-5xl">
          {c.title}
        </h1>
        {c.lead.map((p, i) => (
          <p key={i} className="mt-5 max-w-[60ch] text-lg leading-relaxed text-(--hd-muted)">
            {p}
          </p>
        ))}
        {c.groups.length > 1 && (
          <nav aria-label="On this page" className="mt-8">
            <ul className="flex flex-wrap gap-2">
              {c.groups.map((g) => (
                <li key={g.id}>
                  <a
                    href={`#${g.id}`}
                    className="inline-flex min-h-9 items-center rounded-full border border-(--hd-rule) px-3 text-sm hover:border-(--hd-ink)"
                  >
                    {g.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </Band>
      {c.groups.map((g) => (
        <Band key={g.id}>
          <GroupSection group={g} />
        </Band>
      ))}
      <Band>
        <p className="flex flex-wrap justify-between gap-4 text-sm">
          <Link href={BASE} className="underline underline-offset-4">
            All of how a review works
          </Link>
          {next && (
            <Link
              href={chapterHref(next.slug)}
              className="font-semibold underline underline-offset-4"
            >
              Next: {next.title}
            </Link>
          )}
        </p>
      </Band>
      <WayIn />
    </Sheet>
  );
}

// ─── Sources ────────────────────────────────────────────────────────────────

export const sourcesMetadata: Metadata = meta(
  `${MODEL_HUB.sourcesTitle}: ${MODEL_HUB.title}`,
  MODEL_HUB.sourcesDescription,
  `${BASE}/sources`
);

export function SourcesPage() {
  return (
    <Sheet>
      <Band className="border-t-0">
        <p className="hd-slug">
          <Link href={BASE} className="hover:underline">
            {MODEL_HUB.title}
          </Link>
        </p>
        <h1 className="mt-4 text-4xl leading-[1.05] font-extrabold sm:text-5xl">
          {MODEL_HUB.sourcesTitle}
        </h1>
        <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-(--hd-muted)">
          {MODEL_HUB.sourcesLead}
        </p>
      </Band>
      <Band>
        <ul className="space-y-8" data-testid="model-sources">
          {SOURCES.map((s) => (
            <li key={s.id} id={s.id} className="scroll-mt-24 border-t border-(--hd-rule) pt-4">
              <h2 className="text-xl leading-tight font-semibold">{s.title}</h2>
              <p className="mt-1 text-sm text-(--hd-muted)">
                {s.who}, {s.when}.
              </p>
              <p className="mt-2 max-w-[64ch] leading-relaxed">{s.context}</p>
              {s.url && (
                <p className="mt-2 text-sm">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    Read more
                  </a>
                </p>
              )}
            </li>
          ))}
        </ul>
      </Band>
      <WayIn />
    </Sheet>
  );
}

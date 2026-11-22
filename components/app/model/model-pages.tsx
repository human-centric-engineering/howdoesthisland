import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HOWDOESTHISLAND_SLUG } from '@/lib/app/frameworks/howdoesthisland/slug';
import type { BrowseKind, BrowseSection } from '@/lib/app/frameworks/browse';
import { RecordCard, recordTitle } from '@/components/app/model/record-card';
import { loadModel, MODEL_BASE, versionBase, type LoadedModel } from '@/components/app/model/load';
import { FEATURED_SECTIONS, kindLabel, sectionCopy } from '@/components/app/model/presentation';

/**
 * The model as browsable pages (t-63): `/model`, `/model/{section}`, and the
 * same for any published version at `/model/v/{version}/…`. The routes in
 * `app/(public)/model/` are one line each over these.
 *
 * Unversioned URLs show the latest version and link within it. A versioned
 * URL pins one version, and its links stay in that version, so a report made
 * with an older version can point at the questions that scored it.
 */

export const MODEL_COPY = {
  slug: 'The model',
  h1: 'What a review looks for, and why.',
  lead: 'Every review HowDoesThisLand gives is scored against this model. It’s here so you can check the reasoning behind a score instead of taking it on trust. You can see each question an AI reviewer asks, the evidence behind it, and where the model is weak.',
  versions:
    'The model is published in versions. A published version never changes, and every review records the one it used, so a score can always be traced to the questions behind it. Later versions will add, drop and rework parts of it as the evidence moves.',
  start:
    'Start with the appeals for the shape of it, or with the limitations to see what not to rely on.',
  empty: 'The model has not been published here yet.',
  also: 'Also in the model',
} as const;

const description =
  'The model behind every HowDoesThisLand review: the questions each AI reviewer asks, the evidence behind them, and where the model is weak.';

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

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(iso)
  );
}

/** Which version this is, and a way to the latest when it is not. */
function VersionLine({ loaded }: { loaded: LoadedModel }) {
  const { version, latestVersion, base } = loaded;
  const published = formatDate(version.publishedAt);
  const pinned = base !== MODEL_BASE;
  return (
    <div className="mt-4 space-y-1 text-sm text-(--hd-muted)" data-testid="model-version">
      <p>
        Version {version.version}
        {published ? `, published ${published}` : ''}.
      </p>
      {version.status === 'retired' && (
        <p className="text-(--hd-ink)">
          This version is retired. Reviews made with it still point here.
        </p>
      )}
      {pinned && latestVersion && latestVersion !== version.version && (
        <p>
          The latest is{' '}
          <Link href={MODEL_BASE} className="text-(--hd-ink) underline underline-offset-4">
            version {latestVersion}
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function countLine(section: BrowseSection): string {
  const parts: string[] = [];
  for (const k of section.kinds) {
    parts.push(
      `${k.records.length} ${kindLabel(k.kind, k.records.length === 1 ? 'one' : 'many').toLowerCase()}`
    );
    if (k.nestedKind) {
      const n = k.records.reduce((sum, r) => sum + r.children.length, 0);
      parts.push(`${n} ${kindLabel(k.nestedKind, n === 1 ? 'one' : 'many').toLowerCase()}`);
    }
  }
  return parts.join(' · ');
}

function SectionLink({ section, base }: { section: BrowseSection; base: string }) {
  const copy = sectionCopy(section.key);
  return (
    <li className="border-t-2 border-(--hd-ink) pt-4">
      <h3 className="text-2xl leading-tight font-bold">
        <Link href={`${base}/${section.segment}`} className="hover:underline">
          {copy.title}
        </Link>
      </h3>
      <p className="mt-1 text-xs tracking-wide text-(--hd-muted) uppercase">{countLine(section)}</p>
      {copy.intro && <p className="mt-2 text-sm leading-relaxed text-(--hd-muted)">{copy.intro}</p>}
    </li>
  );
}

function ApiLine({ loaded }: { loaded: LoadedModel }) {
  const url = `/api/v1/frameworks/${HOWDOESTHISLAND_SLUG}/versions/${encodeURIComponent(loaded.version.version)}`;
  return (
    <p className="text-sm text-(--hd-muted)">
      The same model as data:{' '}
      <a
        href={url}
        className="font-mono text-xs break-all text-(--hd-ink) underline underline-offset-4"
      >
        GET {url}
      </a>
      . See the{' '}
      <Link href="/developers" className="text-(--hd-ink) underline underline-offset-4">
        developer docs
      </Link>
      .
    </p>
  );
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

export function modelIndexMetadata(version?: string): Metadata {
  const title = version ? `The model, version ${version}` : 'The model';
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export async function ModelIndexPage({ version }: { version?: string }) {
  const loaded = await loadModel(version);
  if (!loaded) {
    if (version) notFound();
    return (
      <Sheet>
        <Band className="border-t-0">
          <p className="hd-slug">{MODEL_COPY.slug}</p>
          <h1 className="mt-4 text-4xl leading-tight font-extrabold sm:text-5xl">
            {MODEL_COPY.h1}
          </h1>
          <p className="mt-6 text-(--hd-muted)">{MODEL_COPY.empty}</p>
        </Band>
      </Sheet>
    );
  }

  const { browse, base, versions } = loaded;
  const featured = FEATURED_SECTIONS.flatMap((key) => browse.sections.filter((s) => s.key === key));
  const others = browse.sections.filter((s) => !FEATURED_SECTIONS.includes(s.key));

  return (
    <Sheet>
      <Band className="border-t-0">
        <p className="hd-slug">{MODEL_COPY.slug}</p>
        <h1 className="mt-4 max-w-[18ch] text-4xl leading-[1.05] font-extrabold sm:text-6xl">
          {MODEL_COPY.h1}
        </h1>
        <p className="mt-6 max-w-[60ch] text-lg leading-relaxed text-(--hd-muted)">
          {MODEL_COPY.lead}
        </p>
        <VersionLine loaded={loaded} />
      </Band>

      <Band>
        <p className="max-w-[60ch] leading-relaxed">{MODEL_COPY.start}</p>
        <ul className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3" data-testid="model-featured">
          {featured.map((s) => (
            <SectionLink key={s.key} section={s} base={base} />
          ))}
        </ul>
      </Band>

      {others.length > 0 && (
        <Band>
          <h2 className="text-3xl leading-tight font-bold">{MODEL_COPY.also}</h2>
          <ul className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3" data-testid="model-others">
            {others.map((s) => (
              <SectionLink key={s.key} section={s} base={base} />
            ))}
          </ul>
        </Band>
      )}

      <Band>
        <h2 className="text-2xl leading-tight font-bold">Versions</h2>
        <p className="mt-3 max-w-[60ch] leading-relaxed text-(--hd-muted)">{MODEL_COPY.versions}</p>
        <ul className="mt-4 space-y-1 text-sm">
          {versions.map((v) => (
            <li key={v.version}>
              <Link
                href={versionBase(v.version)}
                className="underline underline-offset-4"
                aria-current={v.version === loaded.version.version ? 'page' : undefined}
              >
                Version {v.version}
              </Link>
              <span className="text-(--hd-muted)">
                {v.status === 'retired' ? ', retired' : ''}
                {formatDate(v.publishedAt) ? `, published ${formatDate(v.publishedAt)}` : ''}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <ApiLine loaded={loaded} />
        </div>
      </Band>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// A section
// ---------------------------------------------------------------------------

/** A section the version has and a switch does not withhold, or a 404. */
async function loadSection(segment: string, version?: string) {
  const loaded = await loadModel(version);
  const section = loaded?.browse.section(segment) ?? null;
  if (!loaded || !section) notFound();
  return { loaded, section };
}

export async function modelSectionMetadata(segment: string, version?: string): Promise<Metadata> {
  const loaded = await loadModel(version);
  const section = loaded?.browse.section(segment);
  if (!section) return { title: 'The model' };
  const copy = sectionCopy(section.key);
  const title = version
    ? `${copy.title}: the model, version ${version}`
    : `${copy.title}: the model`;
  const desc = copy.intro ?? description;
  return {
    title,
    description: desc,
    openGraph: { title, description: desc },
    twitter: { card: 'summary_large_image', title, description: desc },
  };
}

const CONTENTS_FROM = 6;

function KindBlock({
  kind,
  loaded,
  withHeading,
}: {
  kind: BrowseKind;
  loaded: LoadedModel;
  withHeading: boolean;
}) {
  const { browse, base } = loaded;
  return (
    <section aria-labelledby={withHeading ? `kind-${kind.kind}` : undefined}>
      {withHeading && (
        <h2 id={`kind-${kind.kind}`} className="mb-6 text-3xl leading-tight font-bold">
          {kindLabel(kind.kind, 'many')}
        </h2>
      )}
      {kind.records.length >= CONTENTS_FROM && (
        <nav aria-label={`${kindLabel(kind.kind, 'many')}: contents`} className="mb-8">
          <ul className="flex flex-wrap gap-2">
            {kind.records.map((r) => (
              <li key={r.anchor}>
                <a
                  href={`#${r.anchor}`}
                  className="inline-flex min-h-9 items-center rounded-full border border-(--hd-rule) px-3 text-sm hover:border-(--hd-ink)"
                >
                  {recordTitle(r).length > 48 ? `${recordTitle(r).slice(0, 46)}…` : recordTitle(r)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className="space-y-8">
        {kind.records.map((r) => (
          <RecordCard key={r.anchor} record={r} model={browse} base={base} />
        ))}
      </div>
    </section>
  );
}

export async function ModelSectionPage({
  segment,
  version,
}: {
  segment: string;
  version?: string;
}) {
  const { loaded, section } = await loadSection(segment, version);
  const copy = sectionCopy(section.key);
  const several = section.kinds.length > 1;

  return (
    <Sheet>
      <Band className="border-t-0">
        <p className="hd-slug">
          <Link href={loaded.base} className="hover:underline">
            {MODEL_COPY.slug}
          </Link>
        </p>
        <h1 className="mt-4 text-4xl leading-[1.05] font-extrabold break-words sm:text-5xl">
          {copy.title}
        </h1>
        {copy.intro && (
          <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-(--hd-muted)">
            {copy.intro}
          </p>
        )}
        <VersionLine loaded={loaded} />
      </Band>
      {section.kinds.map((kind) => (
        <Band key={kind.kind}>
          <KindBlock kind={kind} loaded={loaded} withHeading={several} />
        </Band>
      ))}
      <Band>
        <p className="text-sm">
          <Link href={loaded.base} className="underline underline-offset-4">
            Back to the whole model
          </Link>
        </p>
        <div className="mt-3">
          <ApiLine loaded={loaded} />
        </div>
      </Band>
    </Sheet>
  );
}

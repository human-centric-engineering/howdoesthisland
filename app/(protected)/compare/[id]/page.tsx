import type { Metadata } from 'next';
import { getServerSession } from '@/lib/auth/utils';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { loadServerData, requireServerData } from '@/lib/api/server-load';
import { logger } from '@/lib/logging';
import { catalogueEndpoint } from '@/components/app/projects/schemas';
import { assessCatalogueSchema } from '@/components/app/workbench/schemas';
import { comparisonEndpoint, comparisonSchema } from '@/components/app/compare/schemas';
import { ComparisonView } from '@/components/app/compare/comparison-view';

export const metadata: Metadata = { title: 'Comparison' };

/**
 * `/compare/[id]` — a comparison of 2–5 drafts (t-89): each draft's scores
 * side by side, the best on each appeal, and the editor's verdict.
 *
 * Read through the one enriched `GET /api/v1/comparisons/{id}`: every draft's
 * state and scores come with it, so nothing is read per draft. Another
 * workspace's id is a 404 from the API, so it renders the not-found page.
 * While drafts run, the view reads it again (`useComparison`).
 *
 * The version's catalogue names the appeals. Only names: one that cannot be
 * read leaves the appeals by id, never an error page.
 */
export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Back to this comparison after signing in.
  const session = await getServerSession();
  if (!session) clearInvalidSession(`/compare/${encodeURIComponent(id)}`);

  const { data } = await requireServerData<unknown>(comparisonEndpoint(id), { notFound: true });
  const parsed = comparisonSchema.safeParse(data);
  if (!parsed.success) {
    logger.error('Comparison: the API reply did not parse', undefined, {
      comparisonId: id,
      issues: parsed.error.issues.slice(0, 5),
    });
    return (
      <section className="hd-sheet mx-auto max-w-3xl px-6 py-10 md:px-10">
        <p className="hd-slug">Comparison</p>
        <h1 className="mt-3 text-3xl font-bold">This comparison can&rsquo;t be shown</h1>
        <p className="mt-4 max-w-prose text-lg text-(--hd-muted)">
          It isn&rsquo;t in a shape this page can read. It has been logged for us to look at.
        </p>
      </section>
    );
  }

  const { slug, version } = parsed.data.framework;
  const read = await loadServerData<unknown>(catalogueEndpoint(slug, version));
  const catalogue = read.ok ? assessCatalogueSchema.safeParse(read.data) : null;
  const appealNames = catalogue?.success
    ? Object.fromEntries(catalogue.data.result.appeals.map((a) => [a.id, a.name]))
    : {};

  return (
    <div className="mx-auto max-w-6xl">
      <ComparisonView comparison={parsed.data} appealNames={appealNames} />
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { getServerSession } from '@/lib/auth/utils';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { loadServerData, requireAllServerData, requireServerData } from '@/lib/api/server-load';
import { logger } from '@/lib/logging';
import { parsePaginationMeta } from '@/lib/validations/common';
import { Button } from '@/components/ui/button';
import { WORDS } from '@/lib/app/reports/words';
import { HOWDOESTHISLAND_SLUG } from '@/lib/app/frameworks/howdoesthisland/slug';
import { HomeEmptyState } from '@/components/app/shell/home-empty-state';
import {
  PROJECTS_ENDPOINT,
  catalogueEndpoint,
  frameworkEndpoint,
  frameworkLatestSchema,
  projectListSchema,
} from '@/components/app/projects/schemas';
import {
  FILTER_KEYS,
  filterCatalogueSchema,
  filterFromSearch,
  filterHref,
  pageFromSearch,
  reviewListEndpoint,
  reviewListSchema,
  type FilterCatalogue,
} from '@/components/app/history/schemas';
import { ReviewFilters } from '@/components/app/history/review-filters';
import { ReviewList } from '@/components/app/history/review-list';
import {
  COMPARISONS_PATH,
  COMPARISON_RECENT_LIMIT,
  comparisonListEndpoint,
  comparisonListSchema,
  type ComparisonRow,
} from '@/components/app/compare/schemas';
import { ComparisonList } from '@/components/app/compare/comparison-list';

export const metadata: Metadata = { title: 'Home' };

/** A version to offer filters from is missing: offer none rather than fail the page. */
const NO_FILTERS: FilterCatalogue = { request: { contentTypes: [] }, result: { bands: [] } };

/**
 * `/home` — where a signed-in person lands (D22, through `lib/app/auth-landing.ts`):
 * the workspace's recent reviews (t-79), newest first, filtered by project,
 * type of copy and band through the address, with a way to `/assess`. The
 * empty desk shows only when the workspace has no review at all.
 *
 * Read through the API (API-first). The list is one call,
 * `GET /api/v1/assessments`, whose rows carry their project's name, so no row
 * fetches its own. The filters' choices are the workspace's projects (archived
 * ones included, marked) and the
 * framework's latest catalogue (its types of copy and bands).
 *
 * Below them, the latest few comparisons of drafts (t-90), with a link to
 * `/compare` for every one: one `GET /api/v1/comparisons` call, read beside
 * the reviews, whose rows carry their drafts' scores and the editor's choice.
 * The filters are the reviews' own and leave the comparisons as they are.
 * The comparisons are a side panel: if they cannot be read, the section is left
 * out and the reviews still show.
 *
 * The proxy only checks that a session cookie exists, and it sends anyone with
 * one away from the login page to here. So a cookie whose session has expired
 * or been revoked must be cleared here, as `/dashboard` does, or that person
 * can never reach the login form.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const session = await getServerSession();
  if (!session) {
    clearInvalidSession('/home');
  }

  const filter = filterFromSearch(search);
  const page = pageFromSearch(search.page);
  const filtered = FILTER_KEYS.some((key) => filter[key]);

  const [loaded, recent] = await Promise.all([
    requireServerData<unknown>(reviewListEndpoint(filter, page)),
    loadRecentComparisons(),
  ]);
  const reviews = reviewListSchema.parse(loaded.data);
  const total = parsePaginationMeta(loaded.meta)?.total ?? reviews.length;
  const { comparisons, total: comparisonTotal } = recent;
  // A comparison whose drafts' reviews were all deleted is still on the desk.
  if (total === 0 && !filtered && comparisonTotal === 0) return <HomeEmptyState />;

  const [catalogue, projects] = await Promise.all([
    loadFilterCatalogue(),
    // Archived ones too: their reviews are still listed, so they can be
    // filtered by, and a filter on one still names it.
    requireAllServerData<{ id: string }>(`${PROJECTS_ENDPOINT}?archived=true`).then((rows) =>
      projectListSchema
        .parse(rows)
        .map(({ id, name, archived }) => ({ id, name: archived ? `${name} (archived)` : name }))
    ),
  ]);

  // Nothing to filter yet: only comparisons are on the desk.
  const noReviews = total === 0 && !filtered;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="hd-slug">Home</p>
          <h1 className="text-2xl font-bold">Recent {WORDS.review}s</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {comparisonTotal > 0 ? (
            <Button asChild variant="outline">
              <Link href={COMPARISONS_PATH}>Comparisons</Link>
            </Button>
          ) : null}
          <Button asChild>
            <Link href="/assess">Review some copy</Link>
          </Button>
        </div>
      </div>
      {noReviews ? null : (
        <ReviewFilters basePath="/home" filter={filter} catalogue={catalogue} projects={projects} />
      )}
      {noReviews ? (
        <div className="rounded-md border p-8 text-center">
          <p className="font-semibold">No {WORDS.review}s here</p>
          <p className="text-muted-foreground mt-1 text-sm">
            <Link href="/assess" className="underline underline-offset-4">
              Review some copy
            </Link>{' '}
            to see it listed here.
          </p>
        </div>
      ) : reviews.length === 0 ? (
        <div className="rounded-md border p-8 text-center">
          <p className="font-semibold">
            {filtered ? `No ${WORDS.review}s match these filters` : `No ${WORDS.review}s here`}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {filtered ? 'Change or clear the filters to see more. ' : null}
            {page > 1 ? (
              <Link href={filterHref('/home', filter)} className="underline underline-offset-4">
                Back to the newest
              </Link>
            ) : null}
          </p>
        </div>
      ) : (
        <ReviewList
          reviews={reviews}
          total={total}
          showProject
          basePath="/home"
          filter={filter}
          page={page}
        />
      )}
      {comparisons.length > 0 ? (
        <section aria-labelledby="recent-comparisons" className="space-y-3 pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <h2 id="recent-comparisons" className="text-xl font-bold">
              Recent comparisons
            </h2>
            {comparisonTotal > comparisons.length ? (
              <Link href={COMPARISONS_PATH} className="text-sm underline underline-offset-4">
                All {comparisonTotal.toLocaleString('en-GB')} comparisons
              </Link>
            ) : null}
          </div>
          <ComparisonList comparisons={comparisons} total={comparisonTotal} />
        </section>
      ) : null}
    </div>
  );
}

/**
 * The latest few comparisons, or none when they cannot be read: a failure here
 * leaves the section out rather than failing the page. `loadServerData` logs a
 * failed call; a row that does not parse is logged here.
 */
async function loadRecentComparisons(): Promise<{ comparisons: ComparisonRow[]; total: number }> {
  const none = { comparisons: [], total: 0 };
  const loaded = await loadServerData<unknown>(comparisonListEndpoint(1, COMPARISON_RECENT_LIMIT));
  if (!loaded.ok) return none;
  const parsed = comparisonListSchema.safeParse(loaded.data);
  if (!parsed.success) {
    logger.warn('Recent comparisons did not parse; leaving them off /home', {
      issues: parsed.error.issues.length,
    });
    return none;
  }
  return {
    comparisons: parsed.data,
    total: parsePaginationMeta(loaded.meta)?.total ?? parsed.data.length,
  };
}

/** The framework's latest catalogue, as far as the filters read it. */
async function loadFilterCatalogue(): Promise<FilterCatalogue> {
  const framework = frameworkLatestSchema.parse(
    (await requireServerData<unknown>(frameworkEndpoint(HOWDOESTHISLAND_SLUG))).data
  );
  if (!framework.latestVersion) return NO_FILTERS;
  return filterCatalogueSchema.parse(
    (
      await requireServerData<unknown>(
        catalogueEndpoint(HOWDOESTHISLAND_SLUG, framework.latestVersion)
      )
    ).data
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { getServerSession } from '@/lib/auth/utils';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { requireServerData } from '@/lib/api/server-load';
import { parsePaginationMeta } from '@/lib/validations/common';
import { Button } from '@/components/ui/button';
import { pageFromSearch } from '@/components/app/history/schemas';
import {
  COMPARISONS_PATH,
  comparisonListEndpoint,
  comparisonListSchema,
} from '@/components/app/compare/schemas';
import { ComparisonList } from '@/components/app/compare/comparison-list';

export const metadata: Metadata = { title: 'Comparisons' };

/**
 * `/compare` — every comparison in the workspace (t-90), newest first, 20 a
 * page (`?page=`), each linking to `/compare/{id}`. `/home` shows the latest
 * few and links here for the rest.
 *
 * One call, `GET /api/v1/comparisons`: each row carries its drafts' states and
 * scores and the editor's choice, so no row reads its comparison again.
 */
export default async function ComparisonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const page = pageFromSearch(search.page);
  // Back to this page after signing in.
  const session = await getServerSession();
  if (!session)
    clearInvalidSession(page > 1 ? `${COMPARISONS_PATH}?page=${page}` : COMPARISONS_PATH);

  const loaded = await requireServerData<unknown>(comparisonListEndpoint(page));
  const comparisons = comparisonListSchema.parse(loaded.data);
  const total = parsePaginationMeta(loaded.meta)?.total ?? comparisons.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="hd-slug">Comparisons</p>
          <h1 className="text-2xl font-bold">Drafts compared</h1>
        </div>
        <Button asChild>
          <Link href="/assess">Compare drafts</Link>
        </Button>
      </div>
      {comparisons.length === 0 ? (
        <div className="rounded-md border p-8 text-center">
          <p className="font-semibold">
            {total === 0 ? 'No comparisons yet' : 'No comparisons here'}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {total === 0 ? (
              'Start one from the Compare drafts tab on Assess: paste two to five drafts, and they are reviewed the same way, side by side.'
            ) : (
              <Link href={COMPARISONS_PATH} className="underline underline-offset-4">
                Back to the newest
              </Link>
            )}
          </p>
        </div>
      ) : (
        <ComparisonList comparisons={comparisons} total={total} page={page} />
      )}
    </div>
  );
}

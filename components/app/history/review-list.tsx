'use client';

/**
 * A list of the workspace's reviews (t-79), newest first: on `/home` all of
 * them, on a project's page its own. Every row is what one
 * `GET /api/v1/assessments` call answered, its project's name included, so no
 * row fetches anything of its own.
 *
 * Deleting a review asks first, since it takes the copy and the result with
 * it, then calls `DELETE /api/v1/assessments/{id}`, drops the row and
 * refreshes the page, so the count and the next page follow.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SaveError } from '@/components/forms/form-error';
import { apiClient } from '@/lib/api/client';
import { NO_SERVER_FIELDS, useSaveFailure } from '@/lib/hooks/use-save-failure';
import { WORDS } from '@/lib/app/reports/words';
import { reportPath } from '@/components/app/workbench/schemas';
import {
  REVIEW_LIST_LIMIT,
  assessmentEndpoint,
  filterHref,
  type ReviewFilter,
  type ReviewListState,
  type ReviewRow,
} from '@/components/app/history/schemas';

const dayName = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const STATE_LABEL: Record<Exclude<ReviewListState, 'completed'>, string> = {
  queued: 'Waiting',
  running: 'Running',
  partial: 'Partly reviewed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** What a row is called: its title, else its file or page, else what it was. */
export function reviewName(row: ReviewRow): string {
  if (row.title) return row.title;
  if (row.source.fileName) return row.source.fileName;
  if (row.source.url) {
    try {
      const url = new URL(row.source.url);
      return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
    } catch {
      return row.source.url;
    }
  }
  return `Pasted copy, ${row.wordCount.toLocaleString('en-GB')} ${row.wordCount === 1 ? 'word' : 'words'}`;
}

export interface ReviewListProps {
  reviews: ReviewRow[];
  /** How many match the filter, which may be more than are shown. */
  total: number;
  /** Whether a row names its project: not on a project's own page. */
  showProject: boolean;
  /** The page it is on, its filter and its page number, for the links to the others. */
  basePath: string;
  filter: ReviewFilter;
  page: number;
}

export function ReviewList({
  reviews,
  total,
  showProject,
  basePath,
  filter,
  page,
}: ReviewListProps) {
  const router = useRouter();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const shown = reviews.filter((r) => !gone.has(r.id));

  const removed = (id: string) => {
    setGone((prev) => new Set(prev).add(id));
    router.refresh();
  };

  if (shown.length === 0) return null;

  // Until the refresh lands, count without the rows just deleted, so the
  // status line (read out by screen readers) never describes a stale list.
  const count = total - gone.size;
  const first = (page - 1) * REVIEW_LIST_LIMIT + 1;
  const hasOlder = page * REVIEW_LIST_LIMIT < total;

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm" role="status">
        {count === shown.length
          ? `${count.toLocaleString('en-GB')} ${count === 1 ? WORDS.review : `${WORDS.review}s`}`
          : `${first.toLocaleString('en-GB')}–${(first + shown.length - 1).toLocaleString('en-GB')} of ${count.toLocaleString('en-GB')} ${WORDS.review}s, newest first`}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{WORDS.Review}</TableHead>
            {showProject ? <TableHead className="hidden md:table-cell">Project</TableHead> : null}
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="hidden sm:table-cell">Made</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-[24rem]">
                <Link
                  href={reportPath(row.id)}
                  className="block truncate font-medium underline-offset-4 hover:underline"
                >
                  {reviewName(row)}
                </Link>
                {row.status === 'completed' ? null : (
                  <Badge variant="secondary" className="mt-1">
                    {STATE_LABEL[row.status]}
                  </Badge>
                )}
              </TableCell>
              {showProject ? (
                <TableCell className="hidden md:table-cell">
                  {row.project ? (
                    <Link
                      href={`/projects/${encodeURIComponent(row.project.id)}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {row.project.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </TableCell>
              ) : null}
              <TableCell className="text-right">
                {row.overall === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="tabular-nums">
                    <b>{Math.round(row.overall)}</b>
                    {row.band ? (
                      <span className="text-muted-foreground ml-2 font-mono text-xs uppercase">
                        {row.band}
                      </span>
                    ) : null}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground hidden sm:table-cell">
                {dayName.format(new Date(row.createdAt))}
              </TableCell>
              <TableCell className="text-right">
                <DeleteReview row={row} onDeleted={() => removed(row.id)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {page > 1 || hasOlder ? (
        <nav aria-label={`${WORDS.Review} pages`} className="flex gap-6 text-sm">
          {page > 1 ? (
            <Link
              href={filterHref(basePath, filter, page - 1)}
              className="underline underline-offset-4"
            >
              Newer
            </Link>
          ) : null}
          {hasOlder ? (
            <Link
              href={filterHref(basePath, filter, page + 1)}
              className="underline underline-offset-4"
            >
              Older
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function DeleteReview({ row, onDeleted }: { row: ReviewRow; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const save = useSaveFailure({
    fallback: `The ${WORDS.review} could not be deleted. Try again in a moment.`,
    fields: NO_SERVER_FIELDS,
  });
  const name = reviewName(row);

  const remove = async () => {
    save.clear();
    setBusy(true);
    try {
      await apiClient.delete<unknown>(assessmentEndpoint(row.id));
      onDeleted();
    } catch (err) {
      save.report(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            aria-label={`Delete ${name}`}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this {WORDS.review}?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{name}&rdquo;, its copy and its result are deleted, and any link shared to it
              stops working. What it cost stays on the workspace&rsquo;s usage. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SaveError failure={save.failure} />
    </div>
  );
}

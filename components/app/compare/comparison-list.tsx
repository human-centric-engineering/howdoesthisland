/**
 * A list of the workspace's comparisons (t-90), newest first: on `/compare`
 * every one, a page at a time; on `/home` the latest few. Every row is what
 * one `GET /api/v1/comparisons` call answered, its drafts' scores and the
 * editor's choice included, so no row reads its comparison again.
 *
 * A row is named by its drafts, links to `/compare/{id}`, and says which draft
 * the editor found lands better, or why there is no answer yet.
 */
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  COMPARISON_LIST_LIMIT,
  comparePath,
  comparisonsPagePath,
  draftName,
  type ComparisonRow,
} from '@/components/app/compare/schemas';

const dayName = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const STATE_LABEL: Record<Exclude<ComparisonRow['status'], 'completed'>, string> = {
  running: 'Running',
  partial: 'Partly reviewed',
  failed: 'Failed',
};

/** What a row is called: its drafts' names, in the order they were sent. */
export function comparisonName(row: Pick<ComparisonRow, 'drafts'>): string {
  return [...row.drafts]
    .sort((a, b) => a.position - b.position)
    .map(draftName)
    .join(' · ');
}

/** The editor's answer as a row shows it. */
function VerdictCell({ row }: { row: ComparisonRow }) {
  const { verdict } = row;
  const winner =
    verdict.status === 'completed'
      ? row.drafts.find((d) => d.position === verdict.draft)
      : undefined;
  if (winner) {
    return (
      <span>
        <b className="font-medium">{draftName(winner)}</b>
        {winner.overall === null ? null : (
          <span className="text-muted-foreground ml-2 tabular-nums">
            {Math.round(winner.overall)}
          </span>
        )}
      </span>
    );
  }
  const still = verdict.status === 'waiting' || verdict.status === 'running';
  return <span className="text-muted-foreground">{still ? 'Still to come' : 'No verdict'}</span>;
}

export interface ComparisonListProps {
  comparisons: ComparisonRow[];
  /** How many the workspace has, which may be more than are shown. */
  total: number;
  /**
   * The page of `/compare` it is, for the links to the others. Left out on
   * `/home`, which shows the latest few and links to the rest instead.
   */
  page?: number;
  /** Whether a row names its project. */
  showProject?: boolean;
}

export function ComparisonList({
  comparisons,
  total,
  page,
  showProject = true,
}: ComparisonListProps) {
  if (comparisons.length === 0) return null;

  const first = ((page ?? 1) - 1) * COMPARISON_LIST_LIMIT + 1;
  const hasOlder = page !== undefined && page * COMPARISON_LIST_LIMIT < total;
  const noun = total === 1 ? 'comparison' : 'comparisons';

  return (
    <div className="space-y-3">
      {/* A live region only where it is the page's own list: on /home the
          reviews' count is already one, and a second would be read after it. */}
      <p className="text-muted-foreground text-sm" role={page === undefined ? undefined : 'status'}>
        {total === comparisons.length
          ? `${total.toLocaleString('en-GB')} ${noun}`
          : page === undefined
            ? `The latest ${comparisons.length.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} ${noun}`
            : `${first.toLocaleString('en-GB')}–${(first + comparisons.length - 1).toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} ${noun}, newest first`}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Drafts compared</TableHead>
            <TableHead>Lands better</TableHead>
            {showProject ? <TableHead className="hidden md:table-cell">Project</TableHead> : null}
            <TableHead className="hidden sm:table-cell">Made</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {comparisons.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-[24rem]">
                <Link
                  href={comparePath(row.id)}
                  className="block truncate font-medium underline-offset-4 hover:underline"
                >
                  {comparisonName(row)}
                </Link>
                {row.status === 'completed' ? null : (
                  <Badge variant="secondary" className="mt-1">
                    {STATE_LABEL[row.status]}
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <VerdictCell row={row} />
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
              <TableCell className="text-muted-foreground hidden sm:table-cell">
                {dayName.format(new Date(row.createdAt))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {page !== undefined && (page > 1 || hasOlder) ? (
        <nav aria-label="Comparison pages" className="flex gap-6 text-sm">
          {page > 1 ? (
            <Link href={comparisonsPagePath(page - 1)} className="underline underline-offset-4">
              Newer
            </Link>
          ) : null}
          {hasOlder ? (
            <Link href={comparisonsPagePath(page + 1)} className="underline underline-offset-4">
              Older
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

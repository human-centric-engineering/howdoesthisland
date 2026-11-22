/**
 * The workspace's projects (t-71), newest first, as `GET /api/v1/projects`
 * answers them in one call. A server component: each row links to the
 * project's page and carries what the list already has, so no row fetches
 * anything of its own.
 */
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { WORDS } from '@/lib/app/reports/words';
import { NewProjectDialog } from '@/components/app/projects/new-project-dialog';
import type { ProjectWire } from '@/components/app/projects/schemas';

const dayName = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "1 review", "3 reviews". */
export function reviewCount(n: number): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? WORDS.review : `${WORDS.review}s`}`;
}

export interface ProjectListProps {
  projects: ProjectWire[];
  /** How many the workspace has under the same filter, which may be more than are shown. */
  total: number;
  /** Whether archived projects are listed too. */
  showArchived: boolean;
}

export function ProjectList({ projects, total, showArchived }: ProjectListProps) {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground max-w-prose">
            A project holds a client&rsquo;s, product&rsquo;s or campaign&rsquo;s brief, and the
            defaults its {WORDS.review}s take, so you write them down once.
          </p>
        </div>
        <NewProjectDialog />
      </div>

      <div className="flex items-center justify-between gap-4 text-sm">
        <p className="text-muted-foreground" role="status">
          {total === projects.length
            ? `${total.toLocaleString('en-GB')} ${total === 1 ? 'project' : 'projects'}`
            : `The newest ${projects.length} of ${total.toLocaleString('en-GB')} projects`}
          {showArchived ? ', archived ones included' : ''}
        </p>
        <Link
          href={showArchived ? '/projects' : '/projects?archived=true'}
          className="underline underline-offset-4"
        >
          {showArchived ? 'Hide archived projects' : 'Show archived projects'}
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-md border p-8 text-center">
          <p className="font-semibold">{showArchived ? 'No projects yet' : 'No projects open'}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Make one for each client, product or campaign you write for.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead className="text-right">{WORDS.Review}s</TableHead>
              <TableHead className="hidden sm:table-cell">Made</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link
                    href={`/projects/${encodeURIComponent(p.id)}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {p.name}
                  </Link>
                  {p.archived ? (
                    <Badge variant="secondary" className="ml-2">
                      Archived
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {reviewCount(p.reviewCount)}
                </TableCell>
                <TableCell className="text-muted-foreground hidden sm:table-cell">
                  {dayName.format(new Date(p.createdAt))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

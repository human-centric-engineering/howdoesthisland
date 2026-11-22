/**
 * `/projects` (t-71): the workspace's projects, newest first, with archived
 * ones behind a toggle (`?archived=true`).
 *
 * A thin shell over `GET /api/v1/projects` (API-first), in one call: the list
 * carries each project's review count, so no row fetches its own. Protected by
 * the proxy through `lib/app/protected-routes.ts`; an expired session is
 * cleared here, as `/home` does, so the person can reach the login form.
 */
import type { Metadata } from 'next';
import { getServerSession } from '@/lib/auth/utils';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { requireServerData } from '@/lib/api/server-load';
import { parsePaginationMeta } from '@/lib/validations/common';
import {
  PROJECT_LIST_LIMIT,
  PROJECTS_ENDPOINT,
  projectListSchema,
} from '@/components/app/projects/schemas';
import { ProjectList } from '@/components/app/projects/project-list';

export const metadata: Metadata = {
  title: 'Projects',
  description: 'This workspace’s projects: each one’s brief, and the defaults its reviews take',
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { archived } = await searchParams;
  const showArchived = archived === 'true';
  const returnTo = showArchived ? '/projects?archived=true' : '/projects';

  const session = await getServerSession();
  if (!session) clearInvalidSession(returnTo);

  const query = new URLSearchParams({ limit: String(PROJECT_LIST_LIMIT) });
  if (showArchived) query.set('archived', 'true');
  const loaded = await requireServerData<unknown>(`${PROJECTS_ENDPOINT}?${query.toString()}`);
  const projects = projectListSchema.parse(loaded.data);

  return (
    <ProjectList
      projects={projects}
      total={parsePaginationMeta(loaded.meta)?.total ?? projects.length}
      showArchived={showArchived}
    />
  );
}

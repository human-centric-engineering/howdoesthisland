/**
 * `/projects/[id]` (t-71): a project's brief and the defaults its reviews
 * take, written down once, and archiving it.
 *
 * Read through the API (API-first): the project, then its framework's latest
 * version, then that version's catalogue, which fills the default pickers.
 * Those are the ids the API checks a project's defaults against
 * (`lib/app/projects/service.ts`). Another workspace's id is a 404 from the
 * API, so it renders the not-found page, as an id that does not exist does.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { getServerSession } from '@/lib/auth/utils';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { requireServerData } from '@/lib/api/server-load';
import { Badge } from '@/components/ui/badge';
import { WORDS } from '@/lib/app/reports/words';
import {
  catalogueEndpoint,
  defaultsCatalogueSchema,
  frameworkEndpoint,
  frameworkLatestSchema,
  projectEndpoint,
  projectSchema,
} from '@/components/app/projects/schemas';
import { ProjectForm } from '@/components/app/projects/project-form';
import { ProjectArchive } from '@/components/app/projects/project-archive';
import { reviewCount } from '@/components/app/projects/project-list';

export const metadata: Metadata = { title: 'Project' };

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) clearInvalidSession(`/projects/${encodeURIComponent(id)}`);

  const project = projectSchema.parse(
    (await requireServerData<unknown>(projectEndpoint(id), { notFound: true })).data
  );
  const framework = frameworkLatestSchema.parse(
    (await requireServerData<unknown>(frameworkEndpoint(project.framework))).data
  );
  if (!framework.latestVersion) {
    // Every version retired: nothing to check defaults against, and the API
    // refuses a save. The error boundary says so and offers Try again.
    throw new Error(`${project.framework} has no version in use`);
  }
  const catalogue = defaultsCatalogueSchema.parse(
    (
      await requireServerData<unknown>(
        catalogueEndpoint(project.framework, framework.latestVersion)
      )
    ).data
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="hd-slug">
            <Link href="/projects" className="underline-offset-4 hover:underline">
              Projects
            </Link>
          </p>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
            {project.name}
            {project.archived ? <Badge variant="secondary">Archived</Badge> : null}
          </h1>
          <p className="text-muted-foreground">
            {reviewCount(project.reviewCount)} · scored with {framework.name}{' '}
            {framework.latestVersion}
          </p>
          {project.archived ? (
            <p className="text-muted-foreground max-w-prose text-sm">
              Archived: no new {WORDS.review}s can be made in it, and its {WORDS.review}s keep their
              link to it. You can still change its brief and defaults; restore it to review in it
              again.
            </p>
          ) : null}
        </div>
        <ProjectArchive projectId={project.id} archived={project.archived} />
      </div>

      <ProjectForm key={project.id} project={project} catalogue={catalogue} />
    </div>
  );
}

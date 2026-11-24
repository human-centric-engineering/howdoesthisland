/**
 * `/projects/[id]` (t-71): a project's brief and the defaults its reviews
 * take, written down once, its adjustment to the weights when the version
 * allows one (t-72), its background documents (t-74), archiving it, and its
 * own reviews, newest first (t-79).
 *
 * Read through the API (API-first): the project, then at once its documents,
 * its reviews and its framework's latest version, then that version's
 * catalogue, which fills the default pickers.
 * Those are the ids the API checks a project's defaults against
 * (`lib/app/projects/service.ts`). Its reviews are one call to
 * `GET /api/v1/assessments?projectId=`, a page at a time (`?page=`). Another workspace's id is a 404 from the
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
  projectDocumentListSchema,
  projectDocumentsEndpoint,
  projectEndpoint,
  projectSchema,
} from '@/components/app/projects/schemas';
import { ProjectForm } from '@/components/app/projects/project-form';
import { ProjectArchive } from '@/components/app/projects/project-archive';
import { ProjectWeights } from '@/components/app/projects/project-weights';
import { ProjectDocuments } from '@/components/app/projects/project-documents';
import { reviewCount } from '@/components/app/projects/project-list';
import {
  pageFromSearch,
  reviewListEndpoint,
  reviewListSchema,
} from '@/components/app/history/schemas';
import { ReviewList } from '@/components/app/history/review-list';
import { parsePaginationMeta } from '@/lib/validations/common';

export const metadata: Metadata = { title: 'Project' };

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const page = pageFromSearch((await searchParams).page);
  const session = await getServerSession();
  if (!session) clearInvalidSession(`/projects/${encodeURIComponent(id)}`);

  const project = projectSchema.parse(
    (await requireServerData<unknown>(projectEndpoint(id), { notFound: true })).data
  );
  // The rest needs only the project, so it loads at once; only the catalogue
  // waits, for the framework's latest version.
  const [{ framework, catalogue }, documents, loadedReviews] = await Promise.all([
    loadFrameworkAndCatalogue(project.framework),
    requireServerData<unknown>(projectDocumentsEndpoint(project.id)).then(({ data }) =>
      projectDocumentListSchema.parse(data)
    ),
    requireServerData<unknown>(reviewListEndpoint({ projectId: project.id }, page)),
  ]);
  const reviews = reviewListSchema.parse(loadedReviews.data);
  const reviewTotal = parsePaginationMeta(loadedReviews.meta)?.total ?? reviews.length;

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

      <section aria-labelledby="project-reviews-heading" className="space-y-3">
        <h2 id="project-reviews-heading" className="text-lg font-semibold">
          Its {WORDS.review}s
        </h2>
        {reviews.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {page > 1 ? (
              <>
                No {WORDS.review}s on this page.{' '}
                <Link
                  href={`/projects/${encodeURIComponent(project.id)}`}
                  className="underline underline-offset-4"
                >
                  Back to the newest
                </Link>
              </>
            ) : project.archived ? (
              `No ${WORDS.review}s in this project. Restore it to review copy in it.`
            ) : (
              `No ${WORDS.review}s in this project yet. Choose it on the assess page to review copy in it.`
            )}
          </p>
        ) : (
          <ReviewList
            reviews={reviews}
            total={reviewTotal}
            showProject={false}
            basePath={`/projects/${encodeURIComponent(project.id)}`}
            filter={{}}
            page={page}
          />
        )}
      </section>

      <ProjectForm key={project.id} project={project} catalogue={catalogue} />
      {/* Only when the version declares bounds, or the project holds an adjustment (t-72). */}
      <ProjectWeights key={`weights-${project.id}`} project={project} catalogue={catalogue} />
      <ProjectDocuments
        key={`documents-${project.id}`}
        projectId={project.id}
        documents={documents}
      />
    </div>
  );
}

/** The framework's latest version and, for it, the catalogue the default pickers read. */
async function loadFrameworkAndCatalogue(slug: string) {
  const framework = frameworkLatestSchema.parse(
    (await requireServerData<unknown>(frameworkEndpoint(slug))).data
  );
  if (!framework.latestVersion) {
    // Every version retired: nothing to check defaults against, and the API
    // refuses a save. The error boundary says so and offers Try again.
    throw new Error(`${slug} has no version in use`);
  }
  const catalogue = defaultsCatalogueSchema.parse(
    (await requireServerData<unknown>(catalogueEndpoint(slug, framework.latestVersion))).data
  );
  return { framework: { ...framework, latestVersion: framework.latestVersion }, catalogue };
}

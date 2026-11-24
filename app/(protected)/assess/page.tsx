/**
 * `/assess` (t-78, app-plan §4): start a review of pasted text, a file or a
 * page, and watch it come in.
 *
 * Read through the API (API-first), in three calls: the framework's latest
 * version, that version's catalogue (the reader settings and the AI
 * reviewers), and the workspace's live projects, whose defaults the form
 * applies. Only projects on this framework are offered: a review names one
 * framework, and the API refuses a project on another.
 */
import type { Metadata } from 'next';
import { getServerSession } from '@/lib/auth/utils';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { requireAllServerData, requireServerData } from '@/lib/api/server-load';
import { HOWDOESTHISLAND_SLUG } from '@/lib/app/frameworks/howdoesthisland/slug';
import {
  PROJECTS_ENDPOINT,
  catalogueEndpoint,
  frameworkEndpoint,
  frameworkLatestSchema,
  projectListSchema,
} from '@/components/app/projects/schemas';
import { assessCatalogueSchema } from '@/components/app/workbench/schemas';
import { AssessWorkbench } from '@/components/app/workbench/assess-workbench';

export const metadata: Metadata = {
  title: 'Assess',
  description: 'Review a piece of copy: paste it, upload it or give its address',
};

export default async function AssessPage() {
  const session = await getServerSession();
  if (!session) clearInvalidSession('/assess');

  const framework = frameworkLatestSchema.parse(
    (await requireServerData<unknown>(frameworkEndpoint(HOWDOESTHISLAND_SLUG))).data
  );
  if (!framework.latestVersion) {
    // Every version retired: nothing to review against. The error boundary
    // says so and offers Try again.
    throw new Error(`${HOWDOESTHISLAND_SLUG} has no version in use`);
  }
  const catalogue = assessCatalogueSchema.parse(
    (
      await requireServerData<unknown>(
        catalogueEndpoint(HOWDOESTHISLAND_SLUG, framework.latestVersion)
      )
    ).data
  );
  // Every page of them: a workspace past one page still sees each of its
  // projects, and a draft naming one keeps it.
  const projects = projectListSchema
    .parse(await requireAllServerData<{ id: string }>(PROJECTS_ENDPOINT))
    .filter((p) => !p.archived && p.framework === HOWDOESTHISLAND_SLUG);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">How will this land?</h1>
        <p className="max-w-prose text-(--hd-muted)">
          Paste your copy, upload it or give its address. It is scored on credibility, emotion,
          logic and timing: a quick scan at once, then the AI reviewers, each as it finishes.
        </p>
      </div>
      <AssessWorkbench
        catalogue={catalogue}
        version={framework.latestVersion}
        projects={projects}
      />
    </div>
  );
}

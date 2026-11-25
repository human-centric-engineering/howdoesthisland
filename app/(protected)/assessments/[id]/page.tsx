import type { Metadata } from 'next';
import { getServerSession } from '@/lib/auth/utils';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { apiReportSource, loadReport } from '@/lib/app/reports/load';
import { loadServerData } from '@/lib/api/server-load';
import { z } from 'zod';
import { logger } from '@/lib/logging';
import { catalogueEndpoint, projectEndpoint } from '@/components/app/projects/schemas';
import { hasBrief } from '@/components/app/projects/brief-invite';
import { assessCatalogueSchema } from '@/components/app/workbench/schemas';
import { reviewerName } from '@/components/app/workbench/assess-draft';
import { Report } from '@/components/app/report/report';
import { ReportActions } from '@/components/app/report/report-actions';
import { rewriteFocuses } from '@/components/app/report/rewrite-focuses';
import {
  ReportNoResult,
  ReportPending,
  ReportUnreadable,
} from '@/components/app/report/report-states';

export const metadata: Metadata = { title: 'Report' };

/**
 * `/assessments/[id]` — a review's report (t-29, app-plan §8.5).
 *
 * Read through the API (`lib/app/reports/load.ts`): the assessment, then the
 * model version it ran on. Another workspace's id is a 404 from the API, so it
 * renders the not-found page, the same as an id that does not exist.
 *
 * A ready report offers its PDF (t-31), and a rewrite of its copy (t-82),
 * which invites a brief when the review's project has none, or it is in no
 * project (t-83).
 * One still running shows its live progress, then the report once it is
 * final (t-78).
 */
/**
 * Only the brief, read loosely: whether any part is written is all the
 * drawer needs, so a stored brief the request schema would now refuse (a
 * part over a lowered limit, say) still counts.
 */
const briefOfProject = z.object({ brief: z.record(z.string(), z.unknown()).nullish() });

/**
 * What the rewrite drawer invites, for a review in `projectId`: a brief, when
 * the project has none or there is no project. `null` when it has one, or
 * when the project cannot be read (gone, say): there is nowhere to write one.
 */
async function briefInviteFor(
  projectId: string | null
): Promise<{ projectId: string | null } | null> {
  if (!projectId) return { projectId: null };
  const read = await loadServerData<unknown>(projectEndpoint(projectId), { expected: [404] });
  if (!read.ok) return null;
  const parsed = briefOfProject.safeParse(read.data);
  if (!parsed.success) {
    logger.warn('Report: the project did not parse for the brief invitation', {
      projectId,
      issues: parsed.error.issues.slice(0, 5),
    });
    return null;
  }
  return hasBrief(parsed.data.brief) ? null : { projectId };
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Back to this report after signing in: it is the link people are sent.
  const session = await getServerSession();
  if (!session) clearInvalidSession(`/assessments/${encodeURIComponent(id)}`);

  const load = await loadReport(id, apiReportSource);
  switch (load.kind) {
    case 'ready':
      return (
        <>
          <ReportActions
            assessmentId={id}
            focuses={rewriteFocuses(load.view.lands.appeals)}
            briefInvite={await briefInviteFor(load.projectId)}
          />
          <Report view={load.view} variant="web" />
        </>
      );
    case 'pending': {
      // Its version's catalogue names the AI reviewers and the appeals the
      // live progress shows (t-78). Only names: one that cannot be read leaves
      // the progress showing slots and appeal ids, never an error page.
      const { slug, version } = load.assessment.framework;
      const read = await loadServerData<unknown>(catalogueEndpoint(slug, version));
      const parsed = read.ok ? assessCatalogueSchema.safeParse(read.data) : null;
      const catalogue = parsed?.success ? parsed.data : null;
      return (
        <ReportPending
          assessmentId={id}
          assessment={load.assessment}
          reviewerNames={
            catalogue
              ? Object.fromEntries(
                  load.assessment.judges.map((slot) => [slot, reviewerName(catalogue, slot)])
                )
              : {}
          }
          appealNames={
            catalogue ? Object.fromEntries(catalogue.result.appeals.map((a) => [a.id, a.name])) : {}
          }
        />
      );
    }
    case 'no_result':
      return <ReportNoResult assessment={load.assessment} />;
    case 'unreadable':
      return <ReportUnreadable />;
  }
}

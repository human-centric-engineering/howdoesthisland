import type { Metadata } from 'next';
import { getServerSession } from '@/lib/auth/utils';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { apiReportSource, loadReport } from '@/lib/app/reports/load';
import { requireServerData } from '@/lib/api/server-load';
import { catalogueEndpoint } from '@/components/app/projects/schemas';
import { assessCatalogueSchema } from '@/components/app/workbench/schemas';
import { reviewerName } from '@/components/app/workbench/assess-draft';
import { Report } from '@/components/app/report/report';
import { ReportActions } from '@/components/app/report/report-actions';
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
 * A ready report offers its PDF (t-31). One still running shows its live
 * progress, then the report once it is final (t-78).
 */
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
          <ReportActions assessmentId={id} />
          <Report view={load.view} variant="web" />
        </>
      );
    case 'pending': {
      // Its version's catalogue names the AI reviewers and the appeals the
      // live progress shows (t-78).
      const { slug, version } = load.assessment.framework;
      const catalogue = assessCatalogueSchema.parse(
        (await requireServerData<unknown>(catalogueEndpoint(slug, version))).data
      );
      return (
        <ReportPending
          assessmentId={id}
          assessment={load.assessment}
          reviewerNames={Object.fromEntries(
            load.assessment.judges.map((slot) => [slot, reviewerName(catalogue, slot)])
          )}
          appealNames={Object.fromEntries(catalogue.result.appeals.map((a) => [a.id, a.name]))}
        />
      );
    }
    case 'no_result':
      return <ReportNoResult assessment={load.assessment} />;
    case 'unreadable':
      return <ReportUnreadable />;
  }
}

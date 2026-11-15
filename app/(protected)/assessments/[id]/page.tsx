import type { Metadata } from 'next';
import { getServerSession } from '@/lib/auth/utils';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { loadReport } from '@/lib/app/reports/load';
import { Report } from '@/components/app/report/report';
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
 */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session) clearInvalidSession('/home');

  const { id } = await params;
  const load = await loadReport(id);
  switch (load.kind) {
    case 'ready':
      return <Report view={load.view} variant="web" />;
    case 'pending':
      return <ReportPending assessment={load.assessment} />;
    case 'no_result':
      return <ReportNoResult assessment={load.assessment} />;
    case 'unreadable':
      return <ReportUnreadable />;
  }
}

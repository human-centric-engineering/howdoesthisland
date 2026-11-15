import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NotFoundError } from '@/lib/api/errors';
import { loadReport } from '@/lib/app/reports/load';
import { printReportSource } from '@/lib/app/reports/pdf/print-source';
import { runAsReportOrg } from '@/lib/app/reports/pdf/report-org';
import { PDF_READY_ATTRIBUTE } from '@/lib/app/reports/pdf/render';
import { RENDER_TOKEN_HEADER } from '@/lib/app/reports/pdf/render-token';
import { Report } from '@/components/app/report/report';
import { ReportUnreadable } from '@/components/app/report/report-states';

export const metadata: Metadata = {
  title: 'Report',
  robots: { index: false, follow: false },
};

/**
 * `/print/assessments/[id]`: a review's report, as the PDF renders it (t-31).
 *
 * Only the PDF route's own headless browser can open this. It sends a render
 * token (`lib/app/reports/pdf/render-token.ts`) in a header, and the page
 * enters the assessment's org from it (`runAsReportOrg`). With no token, a bad
 * one, or one for another report or workspace, the page is not found, the same
 * as an id that does not exist.
 *
 * The report is the web page's `<Report>` in its `print` variant, built by the
 * same loader from the same services the API answers from, so the PDF and the
 * page cannot drift. The ready marker tells the renderer the report, not an
 * error state, has rendered.
 */
export default async function PrintReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = (await headers()).get(RENDER_TOKEN_HEADER);

  let entered;
  try {
    entered = await runAsReportOrg(token, id, () => loadReport(id, printReportSource));
  } catch (err) {
    // Deleted after the route checked it: there is no report to print.
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  if (!entered.ok) notFound();

  const load = entered.value;
  if (load.kind === 'unreadable') return <ReportUnreadable />;
  // The route renders only a final review with a result, so anything else is
  // a race with a delete or a cancel: there is no report to print.
  if (load.kind !== 'ready') notFound();

  return (
    <div {...{ [PDF_READY_ATTRIBUTE]: '' }}>
      <Report view={load.view} variant="print" />
    </div>
  );
}

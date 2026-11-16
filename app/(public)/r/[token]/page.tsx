import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadReport, type ReportSource } from '@/lib/app/reports/load';
import { asOnTheWire } from '@/lib/app/reports/pdf/print-source';
import { readSharedReport, type SharedReport } from '@/lib/app/reports/share/service';
import { Report } from '@/components/app/report/report';
import { ReportUnreadable } from '@/components/app/report/report-states';

export const metadata: Metadata = {
  title: 'Shared report',
  // A link is a credential: never in a search index, never sent on.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/**
 * `/r/[token]`: a report opened by its share link (t-32), with no account.
 *
 * The token enters the link's workspace (`readSharedReport` →
 * `runAsShareOrg`), and the report is read from the same services the API
 * answers from, as the PDF's print page reads them. An unknown, malformed,
 * revoked or expired token, or a suspended workspace, is the not-found page,
 * all alike. Each open that shows the report counts as a view.
 *
 * The report is `<Report>` in its `shared` variant, fed only what a link
 * serves: no workspace, author, cost or source.
 */
export default async function SharedReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const read = await readSharedReport(token);
  if (!read.ok) notFound();

  const load = await loadReport(read.shareId, sharedReportSource(read.report));
  // A link is made only for a report, so anything but `ready` is a result
  // the page cannot read.
  // Spaced as the signed-in report page's layout spaces it.
  return (
    <div className="container mx-auto px-4 py-8">
      {load.kind === 'ready' ? <Report view={load.view} variant="shared" /> : <ReportUnreadable />}
    </div>
  );
}

/** The report's two answers, from what the link opened, as on the wire. */
function sharedReportSource(report: SharedReport): ReportSource {
  return {
    assessment: () => Promise.resolve(asOnTheWire(report.assessment)),
    model: () => Promise.resolve(report.model === null ? null : asOnTheWire(report.model)),
  };
}

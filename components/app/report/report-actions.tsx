import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SharePanel } from '@/components/app/report/share/share-panel';
import { RewriteDrawer } from '@/components/app/report/rewrite-drawer';
import type { RewriteFocusOption } from '@/components/app/report/rewrite-focuses';

/** The PDF's address for a review (`GET /api/v1/assessments/{id}/report.pdf`, t-31). */
export const reportPdfPath = (id: string): string =>
  `/api/v1/assessments/${encodeURIComponent(id)}/report.pdf`;

/**
 * What a reader can do with a report: rewrite its copy (t-82), download it
 * as a PDF (t-31), or share it by link (t-32).
 *
 * The PDF is a plain link, so the browser sends the session cookie and saves
 * the file itself, with no client script. Left off a printed page, which is
 * already the document. Only the web report has these: the PDF and a shared
 * link render the report alone.
 */
export function ReportActions({
  assessmentId,
  focuses,
}: {
  assessmentId: string;
  /** What a rewrite can work on (`rewriteFocuses`). */
  focuses: RewriteFocusOption[];
}) {
  return (
    <div className="mx-auto mb-4 flex max-w-5xl justify-end gap-2" data-print="hide">
      <RewriteDrawer assessmentId={assessmentId} focuses={focuses} />
      <SharePanel assessmentId={assessmentId} />
      <Button asChild variant="outline" size="sm">
        <a href={reportPdfPath(assessmentId)} download>
          <Download aria-hidden="true" />
          Download PDF
        </a>
      </Button>
    </div>
  );
}

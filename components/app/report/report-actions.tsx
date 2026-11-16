import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SharePanel } from '@/components/app/report/share/share-panel';

/** The PDF's address for a review (`GET /api/v1/assessments/{id}/report.pdf`, t-31). */
export const reportPdfPath = (id: string): string =>
  `/api/v1/assessments/${encodeURIComponent(id)}/report.pdf`;

/**
 * What a reader can do with a report: download it as a PDF (t-31), or share
 * it by link (t-32).
 *
 * The PDF is a plain link, so the browser sends the session cookie and saves
 * the file itself, with no client script. Left off a printed page, which is
 * already the document.
 */
export function ReportActions({ assessmentId }: { assessmentId: string }) {
  return (
    <div className="mx-auto mb-4 flex max-w-5xl justify-end gap-2" data-print="hide">
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

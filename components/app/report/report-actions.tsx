import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** The PDF's address for a review (`GET /api/v1/assessments/{id}/report.pdf`, t-31). */
export const reportPdfPath = (id: string): string =>
  `/api/v1/assessments/${encodeURIComponent(id)}/report.pdf`;

/**
 * What a reader can do with a report (t-31): download it as a PDF.
 *
 * A plain link, so the browser sends the session cookie and saves the file
 * itself, with no client script. Left off a printed page, which is already
 * the document.
 */
export function ReportActions({ assessmentId }: { assessmentId: string }) {
  return (
    <div className="mx-auto mb-4 flex max-w-5xl justify-end" data-print="hide">
      <Button asChild variant="outline" size="sm">
        <a href={reportPdfPath(assessmentId)} download>
          <Download aria-hidden="true" />
          Download PDF
        </a>
      </Button>
    </div>
  );
}

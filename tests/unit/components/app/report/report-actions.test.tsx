// @vitest-environment happy-dom

/**
 * The report's actions (t-31, t-32, t-82): rewrite, download the PDF, or
 * share by link.
 *
 * @see components/app/report/report-actions.tsx
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ReportActions, reportPdfPath } from '@/components/app/report/report-actions';
import { rewriteFocuses } from '@/components/app/report/rewrite-focuses';

const focuses = rewriteFocuses([{ id: 'ethos', name: 'Ethos', question: 'Do they trust it?' }]);

describe('ReportActions', () => {
  it('offers a rewrite, the PDF as a plain download link, and sharing', () => {
    render(<ReportActions assessmentId="asm 1" focuses={focuses} />);

    const pdf = screen.getByRole('link', { name: /Download PDF/ });
    expect(pdf).toHaveAttribute('href', '/api/v1/assessments/asm%201/report.pdf');
    expect(pdf).toHaveAttribute('download');
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rewrite' })).toBeInTheDocument();
  });

  it('is left off a printed page', () => {
    const { container } = render(<ReportActions assessmentId="asm_1" focuses={focuses} />);
    expect(container.firstElementChild).toHaveAttribute('data-print', 'hide');
  });

  it('builds the PDF path with the id encoded', () => {
    expect(reportPdfPath('a/b')).toBe('/api/v1/assessments/a%2Fb/report.pdf');
  });
});

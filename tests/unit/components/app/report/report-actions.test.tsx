// @vitest-environment happy-dom

/**
 * The report's actions (t-31, t-32): download the PDF, or share by link.
 *
 * @see components/app/report/report-actions.tsx
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import { ReportActions, reportPdfPath } from '@/components/app/report/report-actions';

describe('ReportActions', () => {
  it('offers the PDF as a plain download link, and sharing', () => {
    render(<ReportActions assessmentId="asm 1" />);

    const pdf = screen.getByRole('link', { name: /Download PDF/ });
    expect(pdf).toHaveAttribute('href', '/api/v1/assessments/asm%201/report.pdf');
    expect(pdf).toHaveAttribute('download');
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });

  it('is left off a printed page', () => {
    const { container } = render(<ReportActions assessmentId="asm_1" />);
    expect(container.firstElementChild).toHaveAttribute('data-print', 'hide');
  });

  it('builds the PDF path with the id encoded', () => {
    expect(reportPdfPath('a/b')).toBe('/api/v1/assessments/a%2Fb/report.pdf');
  });
});

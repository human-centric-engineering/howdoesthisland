// @vitest-environment happy-dom

/**
 * /assessments/[id] — a review's report (t-29). The page only signs the
 * reader in and picks what to render from the loader's answer; the loader and
 * the report have their own tests.
 *
 * @see app/(protected)/assessments/[id]/page.tsx
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReportLoad } from '@/lib/app/reports/load';
import { buildReportView } from '@/lib/app/reports/view';
import { reportModelSchema, reportResultSchema } from '@/lib/app/reports/input';
import { apiAssessment, modelDocument } from '@/tests/unit/lib/app/reports/fixtures';

const { getServerSession, clearInvalidSession, loadReport } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  clearInvalidSession: vi.fn((returnUrl: string) => {
    throw new Error(`NEXT_REDIRECT ${returnUrl}`);
  }),
  loadReport: vi.fn<(id: string) => Promise<ReportLoad>>(),
}));

vi.mock('@/lib/auth/utils', () => ({ getServerSession }));
vi.mock('@/lib/auth/clear-session', () => ({ clearInvalidSession }));
vi.mock('@/lib/app/reports/load', () => ({ loadReport }));

import ReportPage, { metadata } from '@/app/(protected)/assessments/[id]/page';

const params = Promise.resolve({ id: 'asm_1' });
const h1 = () => screen.getByRole('heading', { level: 1 }).textContent;

beforeEach(() => {
  getServerSession.mockReset().mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } });
  clearInvalidSession.mockClear();
  loadReport.mockReset();
});

describe('/assessments/[id]', () => {
  it('is titled Report', () => {
    expect(metadata.title).toBe('Report');
  });

  it('renders the web report for a ready load of the id in the URL', async () => {
    const a = apiAssessment();
    const view = buildReportView({
      assessment: a,
      result: reportResultSchema.parse(a.result),
      model: reportModelSchema.parse(modelDocument(true)),
    });
    loadReport.mockResolvedValue({ kind: 'ready', view });
    const { container } = render(await ReportPage({ params }));
    expect(loadReport).toHaveBeenCalledWith('asm_1');
    expect(h1()).toBe('Q3 board briefing');
    expect(container.querySelector('article')?.getAttribute('data-variant')).toBe('web');
  });

  it('renders each state the loader can answer', async () => {
    loadReport.mockResolvedValue({
      kind: 'pending',
      assessment: apiAssessment({ status: 'running', result: null }),
    });
    const pending = render(await ReportPage({ params }));
    expect(h1()).toMatch('Still reviewing');
    pending.unmount();

    loadReport.mockResolvedValue({
      kind: 'no_result',
      assessment: apiAssessment({ status: 'cancelled', result: null }),
    });
    const none = render(await ReportPage({ params }));
    expect(h1()).toMatch('This review was cancelled');
    none.unmount();

    loadReport.mockResolvedValue({ kind: 'unreadable' });
    render(await ReportPage({ params }));
    expect(screen.getByText(/logged/)).toBeInTheDocument();
  });

  it('clears a cookie whose session is gone, returning to this report after login', async () => {
    getServerSession.mockResolvedValue(null);
    await expect(ReportPage({ params })).rejects.toThrow('NEXT_REDIRECT /assessments/asm_1');
    expect(loadReport).not.toHaveBeenCalled();
  });
});

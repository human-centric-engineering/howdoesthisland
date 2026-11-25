// @vitest-environment happy-dom

/**
 * /print/assessments/[id] — the report as the PDF renders it (t-31). The page
 * reads the render token from its header, enters the review's org through
 * `runAsReportOrg` (tested on its own) and renders the print variant with the
 * ready marker the renderer waits for. Anything else is not found.
 *
 * @see app/(print)/print/assessments/[id]/page.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReportLoad } from '@/lib/app/reports/load';
import type { ReportOrgResult } from '@/lib/app/reports/pdf/report-org';
import { NotFoundError } from '@/lib/api/errors';
import { buildReportView } from '@/lib/app/reports/view';
import { reportModelSchema, reportResultSchema } from '@/lib/app/reports/input';
import { apiAssessment, modelDocument } from '@/tests/unit/lib/app/reports/fixtures';

const h = vi.hoisted(() => ({
  headers: new Headers(),
  loadReport: vi.fn<(id: string, source: unknown) => Promise<ReportLoad>>(),
  runAsReportOrg: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(h.headers)) }));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));
vi.mock('@/lib/app/reports/load', () => ({ loadReport: h.loadReport }));
vi.mock('@/lib/app/reports/pdf/report-org', () => ({ runAsReportOrg: h.runAsReportOrg }));
vi.mock('@/lib/app/reports/pdf/print-source', () => ({ printReportSource: { print: true } }));

import PrintReportPage, { metadata } from '@/app/(print)/print/assessments/[id]/page';

const params = Promise.resolve({ id: 'asm_1' });

function ready(): ReportLoad {
  const a = apiAssessment();
  return {
    kind: 'ready',
    view: buildReportView({
      assessment: a,
      result: reportResultSchema.parse(a.result),
      model: reportModelSchema.parse(modelDocument(true)),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.headers = new Headers({ 'x-report-render-token': 'the-token' });
  // Run the callback, as a successful entry would.
  h.runAsReportOrg.mockImplementation(
    async (
      _t: string,
      _id: string,
      fn: () => Promise<unknown>
    ): Promise<ReportOrgResult<unknown>> => ({
      ok: true,
      value: await fn(),
    })
  );
});

describe('/print/assessments/[id]', () => {
  it('is kept out of search engines', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('renders the print variant, marked ready, from the print source in the token’s org', async () => {
    h.loadReport.mockResolvedValue(ready());
    const { container } = render(await PrintReportPage({ params }));

    expect(h.runAsReportOrg).toHaveBeenCalledWith('the-token', 'asm_1', expect.any(Function));
    expect(h.loadReport).toHaveBeenCalledWith('asm_1', { print: true });
    expect(container.querySelector('[data-pdf-ready] article')?.getAttribute('data-variant')).toBe(
      'print'
    );
  });

  it('offers no rewrite: the drawer is the web report’s alone (t-82)', async () => {
    h.loadReport.mockResolvedValue(ready());
    const { queryByRole } = render(await PrintReportPage({ params }));
    expect(queryByRole('button', { name: 'Rewrite' })).toBeNull();
  });

  it('is not found when the token is refused', async () => {
    h.runAsReportOrg.mockResolvedValue({ ok: false, refused: 'token', reason: 'expired' });
    await expect(PrintReportPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(h.loadReport).not.toHaveBeenCalled();
  });

  it('passes no token on when the header is missing', async () => {
    h.headers = new Headers();
    h.runAsReportOrg.mockResolvedValue({ ok: false, refused: 'token', reason: 'malformed' });
    await expect(PrintReportPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(h.runAsReportOrg).toHaveBeenCalledWith(null, 'asm_1', expect.any(Function));
  });

  it('is not found when the review was deleted after the route checked it', async () => {
    h.loadReport.mockRejectedValue(new NotFoundError('Assessment not found'));
    await expect(PrintReportPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('is not found when there is no report to print', async () => {
    h.loadReport.mockResolvedValue({
      kind: 'no_result',
      assessment: apiAssessment({ status: 'cancelled', result: null }),
    });
    await expect(PrintReportPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders an unreadable report without the ready marker, so no PDF is made of it', async () => {
    h.loadReport.mockResolvedValue({ kind: 'unreadable' });
    const { container } = render(await PrintReportPage({ params }));
    expect(container.querySelector('[data-pdf-ready]')).toBeNull();
    // Marked, so the renderer answers it as unreadable rather than retryable.
    expect(container.querySelector('[data-pdf-unreadable]')).not.toBeNull();
  });

  it('lets any other failure through', async () => {
    h.loadReport.mockRejectedValue(new Error('database down'));
    await expect(PrintReportPage({ params })).rejects.toThrow('database down');
  });
});

// @vitest-environment happy-dom

/**
 * /assessments/[id] — a review's report (t-29). The page only signs the
 * reader in and picks what to render from the loader's answer; the loader and
 * the report have their own tests.
 *
 * @see app/(protected)/assessments/[id]/page.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReportLoad } from '@/lib/app/reports/load';
import { buildReportView } from '@/lib/app/reports/view';
import { reportModelSchema, reportResultSchema } from '@/lib/app/reports/input';
import { apiAssessment, modelDocument } from '@/tests/unit/lib/app/reports/fixtures';
import { anAssessCatalogue } from '@/tests/unit/components/app/workbench/fixtures';
import { FakeEventSource } from '@/tests/unit/components/app/workbench/fake-event-source';

const { getServerSession, clearInvalidSession, loadReport } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  clearInvalidSession: vi.fn((returnUrl: string) => {
    throw new Error(`NEXT_REDIRECT ${returnUrl}`);
  }),
  loadReport: vi.fn<(id: string) => Promise<ReportLoad>>(),
}));

vi.mock('@/lib/auth/utils', () => ({ getServerSession }));
vi.mock('@/lib/auth/clear-session', () => ({ clearInvalidSession }));
const apiReportSource = vi.hoisted(() => ({ assessment: vi.fn(), model: vi.fn() }));
vi.mock('@/lib/app/reports/load', () => ({ loadReport, apiReportSource }));
// A review still running reads its version's catalogue, to name its AI reviewers (t-78).
const loadServerData = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/server-load', () => ({ loadServerData }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import ReportPage, { metadata } from '@/app/(protected)/assessments/[id]/page';

const params = Promise.resolve({ id: 'asm_1' });
const h1 = () => screen.getByRole('heading', { level: 1 }).textContent;

beforeEach(() => {
  getServerSession.mockReset().mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } });
  clearInvalidSession.mockClear();
  loadReport.mockReset();
  loadServerData
    .mockReset()
    .mockResolvedValue({ ok: true, data: anAssessCatalogue(), meta: undefined });
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    loadReport.mockResolvedValue({ kind: 'ready', view, projectId: null });
    const { container } = render(await ReportPage({ params }));
    // Read through the API, as the signed-in reader.
    expect(loadReport).toHaveBeenCalledWith('asm_1', apiReportSource);
    expect(h1()).toBe('Q3 board briefing');
    expect(container.querySelector('article')?.getAttribute('data-variant')).toBe('web');
  });

  it('offers the PDF of a ready report, as a download kept off the printed page (t-31)', async () => {
    const a = apiAssessment();
    const view = buildReportView({
      assessment: a,
      result: reportResultSchema.parse(a.result),
      model: reportModelSchema.parse(modelDocument(true)),
    });
    loadReport.mockResolvedValue({ kind: 'ready', view, projectId: null });
    render(await ReportPage({ params }));
    const link = screen.getByRole('link', { name: 'Download PDF' });
    expect(link.getAttribute('href')).toBe('/api/v1/assessments/asm_1/report.pdf');
    expect(link.hasAttribute('download')).toBe(true);
    expect(link.closest('[data-print="hide"]')).not.toBeNull();
  });

  it('offers a rewrite of a ready report, with balanced and each appeal it scored (t-82)', async () => {
    const a = apiAssessment();
    const view = buildReportView({
      assessment: a,
      result: reportResultSchema.parse(a.result),
      model: reportModelSchema.parse(modelDocument(true)),
    });
    loadReport.mockResolvedValue({ kind: 'ready', view, projectId: null });
    render(await ReportPage({ params }));
    const rewrite = screen.getByRole('button', { name: 'Rewrite' });
    expect(rewrite.closest('[data-print="hide"]')).not.toBeNull();
    fireEvent.click(rewrite);
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual([
      'balanced',
      ...view.lands.appeals.map((x) => x.id),
    ]);
  });

  it('offers no PDF while there is no report', async () => {
    loadReport.mockResolvedValue({
      kind: 'pending',
      assessment: apiAssessment({ status: 'running', result: null }),
    });
    render(await ReportPage({ params }));
    expect(screen.queryByRole('link', { name: 'Download PDF' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rewrite' })).toBeNull();
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

  it('shows a running review live, naming its AI reviewers from its own version’s catalogue (t-78)', async () => {
    const assessment = apiAssessment({ status: 'running', result: null });
    loadReport.mockResolvedValue({ kind: 'pending', assessment });
    render(await ReportPage({ params }));

    const { slug, version } = assessment.framework;
    expect(loadServerData).toHaveBeenCalledWith(
      `/api/v1/frameworks/${slug}/versions/${version}/catalogue`
    );
    expect(FakeEventSource.latest().url).toBe('/api/v1/assessments/asm_1/events');
    expect(screen.queryByText(/Reload the page/)).toBeNull();
    // The fixture runs every judge; judge_ethos covers the Ethos appeal.
    expect(assessment.judges).toContain('judge_ethos');
    expect(screen.getByText('Ethos', { selector: 'li span' })).toBeInTheDocument();
  });

  it('still shows a running review live when its catalogue cannot be read, naming each AI reviewer by its slot', async () => {
    loadServerData.mockResolvedValue({
      ok: false,
      failure: { kind: 'failed', status: 503, code: null },
    });
    const assessment = apiAssessment({ status: 'running', result: null });
    loadReport.mockResolvedValue({ kind: 'pending', assessment });
    render(await ReportPage({ params }));

    expect(h1()).toMatch('Still reviewing');
    expect(FakeEventSource.latest().url).toBe('/api/v1/assessments/asm_1/events');
    expect(screen.getByText('judge_ethos', { selector: 'li span' })).toBeInTheDocument();
  });

  it('reads no catalogue for a report that is ready', async () => {
    const a = apiAssessment();
    const view = buildReportView({
      assessment: a,
      result: reportResultSchema.parse(a.result),
      model: reportModelSchema.parse(modelDocument(true)),
    });
    loadReport.mockResolvedValue({ kind: 'ready', view, projectId: null });
    render(await ReportPage({ params }));
    expect(loadServerData).not.toHaveBeenCalled();
  });

  describe('the rewrite drawer’s invitation to write a brief (t-83)', () => {
    const readyLoad = (projectId: string | null): ReportLoad => {
      const a = apiAssessment();
      const view = buildReportView({
        assessment: a,
        result: reportResultSchema.parse(a.result),
        model: reportModelSchema.parse(modelDocument(true)),
      });
      return { kind: 'ready', view, projectId };
    };
    const project = (brief: Record<string, string>) => ({
      id: 'prj_1',
      name: 'Spring launch',
      brief,
      defaults: {},
      framework: 'howdoesthisland',
      overlay: null,
      archived: false,
      archivedAt: null,
      reviewCount: 1,
      createdAt: '2026-11-20T10:00:00.000Z',
      updatedAt: '2026-11-21T10:00:00.000Z',
    });
    const openDrawer = () => fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
    const invite = () => screen.queryByRole('complementary', { name: 'Add a brief' });

    it('invites a brief for a review in no project, reading no project', async () => {
      loadReport.mockResolvedValue(readyLoad(null));
      render(await ReportPage({ params }));
      openDrawer();
      expect(
        within(invite() as HTMLElement).getByRole('link', { name: 'Make a project with a brief' })
      ).toHaveAttribute('href', '/projects');
      expect(loadServerData).not.toHaveBeenCalled();
    });

    it('reads the project, and invites a brief when it has none', async () => {
      loadReport.mockResolvedValue(readyLoad('prj_1'));
      loadServerData.mockResolvedValue({ ok: true, data: project({}), meta: undefined });
      render(await ReportPage({ params }));
      openDrawer();
      expect(loadServerData).toHaveBeenCalledWith('/api/v1/projects/prj_1', { expected: [404] });
      expect(
        within(invite() as HTMLElement).getByRole('link', { name: 'Write the project’s brief' })
      ).toHaveAttribute('href', '/projects/prj_1');
    });

    it('treats a project whose brief is only blank as having none', async () => {
      loadReport.mockResolvedValue(readyLoad('prj_1'));
      loadServerData.mockResolvedValue({
        ok: true,
        data: project({ offer: '   ' }),
        meta: undefined,
      });
      render(await ReportPage({ params }));
      openDrawer();
      expect(invite()).not.toBeNull();
    });

    it('offers no invitation when the project has a brief', async () => {
      loadReport.mockResolvedValue(readyLoad('prj_1'));
      loadServerData.mockResolvedValue({
        ok: true,
        data: project({ offer: 'Bookkeeping for sole traders' }),
        meta: undefined,
      });
      render(await ReportPage({ params }));
      openDrawer();
      expect(screen.getByRole('button', { name: 'Write a rewrite' })).toBeInTheDocument();
      expect(invite()).toBeNull();
    });

    it('offers none when the project cannot be read, as there is nowhere to write one', async () => {
      loadReport.mockResolvedValue(readyLoad('prj_1'));
      loadServerData.mockResolvedValue({
        ok: false,
        failure: { kind: 'failed', status: 404, code: null },
      });
      render(await ReportPage({ params }));
      openDrawer();
      expect(screen.getByRole('button', { name: 'Write a rewrite' })).toBeInTheDocument();
      expect(invite()).toBeNull();
    });

    it('offers none when the project’s answer cannot be parsed', async () => {
      loadReport.mockResolvedValue(readyLoad('prj_1'));
      loadServerData.mockResolvedValue({
        ok: true,
        data: { brief: 'not a brief' },
        meta: undefined,
      });
      render(await ReportPage({ params }));
      openDrawer();
      expect(screen.getByRole('button', { name: 'Write a rewrite' })).toBeInTheDocument();
      expect(invite()).toBeNull();
    });
  });

  it('clears a cookie whose session is gone, returning to this report after login', async () => {
    getServerSession.mockResolvedValue(null);
    await expect(ReportPage({ params })).rejects.toThrow('NEXT_REDIRECT /assessments/asm_1');
    expect(loadReport).not.toHaveBeenCalled();
  });
});

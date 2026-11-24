// @vitest-environment happy-dom

/**
 * Tests: the report component and its states (t-29), rendered from views the
 * real engine's results build.
 *
 * @see components/app/report/report.tsx
 * @see components/app/report/marked-up-copy.tsx
 * @see components/app/report/report-states.tsx
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Report } from '@/components/app/report/report';
import {
  ReportNoResult,
  ReportPending,
  ReportUnreadable,
} from '@/components/app/report/report-states';
import {
  reportModelSchema,
  reportResultSchema,
  type ReportAssessment,
} from '@/lib/app/reports/input';
import { buildReportView } from '@/lib/app/reports/view';
import {
  apiAssessment,
  degraded,
  emptySections,
  engineResult,
  modelDocument,
} from '@/tests/unit/lib/app/reports/fixtures';

function viewOf(a: ReportAssessment, culture = true) {
  return buildReportView({
    assessment: a,
    result: reportResultSchema.parse(a.result),
    model: reportModelSchema.parse(modelDocument(culture)),
  });
}

const headings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

describe('Report — the context used (t-75)', () => {
  const used = (brief: boolean, titles: string[]) => ({
    brief: brief ? { offer: 'Bicycles' } : null,
    documents: titles.map((title, i) => ({ id: `doc-${i}`, title })),
    passages: titles.map((_, i) => ({ documentId: `doc-${i}`, chunkId: `c-${i}`, text: 'P.' })),
  });

  it('lists the brief and documents the reviewers read, before the method', () => {
    render(
      <Report
        view={viewOf(apiAssessment({ contextUsed: used(true, ['Brand guide', 'Old campaign']) }))}
        variant="web"
      />
    );
    expect(headings().slice(-2)).toEqual(['Context used', 'Method and limitations']);
    const section = screen.getByRole('region', { name: /Context used/ });
    expect(section).toHaveTextContent(
      'The AI reviewers read the project’s brief, and passages from these background documents, as background, not as instructions.'
    );
    expect(
      within(section)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual(['Brand guide', 'Old campaign']);
  });

  it('says so for a brief alone, and for one document alone', () => {
    const { unmount } = render(
      <Report view={viewOf(apiAssessment({ contextUsed: used(true, []) }))} variant="web" />
    );
    expect(screen.getByText(/read the project’s brief as background/)).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: /Context used/ })).queryByRole('listitem')
    ).toBeNull();
    unmount();
    render(
      <Report
        view={viewOf(apiAssessment({ contextUsed: used(false, ['Brand guide']) }))}
        variant="web"
      />
    );
    expect(screen.getByText(/read passages from this background document as/)).toBeInTheDocument();
  });

  it('has no such section outside a project', () => {
    render(<Report view={viewOf(apiAssessment())} variant="web" />);
    expect(headings()).not.toContain('Context used');
  });
});

describe('Report — a full review', () => {
  it('renders every §8.5 section in order', () => {
    render(<Report view={viewOf(apiAssessment())} variant="web" />);
    expect(headings()).toEqual([
      'Verdict',
      'How it lands',
      'The copy, marked up',
      'Recommendations',
      'Red flags',
      'Dimensions',
      'Duties and lenses',
      'Influence perspectives',
      'Craft metrics',
      'Culture',
      'Method and limitations',
    ]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Q3 board briefing');
    expect(screen.getByText('Type of copy')).toBeInTheDocument();
    expect(screen.getByText('Cover letter')).toBeInTheDocument();
  });

  it('marks notes in the copy and links each to its note and dimension', () => {
    const { container } = render(<Report view={viewOf(apiAssessment())} variant="web" />);
    const marks = container.querySelectorAll('[data-testid="copy"] mark');
    expect(marks.length).toBeGreaterThan(0);
    const firstLink = within(screen.getByTestId('copy')).getAllByRole('link')[0];
    const target = firstLink.getAttribute('href')?.slice(1) ?? '';
    const note = container.querySelector(`#${target}`);
    expect(note).not.toBeNull();
    const dimHref = note?.querySelector('a[href^="#dim-"]')?.getAttribute('href') ?? '';
    expect(container.querySelector(dimHref)).not.toBeNull();
  });

  it("shows the run's cost on the web, and not in print or shared", () => {
    const view = viewOf(apiAssessment());
    const { rerender } = render(<Report view={view} variant="web" />);
    // Marked so the print stylesheet drops it if the web page itself is printed.
    expect(screen.getByText('Cost of this review: $0.1234.')).toHaveAttribute('data-print', 'hide');
    rerender(<Report view={view} variant="print" />);
    expect(screen.queryByText(/Cost of this review/)).not.toBeInTheDocument();
    rerender(<Report view={view} variant="shared" />);
    expect(screen.queryByText(/Cost of this review/)).not.toBeInTheDocument();
  });

  it('shows no cost line, rather than $0, when the input carried no cost (t-32)', () => {
    const view = viewOf(apiAssessment());
    render(<Report view={{ ...view, method: { ...view.method, costUsd: null } }} variant="web" />);
    expect(screen.queryByText(/Cost of this review/)).not.toBeInTheDocument();
  });
});

describe('Report — sections a result lacks are left out', () => {
  it('a quick scan has no verdict paragraph or AI reviewer list', () => {
    const a = apiAssessment({
      judges: [],
      judgeRuns: [],
      profile: 'quick',
      result: engineResult({ judges: [] }),
    });
    render(<Report view={viewOf(a)} variant="web" />);
    expect(screen.getByText(/A quick scan: the model/)).toBeInTheDocument();
    expect(screen.queryByText('The changes that matter most')).not.toBeInTheDocument();
  });

  it('no culture section with the switch off', () => {
    const a = apiAssessment({ result: engineResult({ culture: false }) });
    render(<Report view={viewOf(a, false)} variant="web" />);
    expect(headings()).not.toContain('Culture');
  });

  it('no marked-up copy when there are no notes', () => {
    const view = viewOf(apiAssessment());
    render(<Report view={{ ...view, copy: { segments: [], notes: [] } }} variant="web" />);
    expect(headings()).not.toContain('The copy, marked up');
  });

  it('a partial review says which reviewers fell back', () => {
    const base = apiAssessment();
    const a = {
      ...base,
      status: 'partial' as const,
      judgeRuns: base.judgeRuns.map((r) =>
        r.judge === 'judge_logos' ? { ...r, status: 'failed' as const, model: null } : r
      ),
    };
    render(<Report view={viewOf(a)} variant="web" />);
    expect(screen.getByText(/This review is partial: Logos fell back/)).toBeInTheDocument();
  });
});

describe('Report — names and fields the model or result lacks', () => {
  it('falls back to ids and placeholders, never printing undefined', () => {
    const view = buildReportView(degraded());
    const { container } = render(<Report view={view} variant="web" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Untitled copy');
    expect(screen.getByText(/model not recorded/)).toBeInTheDocument();
    expect(screen.getByText(/did not run; its dimensions use the quick scan/)).toBeInTheDocument();
    // Once in the perspective scores chart, once on its card.
    expect(screen.getAllByText(/persp_unknown/)).toHaveLength(2);
    expect(screen.getByText(/Duties · mostly/).textContent).not.toMatch(/fit/);
    expect(container.textContent).not.toMatch(/written from/);
    expect(container.textContent).not.toMatch(/undefined|null|NaN/);
  });

  it("names a note's dimension without a link when the report does not show it", () => {
    const d = degraded();
    const view = buildReportView({ ...d, result: { ...d.result, dimensions: [], lenses: {} } });
    const { container } = render(<Report view={view} variant="web" />);
    const notes = within(screen.getByRole('list', { name: 'Notes' }));
    expect(notes.getAllByRole('listitem').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[aria-label="Notes"] a[href^="#dim-"]')).toHaveLength(0);
  });

  it('leaves out every list section that has nothing in it', () => {
    render(<Report view={buildReportView(emptySections())} variant="web" />);
    expect(headings()).toEqual([
      'Verdict',
      'How it lands',
      'Craft metrics',
      'Culture',
      'Method and limitations',
    ]);
  });
});

describe('report states', () => {
  it('pending asks for a reload', () => {
    render(<ReportPending assessment={apiAssessment({ status: 'running', result: null })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Still reviewing');
  });

  it('a failed run shows its error; a cancelled one does not', () => {
    const { rerender } = render(
      <ReportNoResult
        assessment={apiAssessment({ status: 'failed', result: null, error: 'Boom.' })}
      />
    );
    expect(screen.getByText('Boom.')).toBeInTheDocument();
    rerender(
      <ReportNoResult
        assessment={apiAssessment({ status: 'cancelled', result: null, error: 'x' })}
      />
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'This review was cancelled'
    );
    expect(screen.queryByText('x')).not.toBeInTheDocument();
  });

  it('a review refused by the budget as it was claimed says so, with its message and the usage page', () => {
    const message = 'This review would cost about $1.00, more than the $0.50 left.';
    render(
      <ReportNoResult
        assessment={apiAssessment({
          status: 'failed',
          result: null,
          error: message,
          errorCode: 'BUDGET_EXCEEDED',
        })}
      />
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'This review was not started'
    );
    expect(screen.getByText(/monthly AI budget/)).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /usage/ })).toHaveAttribute('href', '/usage');
    expect(screen.queryByText(/Run the review again/)).not.toBeInTheDocument();
  });

  it('a review refused for credits as it was claimed names the credits, with its message (t-58)', () => {
    const message = 'This review would cost about 100 CopyCredits, more than the 40 left.';
    render(
      <ReportNoResult
        assessment={apiAssessment({
          status: 'failed',
          result: null,
          error: message,
          errorCode: 'INSUFFICIENT_CREDITS',
        })}
      />
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'This review was not started'
    );
    expect(screen.getByText(/CopyCredits no longer covered it/)).toBeInTheDocument();
    expect(screen.queryByText(/monthly AI budget/)).not.toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /usage/ })).toHaveAttribute('href', '/usage');
  });

  it('a review whose project context the embedding setup stopped says an admin must fix it (t-75)', () => {
    render(
      <ReportNoResult
        assessment={apiAssessment({
          status: 'failed',
          result: null,
          error: 'The project’s background documents cannot be searched.',
          errorCode: 'PROJECT_CONTEXT_NOT_SET_UP',
        })}
      />
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'This review was not started'
    );
    expect(screen.getByText(/until an admin fixes/)).toBeInTheDocument();
    expect(screen.queryByText(/Run the review again/)).not.toBeInTheDocument();
  });

  it('unreadable says it was logged', () => {
    render(<ReportUnreadable />);
    expect(screen.getByText(/logged/)).toBeInTheDocument();
  });
});

describe('Report — round 2 review', () => {
  it('says so in Method when the editor failed', () => {
    const a = apiAssessment();
    const result = reportResultSchema.parse(a.result);
    const view = buildReportView({
      assessment: a,
      result: {
        ...result,
        editor: { status: 'failed', errorCode: 'timeout', model: 'gpt-editor' },
      },
      model: reportModelSchema.parse(modelDocument(true)),
    });
    render(<Report view={view} variant="web" />);
    expect(screen.getByText(/The editor did not answer/)).toBeInTheDocument();
    expect(screen.queryByText(/The verdict was written by the editor/)).not.toBeInTheDocument();
  });

  it("shows the judges' paragraphs, a lever's quote and a note from the quick scan", () => {
    const view = viewOf(apiAssessment());
    const [note, ...notes] = view.copy.notes;
    const [p, ...ps] = view.perspectives.length
      ? view.perspectives
      : [{ id: 'p', name: 'P', question: '', score: 2, summary: '', levers: [] }];
    render(
      <Report
        view={{
          ...view,
          summaries: { lenses: 'Lenses para.', influence: 'Influence para.' },
          copy: { ...view.copy, notes: [{ ...note, fromQuickScan: true }, ...notes] },
          perspectives: [
            {
              ...p,
              levers: [
                { id: 'l', name: 'Lever', status: 'present', quote: 'Lever quote.', note: null },
              ],
            },
            ...ps,
          ],
        }}
        variant="web"
      />
    );
    expect(screen.getByText('Lenses para.')).toBeInTheDocument();
    expect(screen.getByText('Influence para.')).toBeInTheDocument();
    expect(screen.getByText(/Lever quote\./)).toBeInTheDocument();
    expect(document.getElementById(`note-${note.number}`)).toHaveTextContent('quick scan');
  });

  it('a cancelled review does not claim no reviewer answered', () => {
    render(<ReportNoResult assessment={apiAssessment({ status: 'cancelled', result: null })} />);
    expect(
      screen.getByText('It was cancelled before it finished, so there is no report.')
    ).toBeInTheDocument();
  });
});

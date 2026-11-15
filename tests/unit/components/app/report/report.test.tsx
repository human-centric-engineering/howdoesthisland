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
    expect(screen.getByText('Cost of this review: $0.1234.')).toBeInTheDocument();
    rerender(<Report view={view} variant="print" />);
    expect(screen.queryByText(/Cost of this review/)).not.toBeInTheDocument();
    rerender(<Report view={view} variant="shared" />);
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
        r.judge === 'logos' ? { ...r, status: 'failed' as const, model: null } : r
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
    expect(screen.getByText(/persp_unknown/)).toBeInTheDocument();
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

  it('unreadable says it was logged', () => {
    render(<ReportUnreadable />);
    expect(screen.getByText(/logged/)).toBeInTheDocument();
  });
});

// @vitest-environment happy-dom

/**
 * Tests: the report's charts (t-30). Each chart's values are its visible
 * text, and its SVG is hidden from assistive technology; each is also
 * rendered with a missing dimension, the way a real result can arrive.
 *
 * @see components/app/report/charts/
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { poleName, ScalePositions } from '@/components/app/report/charts/scale-positions';
import { ScoreBars } from '@/components/app/report/charts/score-bars';
import { ShareVsTarget } from '@/components/app/report/charts/share-vs-target';
import { percentOf } from '@/components/app/report/charts/marks';
import { Report } from '@/components/app/report/report';
import { reportModelSchema, reportResultSchema } from '@/lib/app/reports/input';
import { sharesOf } from '@/lib/app/reports/shares';
import { buildReportView } from '@/lib/app/reports/view';
import { apiAssessment, modelDocument } from '@/tests/unit/lib/app/reports/fixtures';

const rowsOf = (testId: string) => within(screen.getByTestId(testId)).getAllByRole('listitem');
const marks = (el: Element, mark: string) => el.querySelectorAll(`[data-mark="${mark}"]`);

describe('sharesOf', () => {
  it('splits into whole percentages that add to exactly 100', () => {
    const shares = sharesOf([1, 1, 1]);
    expect(shares).toEqual([34, 33, 33]);
    expect(sharesOf([62, 48, 71, 30]).reduce((t, v) => t + v, 0)).toBe(100);
  });

  it('shares nothing when every value is zero, and ignores a value that is not a number', () => {
    expect(sharesOf([0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
    expect(sharesOf([NaN, 50, -5, 50])).toEqual([0, 50, 0, 50]);
  });

  it('holds a percentage to the track', () => {
    expect(percentOf(150, 100)).toBe(100);
    expect(percentOf(-1, 100)).toBe(0);
    expect(percentOf(2, 0)).toBe(0);
    expect(percentOf(1, 4)).toBe(25);
  });
});

describe('ScoreBars', () => {
  it('prints each score beside a bar of that length, and hides the SVG', () => {
    render(
      <ScoreBars
        title="Appeal scores"
        max={100}
        testId="c"
        rows={[
          { id: 'ethos', label: 'Ethos', sublabel: 'Do they trust you?', score: 72 },
          { id: 'logos', label: 'Logos', score: 40 },
        ]}
      />
    );
    expect(screen.getByRole('figure', { name: 'Appeal scores' })).toBeInTheDocument();
    const [ethos, logos] = rowsOf('c');
    expect(ethos).toHaveTextContent('EthosDo they trust you?72');
    expect(logos).toHaveTextContent('Logos40');
    expect(marks(ethos, 'score')[0]).toHaveAttribute('width', '72%');
    expect(marks(logos, 'score')[0]).toHaveAttribute('width', '40%');
    for (const svg of screen.getByTestId('c').querySelectorAll('svg')) {
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('scales to its own maximum and prints the unit', () => {
    render(
      <ScoreBars
        title="P"
        max={4}
        unit="/4"
        testId="c"
        rows={[{ id: 'a', label: 'A', score: 3 }]}
      />
    );
    const [row] = rowsOf('c');
    expect(row).toHaveTextContent('3/4');
    expect(marks(row, 'score')[0]).toHaveAttribute('width', '75%');
  });

  it('keeps an unscored row in place with no bar', () => {
    render(
      <ScoreBars
        title="P"
        max={4}
        unit="/4"
        testId="c"
        rows={[
          { id: 'a', label: 'A', score: 2 },
          { id: 'b', label: 'B', score: null },
        ]}
      />
    );
    const [, b] = rowsOf('c');
    expect(b).toHaveTextContent('BNot scored');
    expect(marks(b, 'score')).toHaveLength(0);
  });

  it('draws nothing for no rows', () => {
    const { container } = render(<ScoreBars title="P" max={4} rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ShareVsTarget', () => {
  it('prints the share and the target, with a bar and a target line on one scale', () => {
    render(
      <ShareVsTarget
        title="Balance"
        testId="c"
        rows={[
          { id: 'ethos', label: 'Ethos', share: 30, target: 40 },
          { id: 'logos', label: 'Logos', share: 20, target: 10 },
        ]}
      />
    );
    const [ethos, logos] = rowsOf('c');
    expect(ethos).toHaveTextContent('Ethosthis copy 30%target 40%');
    expect(logos).toHaveTextContent('Logosthis copy 20%target 10%');
    // The scale is always the whole, 0–100%, never stretched to the largest part.
    expect(marks(ethos, 'share')[0]).toHaveAttribute('width', '30%');
    expect(marks(ethos, 'target')[0].querySelector('line')).toHaveAttribute('x1', '40%');
    expect(marks(logos, 'target')[0].querySelector('line')).toHaveAttribute('x1', '10%');
    expect(screen.getByText('Target')).toBeInTheDocument();
  });

  it('a part with no target has no line and says so; with none at all there is no key', () => {
    render(
      <ShareVsTarget
        title="Duties"
        testId="c"
        rows={[
          { id: 'a', label: 'Inform', share: 60, target: null },
          { id: 'b', label: 'Persuade', share: 40, target: null },
        ]}
      />
    );
    const [a] = rowsOf('c');
    expect(a).toHaveTextContent('Informthis copy 60%no target');
    expect(marks(a, 'target')).toHaveLength(0);
    expect(screen.queryByText('Target')).not.toBeInTheDocument();
  });

  it('a zero share draws no bar and nothing reads NaN', () => {
    const { container } = render(
      <ShareVsTarget
        title="Balance"
        testId="c"
        rows={[{ id: 'a', label: 'A', share: 0, target: 0 }]}
      />
    );
    const [a] = rowsOf('c');
    expect(marks(a, 'share')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/NaN|undefined/);
  });
});

describe('ScalePositions', () => {
  const scale = {
    id: 'directness',
    name: 'Directness',
    low: 'Indirect',
    high: 'Direct',
    position: 0.62,
    target: 0.4,
  };

  it('places the copy and the reader on the scale, and prints both', () => {
    render(<ScalePositions rows={[scale]} />);
    expect(screen.getByRole('figure', { name: /Culture scales/ })).toBeInTheDocument();
    const [row] = rowsOf('chart-culture');
    expect(row).toHaveTextContent('DirectnessIndirect ↔ Directthe copy 62reader 40');
    expect(marks(row, 'copy')[0]).toHaveAttribute('cx', '62%');
    expect(marks(row, 'reader')[0]).toHaveAttribute('cx', '40%');
    const gap = marks(row, 'gap')[0];
    expect(gap).toHaveAttribute('x1', '40%');
    expect(gap).toHaveAttribute('x2', '62%');
  });

  it('holds a position outside 0–1 to the scale', () => {
    render(<ScalePositions rows={[{ ...scale, position: 1.4, target: -0.2 }]} />);
    const [row] = rowsOf('chart-culture');
    expect(marks(row, 'copy')[0]).toHaveAttribute('cx', '100%');
    expect(marks(row, 'reader')[0]).toHaveAttribute('cx', '0%');
  });

  it("labels the line's ends with the poles' names, and none for a pole without one", () => {
    render(
      <ScalePositions
        rows={[
          { ...scale, low: 'Indirect: soften the ask.', high: 'Direct: state it.' },
          { ...scale, id: 'b', low: 'no name here', high: 'none either' },
        ]}
      />
    );
    const [named, unnamed] = rowsOf('chart-culture');
    expect(within(named).getByText('Indirect')).toBeInTheDocument();
    expect(within(named).getByText('Direct')).toBeInTheDocument();
    expect(within(unnamed).queryByText('no name here')).not.toBeInTheDocument();
    expect(poleName('Applications-first: lead with the conclusion')).toBe('Applications-first');
    expect(poleName('A very long sentence with no colon until much later on: here')).toBeNull();
  });

  it('draws nothing when no scale was measured', () => {
    const { container } = render(<ScalePositions rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the charts in the report', () => {
  const view = () => {
    const a = apiAssessment();
    return buildReportView({
      assessment: a,
      result: reportResultSchema.parse(a.result),
      model: reportModelSchema.parse(modelDocument(true)),
    });
  };

  it('draws every chart from a full review, the appeal mix adding to 100', () => {
    const v = view();
    render(<Report view={v} variant="web" />);
    for (const id of [
      'chart-appeals',
      'chart-balance',
      'chart-duties',
      'chart-perspectives',
      'chart-culture',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(rowsOf('chart-appeals')).toHaveLength(4);
    const shares = rowsOf('chart-balance').map((r) =>
      Number(/(\d+)%/.exec(r.textContent ?? '')?.[1])
    );
    expect(shares.reduce((t, s) => t + s, 0)).toBe(100);
    expect(rowsOf('chart-culture')).toHaveLength(v.culture?.scales.length ?? -1);
  });

  it('prints each perspective score once, in the chart', () => {
    const v = view();
    const p = v.perspectives.find((x) => x.score !== null);
    if (!p) throw new Error('fixture has no scored perspective');
    const { container } = render(
      <Report view={{ ...v, perspectives: [{ ...p, score: 3 }] }} variant="web" />
    );
    const section = container.querySelector('#perspectives');
    expect(section?.textContent?.match(/3\/4/g)).toHaveLength(1);
    expect(within(screen.getByTestId('chart-perspectives')).getByText('3/4')).toBeInTheDocument();
  });

  it('leaves out the duty and culture charts when the result has neither', () => {
    const v = view();
    render(
      <Report view={{ ...v, duties: { ...v.duties, rows: [] }, culture: null }} variant="web" />
    );
    expect(screen.queryByTestId('chart-duties')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart-culture')).not.toBeInTheDocument();
    expect(screen.getByTestId('chart-appeals')).toBeInTheDocument();
  });
});

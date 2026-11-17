// @vitest-environment happy-dom

/**
 * One calibration run in full (t-38): what changed, and every case's misses.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RunDetail } from '@/components/app/admin/frameworks/run-detail';
import { comparison, run } from '@/tests/unit/components/app/admin/frameworks/fixtures';

describe('RunDetail', () => {
  it('lists each case with its counts, its misses and near misses, and failed judges', () => {
    render(<RunDetail run={run()} />);
    const ev01 = screen.getByText('ev01').closest('tr');
    expect(ev01).not.toBeNull();
    const cells = within(ev01 as HTMLElement).getAllByRole('cell');
    expect(cells.slice(1, 4).map((c) => c.textContent)).toEqual(['1', '1', '1']);
    expect(ev01?.textContent).toContain('logos: expected high, got 65');
    // A check with nothing to report says "nothing", not "null".
    expect(ev01?.textContent).toContain('primary: expected teach, got nothing');
    const ev02 = screen.getByText('ev02').closest('tr');
    expect(ev02?.textContent).toContain('judge_culture (over_budget)');
    expect(screen.getByText(/No earlier quick run to compare with/)).toBeInTheDocument();
  });

  it('says a case agreed on every check', () => {
    const agreed = run({
      rows: [{ case: 'ev09', checks: [], judgeFailures: [] }],
    });
    render(<RunDetail run={agreed} />);
    expect(screen.getByText('Every check agreed.')).toBeInTheDocument();
  });

  it('lists the checks that changed since the run before', () => {
    render(<RunDetail run={run({ comparison })} />);
    expect(screen.getByText(/1 check\(s\) changed, worse ones first/)).toBeInTheDocument();
    expect(screen.getByText(/Against the quick run of 0\.5\.0/)).toBeInTheDocument();
    const flip = screen.getAllByText('logos')[0].closest('tr');
    expect(flip?.textContent).toMatch(/ev01.*appeal.*logos.*ok.*near/);
  });

  it('says when nothing changed', () => {
    render(<RunDetail run={run({ comparison: { ...comparison, flips: [] } })} />);
    expect(screen.getByText(/no check changed/)).toBeInTheDocument();
  });

  it.each([
    [{ status: 'failed', error: 'provider unreachable' }, /This run failed: provider unreachable/],
    [{ status: 'failed', error: null }, /no reason was recorded/],
    [{ status: 'stopped' }, /stopped before it finished/],
    [{ status: 'running' }, /still running/],
  ] as const)('explains a run with no results (%o)', (over, text) => {
    render(<RunDetail run={run({ ...over, totals: null, rows: null })} />);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText('Cases')).toBeNull();
  });
});

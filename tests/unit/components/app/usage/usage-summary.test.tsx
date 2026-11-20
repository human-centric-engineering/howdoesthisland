// @vitest-environment happy-dom

/**
 * Tests: the `/usage` page's figures (t-48) — the credits (t-57), the
 * spending limit's three states, the totals, the breakdown and the empty month.
 *
 * @see components/app/usage/usage-summary.tsx
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { formatUsd, lineLabel, UsageSummary } from '@/components/app/usage/usage-summary';
import type { MonthUsage } from '@/lib/app/usage/wire';

const usage = (over: Partial<MonthUsage> = {}): MonthUsage => ({
  month: { start: '2026-11-01T00:00:00.000Z', end: '2026-12-01T00:00:00.000Z' },
  reviews: 5,
  calls: 21,
  spendUsd: 3.25,
  cap: { limitUsd: 10, remainingUsd: 6.75, exceeded: false },
  credits: { balance: 450, spentThisMonth: 0 },
  lines: [
    { kind: 'project', projectId: 'launch', reviews: 3, calls: 13, spendUsd: 2 },
    { kind: 'no-project', projectId: null, reviews: 1, calls: 4, spendUsd: 0.5 },
    { kind: 'kept-nowhere', projectId: null, reviews: 1, calls: 4, spendUsd: 0.5 },
    { kind: 'other', projectId: null, reviews: 0, calls: 0, spendUsd: 0.25 },
  ],
  ...over,
});

describe('UsageSummary', () => {
  it('names the month, and shows spend against the budget with what is left', () => {
    render(<UsageSummary usage={usage()} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('November 2026');
    const budget = screen.getByRole('region', { name: 'Monthly spending limit' });
    expect(budget).toHaveTextContent('$3.25 of $10.00 spent · $6.75 left.');
    expect(budget).toHaveTextContent('It starts again on 1 December.');
    const meter = within(budget).getByRole('meter', { name: 'Spending limit used' });
    expect(meter).toHaveAttribute('aria-valuenow', '3.25');
    expect(meter).toHaveAttribute('aria-valuemax', '10');
  });

  it('says AI reviewers are refused until the month turns once the budget is reached', () => {
    render(
      <UsageSummary
        usage={usage({ spendUsd: 12, cap: { limitUsd: 10, remainingUsd: 0, exceeded: true } })}
      />
    );

    const budget = screen.getByRole('region', { name: 'Monthly spending limit reached' });
    expect(budget).toHaveTextContent('$12.00 of $10.00 spent.');
    expect(budget).toHaveTextContent('AI reviewers are refused until 1 December');
    // The meter stops at the budget rather than running past it.
    expect(within(budget).getByRole('meter')).toHaveAttribute('aria-valuenow', '10');
  });

  it('draws no meter for a $0 budget, which has no range to show', () => {
    render(
      <UsageSummary
        usage={usage({ spendUsd: 0, cap: { limitUsd: 0, remainingUsd: 0, exceeded: true } })}
      />
    );

    expect(
      screen.getByRole('region', { name: 'Monthly spending limit reached' })
    ).toHaveTextContent('$0.00 of $0.00 spent.');
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('says there is no limit when the workspace has no budget', () => {
    render(<UsageSummary usage={usage({ cap: null })} />);

    const budget = screen.getByRole('region', { name: 'No monthly spending limit' });
    expect(budget).toHaveTextContent('no monthly limit on its AI spend');
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('shows the credit balance, and what reviews were charged this month', () => {
    render(<UsageSummary usage={usage({ credits: { balance: 1250, spentThisMonth: 75 } })} />);

    const credits = screen.getByRole('region', { name: 'CopyCredits' });
    expect(credits).toHaveTextContent('1,250');
    expect(credits).toHaveTextContent('What this workspace has to spend');
    expect(credits).toHaveTextContent('75 spent this month.');
  });

  it('says how to get credits when the workspace has none', () => {
    render(<UsageSummary usage={usage({ credits: { balance: 0, spentThisMonth: 0 } })} />);

    const credits = screen.getByRole('region', { name: 'CopyCredits' });
    expect(credits).toHaveTextContent('No credits to spend.');
    expect(credits).toHaveTextContent('a free review code adds some');
    expect(credits).not.toHaveTextContent('spent this month');
  });

  it('lists each line with its figures, then the total', () => {
    render(<UsageSummary usage={usage()} />);

    const rows = within(screen.getByRole('table')).getAllByRole('row');
    const text = rows.map((r) => r.textContent);
    expect(text[1]).toBe('Project launch313$2.00');
    expect(text[2]).toBe('Not in a project14$0.50');
    expect(text[3]).toContain('Reviews kept nowhere');
    expect(text[4]).toContain('Other AI use');
    expect(text[5]).toBe('Total521$3.25');
  });

  it('says nothing has run yet in an empty month', () => {
    render(<UsageSummary usage={usage({ reviews: 0, calls: 0, spendUsd: 0, lines: [] })} />);

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/Nothing yet this month/)).toBeInTheDocument();
  });
});

describe('lineLabel', () => {
  it('names a project by its id until projects have names', () => {
    expect(lineLabel({ kind: 'project', projectId: 'p1', reviews: 0, calls: 0, spendUsd: 0 })).toBe(
      'Project p1'
    );
  });
});

describe('formatUsd', () => {
  it('shows cents, and a figure under a cent as under a cent rather than nothing', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.72)).toBe('$0.72');
    expect(formatUsd(0.004)).toBe('under $0.01');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
  });
});

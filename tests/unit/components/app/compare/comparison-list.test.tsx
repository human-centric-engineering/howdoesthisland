// @vitest-environment happy-dom

/**
 * The list of comparisons (t-90): each row named by its drafts and linking to
 * its comparison, the editor's choice from the row itself, and pages on
 * `/compare` only.
 *
 * @see components/app/compare/comparison-list.tsx
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { ComparisonList, comparisonName } from '@/components/app/compare/comparison-list';
import { comparisonListSchema, type ComparisonRow } from '@/components/app/compare/schemas';
import { aComparisonRow } from '@/tests/unit/components/app/compare/fixtures';

const rows = (...wire: ReturnType<typeof aComparisonRow>[]): ComparisonRow[] =>
  comparisonListSchema.parse(wire);

const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement;

describe('comparisonName', () => {
  it('names a comparison by its drafts, in the order they were sent', () => {
    const [row] = rows(aComparisonRow());
    expect(comparisonName({ drafts: [...row.drafts].reverse() })).toBe(
      'Subject A · Draft 2 · Subject C'
    );
  });
});

describe('ComparisonList', () => {
  it('links each row to its comparison and its project, with the draft that lands better', () => {
    render(
      <ComparisonList
        comparisons={rows(
          aComparisonRow({ project: { id: 'proj-1', name: 'Spring launch' }, projectId: 'proj-1' })
        )}
        total={1}
        page={1}
      />
    );

    expect(screen.getByRole('link', { name: 'Subject A · Draft 2 · Subject C' })).toHaveAttribute(
      'href',
      '/compare/cmp-1'
    );
    const row = rowOf('Subject A · Draft 2 · Subject C');
    // The editor chose the second draft: named by its place, with its score.
    expect(within(row).getByText('Draft 2')).toBeInTheDocument();
    expect(within(row).getByText('74')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Spring launch' })).toHaveAttribute(
      'href',
      '/projects/proj-1'
    );
    expect(within(row).getByText('25 Nov 2026')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 comparison');
  });

  it('says a verdict is still to come, or that there is none, and marks a comparison not done', () => {
    render(
      <ComparisonList
        comparisons={rows(
          aComparisonRow({
            id: 'cmp-run',
            status: 'running',
            drafts: [
              { ...aComparisonRow().drafts[0], label: 'Running A' },
              aComparisonRow().drafts[1],
            ],
            verdict: { status: 'waiting', draft: null },
          }),
          aComparisonRow({
            id: 'cmp-skip',
            drafts: [
              { ...aComparisonRow().drafts[0], label: 'Skipped A' },
              aComparisonRow().drafts[1],
            ],
            verdict: { status: 'skipped', draft: null },
          }),
          aComparisonRow({
            id: 'cmp-fail',
            status: 'failed',
            drafts: [
              { ...aComparisonRow().drafts[0], label: 'Failed A' },
              aComparisonRow().drafts[1],
            ],
            verdict: { status: 'failed', draft: null },
          })
        )}
        total={3}
      />
    );

    const running = rowOf('Running A · Draft 2');
    expect(within(running).getByText('Still to come')).toBeInTheDocument();
    expect(within(running).getByText('Running')).toBeInTheDocument();
    expect(within(rowOf('Skipped A · Draft 2')).getByText('No verdict')).toBeInTheDocument();
    const failed = rowOf('Failed A · Draft 2');
    expect(within(failed).getByText('No verdict')).toBeInTheDocument();
    expect(within(failed).getByText('Failed')).toBeInTheDocument();
  });

  it('says the project is none, and leaves the column out where asked', () => {
    const { unmount } = render(<ComparisonList comparisons={rows(aComparisonRow())} total={1} />);
    expect(within(rowOf('Subject A · Draft 2 · Subject C')).getByText('None')).toBeInTheDocument();
    unmount();

    render(<ComparisonList comparisons={rows(aComparisonRow())} total={1} showProject={false} />);
    expect(screen.queryByRole('columnheader', { name: 'Project' })).toBeNull();
  });

  it('on a page of /compare, counts the page and links to the newer and older ones', () => {
    render(<ComparisonList comparisons={rows(aComparisonRow())} total={45} page={2} />);

    expect(screen.getByRole('status')).toHaveTextContent('21–21 of 45 comparisons, newest first');
    const pages = screen.getByRole('navigation', { name: 'Comparison pages' });
    expect(within(pages).getByRole('link', { name: 'Newer' })).toHaveAttribute('href', '/compare');
    expect(within(pages).getByRole('link', { name: 'Older' })).toHaveAttribute(
      'href',
      '/compare?page=3'
    );
  });

  it('on the last page, offers no older one', () => {
    render(<ComparisonList comparisons={rows(aComparisonRow())} total={41} page={3} />);
    const pages = screen.getByRole('navigation', { name: 'Comparison pages' });
    expect(within(pages).queryByRole('link', { name: 'Older' })).toBeNull();
    expect(within(pages).getByRole('link', { name: 'Newer' })).toHaveAttribute(
      'href',
      '/compare?page=2'
    );
  });

  it('without a page (on /home), says it shows the latest and offers no pages', () => {
    render(<ComparisonList comparisons={rows(aComparisonRow())} total={7} />);
    expect(screen.getByText('The latest 1 of 7 comparisons')).toBeInTheDocument();
    // Not a second live region beside the reviews' count.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('shows nothing with no comparisons', () => {
    const { container } = render(<ComparisonList comparisons={[]} total={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});

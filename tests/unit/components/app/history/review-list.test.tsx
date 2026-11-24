// @vitest-environment happy-dom

/**
 * The review list (t-79): rows from one list call, their project named from
 * the row, pages, and a delete that asks first.
 *
 * @see components/app/history/review-list.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { refresh, del } = vi.hoisted(() => ({ refresh: vi.fn(), del: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { delete: del },
}));

import { ReviewList, reviewName } from '@/components/app/history/review-list';
import { APIClientError } from '@/lib/api/client';
import { aReview } from '@/tests/unit/components/app/history/fixtures';

const two = [
  aReview(),
  aReview({
    id: 'rev-2',
    title: null,
    project: null,
    status: 'running',
    overall: null,
    band: null,
  }),
];

const list = (props: Partial<Parameters<typeof ReviewList>[0]> = {}) =>
  render(
    <ReviewList
      reviews={two}
      total={2}
      showProject
      basePath="/home"
      filter={{}}
      page={1}
      {...props}
    />
  );

beforeEach(() => {
  vi.clearAllMocks();
  del.mockResolvedValue({ deleted: true });
});

describe('ReviewList', () => {
  it('links each row to its report and its project, with its score and band', () => {
    list();

    expect(screen.getByRole('link', { name: 'Spring landing page' })).toHaveAttribute(
      'href',
      '/assessments/rev-1'
    );
    expect(screen.getByRole('link', { name: 'Spring launch' })).toHaveAttribute(
      'href',
      '/projects/proj-1'
    );
    const first = screen.getByRole('link', { name: 'Spring landing page' }).closest('tr');
    expect(first).toHaveTextContent('72');
    expect(first).toHaveTextContent('Strong');
    expect(screen.getByRole('status')).toHaveTextContent('2 reviews');
  });

  it('says a review still running is running, and that one outside a project has none', () => {
    list();
    const row = screen.getByRole('link', { name: /^Pasted copy/ }).closest('tr');
    expect(row).toHaveTextContent('Running');
    expect(row).toHaveTextContent('None');
  });

  it('leaves the project column out on a project’s own page', () => {
    list({ showProject: false });
    expect(screen.queryByRole('columnheader', { name: 'Project' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Spring launch' })).toBeNull();
  });

  it('links to newer and older pages under the same filter', () => {
    list({ total: 45, page: 2, filter: { band: 'Strong' } });

    expect(screen.getByRole('status')).toHaveTextContent('21–22 of 45 reviews, newest first');
    expect(screen.getByRole('link', { name: 'Newer' })).toHaveAttribute(
      'href',
      '/home?band=Strong'
    );
    expect(screen.getByRole('link', { name: 'Older' })).toHaveAttribute(
      'href',
      '/home?band=Strong&page=3'
    );
  });

  it('asks before deleting, and keeping it deletes nothing', async () => {
    const user = userEvent.setup();
    list();

    await user.click(screen.getByRole('button', { name: 'Delete Spring landing page' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('cannot be undone');
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));

    expect(del).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Spring landing page' })).toBeInTheDocument();
  });

  it('deletes on confirming, removes the row and refreshes the page', async () => {
    const user = userEvent.setup();
    list();

    await user.click(screen.getByRole('button', { name: 'Delete Spring landing page' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    );

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Spring landing page' })).toBeNull()
    );
    expect(del).toHaveBeenCalledWith('/api/v1/assessments/rev-1');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: /^Pasted copy/ })).toBeInTheDocument();
  });

  it('counts without a deleted row before the refresh lands', async () => {
    const user = userEvent.setup();
    list({ total: 45, page: 2 });
    expect(screen.getByRole('status')).toHaveTextContent('21–22 of 45 reviews, newest first');

    await user.click(screen.getByRole('button', { name: 'Delete Spring landing page' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    );

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('21–21 of 44 reviews, newest first')
    );
  });

  it('says one review once the other is deleted', async () => {
    const user = userEvent.setup();
    list();

    await user.click(screen.getByRole('button', { name: 'Delete Spring landing page' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    );

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^1 review$/));
  });

  it('keeps the row and says so when the delete fails', async () => {
    del.mockRejectedValue(new APIClientError('Boom', 'INTERNAL_ERROR', 500));
    const user = userEvent.setup();
    list();

    await user.click(screen.getByRole('button', { name: 'Delete Spring landing page' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' })
    );

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Spring landing page' })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('reviewName', () => {
  it('is the title, else the file, else the page, else the pasted copy’s length', () => {
    expect(reviewName(aReview())).toBe('Spring landing page');
    expect(
      reviewName(
        aReview({ title: null, source: { kind: 'file', url: null, fileName: 'brief.pdf' } })
      )
    ).toBe('brief.pdf');
    expect(
      reviewName(
        aReview({
          title: null,
          source: { kind: 'url', url: 'https://example.com/pricing', fileName: null },
        })
      )
    ).toBe('example.com/pricing');
    expect(reviewName(aReview({ title: null, wordCount: 1 }))).toBe('Pasted copy, 1 word');
  });
});

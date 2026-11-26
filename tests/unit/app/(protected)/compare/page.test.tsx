// @vitest-environment happy-dom

/**
 * /compare — every comparison in the workspace (t-90), newest first, a page
 * at a time, from one list call.
 *
 * @see app/(protected)/compare/page.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { getServerSession, clearInvalidSession, requireServerData } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  clearInvalidSession: vi.fn((returnUrl: string) => {
    throw new Error(`NEXT_REDIRECT ${returnUrl}`);
  }),
  requireServerData: vi.fn(),
}));

vi.mock('@/lib/auth/utils', () => ({ getServerSession }));
vi.mock('@/lib/auth/clear-session', () => ({ clearInvalidSession }));
vi.mock('@/lib/api/server-load', () => ({ requireServerData }));

import ComparisonsPage, { metadata } from '@/app/(protected)/compare/page';
import { aComparisonRow } from '@/tests/unit/components/app/compare/fixtures';

const page = (search: Record<string, string> = {}) =>
  ComparisonsPage({ searchParams: Promise.resolve(search) });

function answer(rows = [aComparisonRow()], total = rows.length) {
  requireServerData.mockResolvedValue({
    data: rows,
    meta: { page: 1, limit: 20, total, totalPages: Math.ceil(total / 20) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } });
  answer();
});

describe('/compare', () => {
  it('is titled Comparisons', () => {
    expect(metadata.title).toBe('Comparisons');
  });

  it('lists the comparisons from one list call, each linking to its comparison', async () => {
    render(await page());

    expect(requireServerData.mock.calls).toEqual([['/api/v1/comparisons?limit=20']]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Drafts compared');
    expect(screen.getByRole('link', { name: 'Subject A · Draft 2 · Subject C' })).toHaveAttribute(
      'href',
      '/compare/cmp-1'
    );
    expect(screen.getByRole('link', { name: 'Compare drafts' })).toHaveAttribute('href', '/assess');
  });

  it('passes the address’s page to the list call, and links to the others', async () => {
    answer([aComparisonRow()], 45);
    render(await page({ page: '2' }));

    expect(requireServerData.mock.calls).toEqual([['/api/v1/comparisons?limit=20&page=2']]);
    expect(screen.getByRole('link', { name: 'Newer' })).toHaveAttribute('href', '/compare');
    expect(screen.getByRole('link', { name: 'Older' })).toHaveAttribute('href', '/compare?page=3');
  });

  it('says where to start one when the workspace has none', async () => {
    answer([], 0);
    render(await page());

    expect(screen.getByText('No comparisons yet')).toBeInTheDocument();
    expect(screen.getByText(/Compare drafts tab on Assess/)).toBeInTheDocument();
  });

  it('offers a way back to the newest from a page past the last', async () => {
    answer([], 3);
    render(await page({ page: '5' }));

    expect(screen.getByText('No comparisons here')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the newest' })).toHaveAttribute(
      'href',
      '/compare'
    );
  });

  it('counts what it shows when the list carries no pagination meta', async () => {
    requireServerData.mockResolvedValue({ data: [aComparisonRow()], meta: null });
    render(await page());
    expect(screen.getByRole('status')).toHaveTextContent('1 comparison');
  });

  it('refuses an answer that is not a list of comparisons', async () => {
    requireServerData.mockResolvedValue({ data: [{ id: 1 }], meta: null });
    await expect(page()).rejects.toThrow();
  });

  it('clears a cookie whose session is gone, returning to the same page after login', async () => {
    getServerSession.mockResolvedValue(null);
    await expect(page({ page: '2' })).rejects.toThrow('NEXT_REDIRECT /compare?page=2');
    expect(requireServerData).not.toHaveBeenCalled();
  });
});

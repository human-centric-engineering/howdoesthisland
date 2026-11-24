// @vitest-environment happy-dom

/**
 * /home — the signed-in landing (D22): the workspace's recent reviews (t-79),
 * filtered through the address, from one list call; the empty desk only when
 * there are none at all.
 *
 * The proxy only checks that a session cookie exists and sends anyone holding
 * one here from /login, so a stale cookie must be cleared here or that person
 * is locked out of the login form.
 *
 * @see app/(protected)/home/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { getServerSession, clearInvalidSession, requireServerData, requireAllServerData } =
  vi.hoisted(() => ({
    getServerSession: vi.fn(),
    clearInvalidSession: vi.fn((returnUrl: string) => {
      throw new Error(`NEXT_REDIRECT ${returnUrl}`);
    }),
    requireServerData: vi.fn(),
    requireAllServerData: vi.fn(),
  }));

vi.mock('@/lib/auth/utils', () => ({ getServerSession }));
vi.mock('@/lib/auth/clear-session', () => ({ clearInvalidSession }));
vi.mock('@/lib/api/server-load', () => ({ requireServerData, requireAllServerData }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/components/ui/select', async () => {
  const { selectMock } = await import('@/tests/unit/components/app/projects/select-mock');
  return selectMock;
});

import HomePage, { metadata } from '@/app/(protected)/home/page';
import { aReview } from '@/tests/unit/components/app/history/fixtures';
import { aProject } from '@/tests/unit/components/app/projects/fixtures';

const page = (search: Record<string, string> = {}) =>
  HomePage({ searchParams: Promise.resolve(search) });

const LIST = '/api/v1/assessments?limit=20';

function answer(
  reviews = [aReview()],
  total = reviews.length,
  latestVersion: string | null = '0.5.2'
) {
  requireServerData.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/v1/assessments?'))
      return { data: reviews, meta: { page: 1, limit: 20, total, totalPages: 1 } };
    if (path === '/api/v1/frameworks/howdoesthisland')
      return { data: { name: 'HowDoesThisLand', latestVersion }, meta: null };
    if (path === '/api/v1/frameworks/howdoesthisland/versions/0.5.2/catalogue')
      return {
        data: {
          request: { contentTypes: [{ id: 'landing_page', name: 'Landing page' }] },
          result: { bands: ['Weak', 'Strong'] },
        },
        meta: null,
      };
    throw new Error(`unexpected ${path}`);
  });
  requireAllServerData.mockResolvedValue([aProject()]);
}

const listCalls = () =>
  requireServerData.mock.calls.filter(([path]) => String(path).startsWith('/api/v1/assessments'));

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } });
  answer();
});

describe('/home', () => {
  it('is titled Home', () => {
    expect(metadata.title).toBe('Home');
  });

  it('lists the recent reviews from one list call, with a way to /assess', async () => {
    render(await page());

    expect(listCalls()).toEqual([[LIST]]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Recent reviews');
    expect(screen.getByRole('link', { name: 'Spring landing page' })).toBeInTheDocument();
    // Named from the row itself: the project is not read again.
    expect(screen.getByRole('link', { name: 'Spring launch' })).toHaveAttribute(
      'href',
      '/projects/proj-1'
    );
    expect(screen.getByRole('link', { name: 'Review some copy' })).toHaveAttribute(
      'href',
      '/assess'
    );
    expect(screen.queryByText('Nothing on the desk yet.')).toBeNull();
  });

  it('passes the address’s filters and page to the list call, and to the pickers', async () => {
    render(
      await page({ projectId: 'proj-1', contentType: 'landing_page', band: 'Strong', page: '2' })
    );

    expect(listCalls()).toEqual([
      ['/api/v1/assessments?limit=20&page=2&projectId=proj-1&contentType=landing_page&band=Strong'],
    ]);
    expect(screen.getByLabelText('Type of copy')).toHaveValue('landing_page');
    expect(screen.getByLabelText('Band')).toHaveValue('Strong');
    expect(screen.getByLabelText('Project')).toHaveValue('proj-1');
  });

  it('shows the empty desk only when the workspace has no review at all', async () => {
    answer([], 0);
    render(await page());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Nothing on the desk yet.');
    // Nothing to filter, so neither the catalogue nor the projects are read.
    expect(requireServerData).toHaveBeenCalledTimes(1);
    expect(requireAllServerData).not.toHaveBeenCalled();
  });

  it('says a filter matches nothing, rather than showing the empty desk', async () => {
    answer([], 0);
    render(await page({ band: 'Weak' }));

    expect(screen.getByText('No reviews match these filters')).toBeInTheDocument();
    expect(screen.queryByText('Nothing on the desk yet.')).toBeNull();
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/home');
  });

  it('offers a way back to the newest from a page past the last', async () => {
    answer([], 3);
    render(await page({ page: '5' }));

    expect(screen.getByText('No reviews here')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the newest' })).toHaveAttribute(
      'href',
      '/home'
    );
  });

  it('still lists the reviews when no version is in use, offering no type or band', async () => {
    answer([aReview()], 1, null);
    render(await page());

    expect(screen.getByRole('link', { name: 'Spring landing page' })).toBeInTheDocument();
    expect(screen.getByLabelText('Type of copy').querySelectorAll('option')).toHaveLength(1);
    expect(screen.getByLabelText('Band').querySelectorAll('option')).toHaveLength(1);
  });

  it('counts what it shows when the list carries no pagination meta', async () => {
    requireServerData.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/v1/assessments?')) return { data: [aReview()], meta: null };
      if (path === '/api/v1/frameworks/howdoesthisland')
        return { data: { name: 'HowDoesThisLand', latestVersion: null }, meta: null };
      throw new Error(`unexpected ${path}`);
    });
    render(await page());
    expect(screen.getByRole('status')).toHaveTextContent('1 review');
  });

  it('ignores what the address carries that is not a filter', async () => {
    render(await page({ status: 'failed', page: 'two' }));
    expect(listCalls()).toEqual([[LIST]]);
  });

  it('refuses an answer that is not a list of reviews', async () => {
    requireServerData.mockResolvedValue({ data: [{ id: 1 }], meta: null });
    await expect(page()).rejects.toThrow();
  });

  it('clears a cookie whose session is gone, returning to /home after login', async () => {
    getServerSession.mockResolvedValue(null);
    await expect(page()).rejects.toThrow('NEXT_REDIRECT /home');
    expect(clearInvalidSession).toHaveBeenCalledWith('/home');
    expect(requireServerData).not.toHaveBeenCalled();
  });
});

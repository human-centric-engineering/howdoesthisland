// @vitest-environment happy-dom

/**
 * /projects/[id] (t-71) — the project, then its framework's latest version,
 * its background documents (t-74), and the version's catalogue, which fills
 * the default pickers.
 *
 * @see app/(protected)/projects/[id]/page.tsx
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
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import ProjectPage from '@/app/(protected)/projects/[id]/page';
import { aCatalogue, aProject } from '@/tests/unit/components/app/projects/fixtures';
import { aReview } from '@/tests/unit/components/app/history/fixtures';

const page = (id = 'proj-1', search: Record<string, string> = {}) =>
  ProjectPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(search) });

function answer({
  latestVersion = '0.5.1',
  archived = false,
  reviews = [aReview({ project: { id: 'proj-1', name: 'Spring launch' } })],
}: {
  latestVersion?: string | null;
  archived?: boolean;
  reviews?: ReturnType<typeof aReview>[];
} = {}) {
  requireServerData.mockImplementation(async (path: string) => {
    if (path === '/api/v1/projects/proj-1') return { data: aProject({ archived }), meta: null };
    if (path === '/api/v1/frameworks/howdoesthisland')
      return { data: { name: 'HowDoesThisLand', latestVersion }, meta: null };
    if (path === '/api/v1/projects/proj-1/documents')
      return {
        data: [
          {
            id: 'doc-1',
            title: 'Brand guide',
            fileName: 'brand-guide.pdf',
            sourceUrl: null,
            status: 'ready',
            chunkCount: 12,
            addedAt: '2026-11-23T10:00:00.000Z',
          },
        ],
        meta: null,
      };
    if (path === '/api/v1/frameworks/howdoesthisland/versions/0.5.1/catalogue')
      return { data: aCatalogue(), meta: null };
    if (path.startsWith('/api/v1/assessments?'))
      return {
        data: reviews,
        meta: { page: 1, limit: 20, total: reviews.length, totalPages: 1 },
      };
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } });
  answer();
});

describe('/projects/[id]', () => {
  it('lists its own reviews from one list call, without a project column (t-79)', async () => {
    render(await page('proj-1', { page: '2' }));

    const listCalls = requireServerData.mock.calls.filter(([path]) =>
      String(path).startsWith('/api/v1/assessments')
    );
    expect(listCalls).toEqual([['/api/v1/assessments?limit=20&page=2&projectId=proj-1']]);
    const section = screen.getByRole('region', { name: 'Its reviews' });
    expect(section).toHaveTextContent('Spring landing page');
    expect(screen.queryByRole('columnheader', { name: 'Project' })).toBeNull();
  });

  it('says when it has no reviews yet', async () => {
    answer({ reviews: [] });
    render(await page());
    expect(screen.getByRole('region', { name: 'Its reviews' })).toHaveTextContent(
      'No reviews in this project yet'
    );
  });

  it('reads the project as a 404-able page, its documents, then the latest version’s catalogue', async () => {
    render(await page());

    expect(requireServerData).toHaveBeenNthCalledWith(1, '/api/v1/projects/proj-1', {
      notFound: true,
    });
    expect(requireServerData).toHaveBeenNthCalledWith(2, '/api/v1/frameworks/howdoesthisland');
    expect(requireServerData).toHaveBeenNthCalledWith(3, '/api/v1/projects/proj-1/documents');
    expect(requireServerData).toHaveBeenNthCalledWith(
      4,
      '/api/v1/frameworks/howdoesthisland/versions/0.5.1/catalogue'
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Spring launch');
    expect(screen.getByText(/3 reviews · scored with HowDoesThisLand 0\.5\.1/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive project' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Background documents' })).toHaveTextContent(
      'Brand guide'
    );
  });

  it('says an archived project is archived and offers to restore it', async () => {
    answer({ archived: true });
    render(await page());

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Archived');
    expect(screen.getByRole('button', { name: 'Restore project' })).toBeInTheDocument();
  });

  it('fails to the error boundary when every version is retired', async () => {
    answer({ latestVersion: null });

    await expect(page()).rejects.toThrow('howdoesthisland has no version in use');
  });

  it('clears a cookie whose session is gone, returning to the project', async () => {
    getServerSession.mockResolvedValue(null);

    await expect(page('proj 1')).rejects.toThrow('NEXT_REDIRECT /projects/proj%201');
    expect(requireServerData).not.toHaveBeenCalled();
  });
});

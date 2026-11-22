// @vitest-environment happy-dom

/**
 * /projects/[id] (t-71) — the project, then its framework's latest version's
 * catalogue, which fills the default pickers.
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

const page = (id = 'proj-1') => ProjectPage({ params: Promise.resolve({ id }) });

function answer({ latestVersion = '0.5.1', archived = false } = {}) {
  requireServerData.mockImplementation(async (path: string) => {
    if (path === '/api/v1/projects/proj-1') return { data: aProject({ archived }), meta: null };
    if (path === '/api/v1/frameworks/howdoesthisland')
      return { data: { name: 'HowDoesThisLand', latestVersion }, meta: null };
    if (path === '/api/v1/frameworks/howdoesthisland/versions/0.5.1/catalogue')
      return { data: aCatalogue(), meta: null };
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } });
  answer();
});

describe('/projects/[id]', () => {
  it('reads the project as a 404-able page, then the latest version’s catalogue', async () => {
    render(await page());

    expect(requireServerData).toHaveBeenNthCalledWith(1, '/api/v1/projects/proj-1', {
      notFound: true,
    });
    expect(requireServerData).toHaveBeenNthCalledWith(2, '/api/v1/frameworks/howdoesthisland');
    expect(requireServerData).toHaveBeenNthCalledWith(
      3,
      '/api/v1/frameworks/howdoesthisland/versions/0.5.1/catalogue'
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Spring launch');
    expect(screen.getByText(/3 reviews · scored with HowDoesThisLand 0\.5\.1/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive project' })).toBeInTheDocument();
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

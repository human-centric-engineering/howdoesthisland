// @vitest-environment happy-dom

/**
 * /projects (t-71) — the workspace's projects, from one list call.
 *
 * @see app/(protected)/projects/page.tsx
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

import ProjectsPage, { metadata } from '@/app/(protected)/projects/page';
import { aProject } from '@/tests/unit/components/app/projects/fixtures';

const page = (search: Record<string, string> = {}) =>
  ProjectsPage({ searchParams: Promise.resolve(search) });

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } });
  requireServerData.mockResolvedValue({
    data: [aProject()],
    meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
  });
});

describe('/projects', () => {
  it('is titled Projects', () => {
    expect(metadata.title).toBe('Projects');
  });

  it('renders what GET /api/v1/projects answers, in one call', async () => {
    render(await page());

    expect(requireServerData).toHaveBeenCalledTimes(1);
    expect(requireServerData).toHaveBeenCalledWith('/api/v1/projects?limit=100');
    expect(screen.getByRole('link', { name: 'Spring launch' })).toBeInTheDocument();
  });

  it('asks for archived ones too behind the toggle', async () => {
    render(await page({ archived: 'true' }));

    expect(requireServerData).toHaveBeenCalledWith('/api/v1/projects?limit=100&archived=true');
    expect(screen.getByRole('link', { name: 'Hide archived projects' })).toBeInTheDocument();
  });

  it('refuses an answer that is not a list of projects', async () => {
    requireServerData.mockResolvedValue({ data: [{ id: 1 }], meta: null });

    await expect(page()).rejects.toThrow();
  });

  it('clears a cookie whose session is gone, returning to /projects after login', async () => {
    getServerSession.mockResolvedValue(null);

    await expect(page()).rejects.toThrow('NEXT_REDIRECT /projects');
    expect(requireServerData).not.toHaveBeenCalled();
  });
});

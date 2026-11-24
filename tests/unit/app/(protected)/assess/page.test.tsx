// @vitest-environment happy-dom

/**
 * /assess (t-78) — the workbench, from three reads: the framework's latest
 * version, its catalogue and the workspace's projects.
 *
 * @see app/(protected)/assess/page.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

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

import AssessPage, { metadata } from '@/app/(protected)/assess/page';
import { aProject } from '@/tests/unit/components/app/projects/fixtures';
import { anAssessCatalogue } from '@/tests/unit/components/app/workbench/fixtures';

const PROJECTS = [
  aProject({ id: 'live', name: 'Live project' }),
  aProject({ id: 'old', name: 'Archived project', archived: true }),
  aProject({ id: 'other', name: 'Other framework', framework: 'another' }),
];

function answer(latestVersion: string | null = '0.5.2') {
  requireServerData.mockImplementation((path: string) => {
    if (path === '/api/v1/frameworks/howdoesthisland') {
      return Promise.resolve({ data: { name: 'HowDoesThisLand', latestVersion } });
    }
    if (path.endsWith('/catalogue')) return Promise.resolve({ data: anAssessCatalogue() });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  // Every page of the projects, as one list.
  requireAllServerData.mockImplementation((path: string) =>
    path === '/api/v1/projects'
      ? Promise.resolve(PROJECTS)
      : Promise.reject(new Error(`unexpected ${path}`))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getServerSession.mockResolvedValue({ user: { id: 'u1' }, session: { id: 's1' } });
  answer();
});

describe('/assess', () => {
  it('is titled Assess', () => {
    expect(metadata.title).toBe('Assess');
  });

  it('reads the latest version’s catalogue, then every page of the projects', async () => {
    render(await AssessPage());

    expect(requireServerData.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/frameworks/howdoesthisland',
      '/api/v1/frameworks/howdoesthisland/versions/0.5.2/catalogue',
    ]);
    expect(requireAllServerData).toHaveBeenCalledWith('/api/v1/projects');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('How will this land?');
  });

  it('offers only the live projects on this framework', async () => {
    render(await AssessPage());

    const picker = screen.getByLabelText(/^Project/, { selector: 'select' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['No project', 'Live project']);
  });

  it('fails to the error boundary when every version is retired', async () => {
    answer(null);
    await expect(AssessPage()).rejects.toThrow('howdoesthisland has no version in use');
  });

  it('clears a cookie whose session is gone, returning here after login', async () => {
    getServerSession.mockResolvedValue(null);
    await expect(AssessPage()).rejects.toThrow('NEXT_REDIRECT /assess');
    expect(requireServerData).not.toHaveBeenCalled();
  });
});

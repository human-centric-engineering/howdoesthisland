// @vitest-environment happy-dom

/**
 * Archiving and restoring a project (t-71).
 *
 * @see components/app/projects/project-archive.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { patch: vi.fn(), delete: vi.fn() },
}));

import { ProjectArchive } from '@/components/app/projects/project-archive';
import { apiClient, APIClientError } from '@/lib/api/client';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectArchive', () => {
  it('archives with DELETE and refreshes the page', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({});
    const user = userEvent.setup();
    render(<ProjectArchive projectId="proj-1" archived={false} />);

    await user.click(screen.getByRole('button', { name: 'Archive project' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/projects/proj-1');
    expect(apiClient.patch).not.toHaveBeenCalled();
  });

  it('restores with PATCH archived: false', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({});
    const user = userEvent.setup();
    render(<ProjectArchive projectId="proj-1" archived />);

    await user.click(screen.getByRole('button', { name: 'Restore project' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(apiClient.patch).toHaveBeenCalledWith('/api/v1/projects/proj-1', {
      body: { archived: false },
    });
  });

  it('shows a refusal beside the button', async () => {
    vi.mocked(apiClient.delete).mockRejectedValue(
      new APIClientError('Project not found', 'NOT_FOUND', 404)
    );
    const user = userEvent.setup();
    render(<ProjectArchive projectId="proj-1" archived={false} />);

    await user.click(screen.getByRole('button', { name: 'Archive project' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Project not found');
    expect(refresh).not.toHaveBeenCalled();
  });
});

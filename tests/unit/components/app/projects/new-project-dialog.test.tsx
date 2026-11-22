// @vitest-environment happy-dom

/**
 * Making a project (t-71): a name, POST, then its page.
 *
 * @see components/app/projects/new-project-dialog.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: vi.fn() },
}));

import { NewProjectDialog } from '@/components/app/projects/new-project-dialog';
import { apiClient, APIClientError } from '@/lib/api/client';

async function open() {
  const user = userEvent.setup();
  render(<NewProjectDialog />);
  await user.click(screen.getByRole('button', { name: 'New project' }));
  return user;
}

const nameField = () => screen.getByLabelText(/^Name/, { selector: 'input' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NewProjectDialog', () => {
  it('has help on its one field', async () => {
    const user = await open();

    await user.click(screen.getByRole('button', { name: 'More information' }));
    expect(await screen.findByText('Project name')).toBeInTheDocument();
  });

  it('makes the project and opens its page', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'proj-9', name: 'Acme' });
    const user = await open();

    await user.type(nameField(), '  Acme ');
    await user.click(screen.getByRole('button', { name: 'Make project' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/proj-9'));
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/projects', { body: { name: 'Acme' } });
  });

  it('blocks a blank name without sending', async () => {
    const user = await open();

    await user.click(screen.getByRole('button', { name: 'Make project' }));

    expect(await screen.findByText('Give the project a name')).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('shows a refused save by Save and stays open', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('Framework not found', 'FRAMEWORK_NOT_FOUND', 404)
    );
    const user = await open();

    await user.type(nameField(), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Make project' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Framework not found');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

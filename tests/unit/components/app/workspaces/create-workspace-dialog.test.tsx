// @vitest-environment happy-dom

/**
 * @see components/app/workspaces/create-workspace-dialog.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: vi.fn(), get: vi.fn() },
}));

import { CreateWorkspaceDialog } from '@/components/app/workspaces/create-workspace-dialog';
import { apiClient, APIClientError } from '@/lib/api/client';

function setup() {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<CreateWorkspaceDialog open onOpenChange={onOpenChange} onCreated={onCreated} />);
  return { user, onOpenChange, onCreated };
}

describe('CreateWorkspaceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the name field with a help popover stating the ownership limit', async () => {
    const { user } = setup();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'More information' }));
    expect(await screen.findByText('Workspace name')).toBeInTheDocument();
    expect(screen.getByText(/You can own up to \d+ workspaces/)).toBeInTheDocument();
  });

  it('blocks an empty submit with "Name is required" and sends nothing', async () => {
    const { user, onCreated } = setup();

    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('posts the name, hands the new workspace to onCreated and closes', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'org-9', name: 'Acme' });
    const { user, onCreated, onOpenChange } = setup();

    await user.type(screen.getByRole('textbox'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'org-9', name: 'Acme' }));
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/workspaces', { body: { name: 'Acme' } });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows the server message and stays open on a workspace-limit 409', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('You already own 5 workspaces.', 'WORKSPACE_LIMIT_REACHED', 409)
    );
    const { user, onCreated, onOpenChange } = setup();

    await user.type(screen.getByRole('textbox'), 'Sixth');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You already own 5 workspaces.');
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('puts a server validation error on name under the field', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('Validation failed', 'VALIDATION_ERROR', 400, {
        name: ['Name is already taken'],
      })
    );
    const { user } = setup();

    await user.type(screen.getByRole('textbox'), 'Dup');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByText('Name is already taken')).toBeInTheDocument();
  });

  it('closes via Cancel', async () => {
    const { user, onOpenChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

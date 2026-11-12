// @vitest-environment happy-dom

/**
 * @see components/app/workspaces/workspace-switcher.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: vi.fn(), get: vi.fn() },
}));

import { WorkspaceSwitcher } from '@/components/app/workspaces/workspace-switcher';
import { apiClient, APIClientError } from '@/lib/api/client';

const org = (over: Record<string, unknown>) => ({
  id: 'o1',
  name: 'Personal',
  status: 'ACTIVE',
  role: 'OWNER',
  active: false,
  ...over,
});

const LIST = {
  activeOrgId: 'o1',
  orgs: [
    org({ id: 'o1', name: 'Personal', active: true }),
    org({ id: 'o2', name: 'Acme', role: 'MEMBER' }),
    org({ id: 'o3', name: 'Frozen Co', status: 'SUSPENDED' }),
  ],
};

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Switch workspace/ }));
}

describe('WorkspaceSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.get).mockResolvedValue(LIST);
  });

  it('loads the list from /api/v1/orgs and shows the active workspace on the trigger', async () => {
    render(<WorkspaceSwitcher />);

    const trigger = await screen.findByRole('button', { name: /Switch workspace/ });
    expect(trigger).toHaveTextContent('Personal');
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/orgs');
  });

  it('renders nothing when the load fails', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('boom'));

    const { container } = render(<WorkspaceSwitcher />);

    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the response is malformed', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ orgs: [{ id: 1 }] });

    const { container } = render(<WorkspaceSwitcher />);

    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('says "Choose a workspace" and hides settings when none is active', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      activeOrgId: null,
      orgs: [org({ id: 'o2', name: 'Acme' })],
    });
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);

    expect(await screen.findByText('Choose a workspace')).toBeInTheDocument();
    await openMenu(user);

    expect(await screen.findByRole('menuitem', { name: /Acme/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Workspace settings/ })).not.toBeInTheDocument();
  });

  it('lists workspaces with the active one enabled and the suspended one disabled', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await openMenu(user);

    const current = await screen.findByRole('menuitem', { name: /Personal/ });
    expect(current).toHaveTextContent('(current)');
    expect(current).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: /Acme/ })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    );
    const frozen = screen.getByRole('menuitem', { name: /Frozen Co/ });
    expect(frozen).toHaveAttribute('aria-disabled', 'true');
    expect(frozen).toHaveTextContent('suspended');
  });

  it('does not call switch when the active workspace is picked again', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await openMenu(user);

    await user.click(await screen.findByRole('menuitem', { name: /Personal/ }));

    expect(apiClient.post).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('switches to another workspace, reloads the list and refreshes the router', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({});
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await openMenu(user);
    vi.mocked(apiClient.get).mockResolvedValue({
      activeOrgId: 'o2',
      orgs: [
        org({ id: 'o1', name: 'Personal' }),
        org({ id: 'o2', name: 'Acme', active: true }),
        org({ id: 'o3', name: 'Frozen Co', status: 'SUSPENDED' }),
      ],
    });

    await user.click(await screen.findByRole('menuitem', { name: /Acme/ }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/orgs/switch', { body: { orgId: 'o2' } });
    expect(apiClient.get).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: /Switch workspace/ })).toHaveTextContent(
      'Acme'
    );
  });

  it('shows an alert and does not refresh when the switch fails', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('That workspace is suspended.', 'FORBIDDEN', 403)
    );
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await openMenu(user);

    await user.click(await screen.findByRole('menuitem', { name: /Acme/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That workspace is suspended.');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('links to workspace settings when a workspace is active', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await openMenu(user);

    expect(await screen.findByRole('menuitem', { name: /Workspace settings/ })).toHaveAttribute(
      'href',
      '/settings/workspace'
    );
  });

  it('opens the create dialog from "New workspace…"', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await openMenu(user);

    await user.click(await screen.findByRole('menuitem', { name: /New workspace/ }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('New workspace');
  });

  it('switches into a workspace it has just created', async () => {
    vi.mocked(apiClient.post).mockImplementation(async (url: string) =>
      url === '/api/v1/workspaces' ? { id: 'o9', name: 'Fresh' } : {}
    );
    const user = userEvent.setup();
    render(<WorkspaceSwitcher />);
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: /New workspace/ }));

    await user.type(await screen.findByRole('textbox'), 'Fresh');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith('/api/v1/orgs/switch', {
        body: { orgId: 'o9' },
      })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

// @vitest-environment happy-dom

/**
 * @see components/app/workspaces/workspace-invitations.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const m = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: vi.fn(), get: vi.fn() },
}));

import { WorkspaceInvitations } from '@/components/app/workspaces/workspace-invitations';
import { apiClient, APIClientError } from '@/lib/api/client';
import type { InvitationForInvitee } from '@/components/app/workspaces/schemas';

const GLOBEX: InvitationForInvitee = {
  id: 'inv-1',
  workspace: { id: 'org-2', name: 'Globex' },
  role: 'ADMIN',
  invitedBy: 'Ann Lee',
  expiresAt: '2026-12-05T12:00:00.000Z',
};
const INITECH: InvitationForInvitee = {
  id: 'inv-2',
  workspace: { id: 'org-3', name: 'Initech' },
  role: 'MEMBER',
  invitedBy: null,
  expiresAt: '2026-12-20T12:00:00.000Z',
};

describe('WorkspaceInvitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(<WorkspaceInvitations invitations={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows each workspace with the role, who invited and when it expires', () => {
    render(<WorkspaceInvitations invitations={[GLOBEX, INITECH]} />);

    expect(screen.getByText('Globex')).toBeInTheDocument();
    expect(
      screen.getByText(/As admin, from Ann Lee\. Open until 5 December\./)
    ).toBeInTheDocument();
    expect(screen.getByText('Initech')).toBeInTheDocument();
    // No inviter on record: the "from" clause is left out rather than printed blank.
    expect(screen.getByText(/As member\. Open until 20 December\./)).toBeInTheDocument();
  });

  it('accepts, then switches into the accepted workspace, drops the row and refreshes', async () => {
    vi.mocked(apiClient.post).mockImplementation(async (url: string) =>
      url.endsWith('/accept') ? { orgId: 'org-2', role: 'ADMIN' } : {}
    );
    const user = userEvent.setup();
    render(<WorkspaceInvitations invitations={[GLOBEX, INITECH]} />);

    await user.click(screen.getByRole('button', { name: 'Accept the invitation to Globex' }));

    await waitFor(() => expect(m.refresh).toHaveBeenCalledTimes(1));
    expect(vi.mocked(apiClient.post).mock.calls).toEqual([
      ['/api/v1/workspaces/invitations/inv-1/accept'],
      ['/api/v1/orgs/switch', { body: { orgId: 'org-2' } }],
    ]);
    expect(screen.queryByText('Globex')).not.toBeInTheDocument();
    expect(screen.getByText('Initech')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still drops the row and refreshes, with no error, when the switch fails', async () => {
    vi.mocked(apiClient.post).mockImplementation(async (url: string) => {
      if (url.endsWith('/accept')) return { orgId: 'org-2', role: 'ADMIN' };
      throw new APIClientError('Workspace suspended', 'ORG_SUSPENDED', 403);
    });
    const user = userEvent.setup();
    render(<WorkspaceInvitations invitations={[GLOBEX, INITECH]} />);

    await user.click(screen.getByRole('button', { name: 'Accept the invitation to Globex' }));

    await waitFor(() => expect(m.refresh).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/orgs/switch', {
      body: { orgId: 'org-2' },
    });
    expect(screen.queryByText('Globex')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('declines without switching, drops the row and refreshes', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({});
    const user = userEvent.setup();
    render(<WorkspaceInvitations invitations={[GLOBEX, INITECH]} />);

    await user.click(screen.getByRole('button', { name: 'Decline the invitation to Initech' }));

    await waitFor(() => expect(m.refresh).toHaveBeenCalledTimes(1));
    expect(vi.mocked(apiClient.post).mock.calls).toEqual([
      ['/api/v1/workspaces/invitations/inv-2/decline'],
    ]);
    expect(screen.queryByText('Initech')).not.toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
  });

  it('renders nothing once the last invitation is answered', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({});
    const user = userEvent.setup();
    const { container } = render(<WorkspaceInvitations invitations={[INITECH]} />);

    await user.click(screen.getByRole('button', { name: 'Decline the invitation to Initech' }));

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it.each([
    [410, 'INVITATION_EXPIRED', 'That invitation has expired.'],
    [409, 'INVITATION_ANSWERED', 'That invitation was already answered.'],
  ])('on a %s shows the message, keeps the row and refreshes', async (status, code, message) => {
    vi.mocked(apiClient.post).mockRejectedValue(new APIClientError(message, code, status));
    const user = userEvent.setup();
    render(<WorkspaceInvitations invitations={[GLOBEX]} />);

    await user.click(screen.getByRole('button', { name: 'Accept the invitation to Globex' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(m.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Globex')).toBeInTheDocument();
    // A failed accept never reaches the switch.
    expect(apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('disables every button while one answer is in flight', async () => {
    let resolve: (value: unknown) => void = () => {};
    vi.mocked(apiClient.post).mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<WorkspaceInvitations invitations={[GLOBEX, INITECH]} />);

    await user.click(screen.getByRole('button', { name: 'Decline the invitation to Globex' }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Accept the invitation to Initech' })
      ).toBeDisabled()
    );
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();

    resolve({});
    await waitFor(() => expect(m.refresh).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Accept the invitation to Initech' })).toBeEnabled();
  });
});

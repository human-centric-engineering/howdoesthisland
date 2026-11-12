// @vitest-environment happy-dom

/**
 * @see components/app/workspaces/invite-member-form.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: vi.fn(), get: vi.fn() },
}));

import { InviteMemberForm } from '@/components/app/workspaces/invite-member-form';
import { apiClient, APIClientError } from '@/lib/api/client';

const URL = '/api/v1/orgs/org-1/invitations';

// Radix Select needs these DOM APIs, which happy-dom lacks.
beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

/** The email field; its label also contains a help button, so look it up by id. */
function emailInput() {
  return screen.getByLabelText('Email', { selector: '#invite-email', exact: false });
}

async function fill(user: ReturnType<typeof userEvent.setup>, name: string, email: string) {
  await user.type(screen.getByLabelText('Name'), name);
  await user.type(emailInput(), email);
}

async function send(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Send invitation' }));
}

describe('InviteMemberForm', () => {
  it('posts name, normalised email and the default Member role to the org invitations route', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ emailStatus: 'sent' });
    const user = userEvent.setup();
    render(<InviteMemberForm orgId="org-1" canInviteOwner={false} />);

    await fill(user, 'Grace', '  Grace@Example.COM ');
    await send(user);

    await screen.findByRole('status');
    expect(apiClient.post).toHaveBeenCalledWith(URL, {
      body: { name: 'Grace', email: 'grace@example.com', orgRole: 'MEMBER' },
    });
  });

  it('says the invitation was sent and clears the form', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ emailStatus: 'sent' });
    const user = userEvent.setup();
    render(<InviteMemberForm orgId="org-1" canInviteOwner={false} />);

    await fill(user, 'Grace', 'grace@example.com');
    await send(user);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invitation sent to grace@example.com.'
    );
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(emailInput()).toHaveValue('');
  });

  it('says an invitation is already waiting when the status is pending', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ emailStatus: 'pending' });
    const user = userEvent.setup();
    render(<InviteMemberForm orgId="org-1" canInviteOwner={false} />);

    await fill(user, 'Grace', 'grace@example.com');
    await send(user);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'grace@example.com already has an invitation to this workspace waiting.'
    );
  });

  it.each(['failed', 'disabled'])(
    'says it was saved but the email could not be sent when the status is %s',
    async (emailStatus) => {
      vi.mocked(apiClient.post).mockResolvedValue({ emailStatus });
      const user = userEvent.setup();
      render(<InviteMemberForm orgId="org-1" canInviteOwner={false} />);

      await fill(user, 'Grace', 'grace@example.com');
      await send(user);

      const status = await screen.findByRole('status');
      expect(status).toHaveTextContent('saved, but the email could not be sent');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
  );

  it('treats an unparseable success body as sent', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ something: 'else' });
    const user = userEvent.setup();
    render(<InviteMemberForm orgId="org-1" canInviteOwner={false} />);

    await fill(user, 'Grace', 'grace@example.com');
    await send(user);

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invitation sent to grace@example.com.'
    );
  });

  it("shows the server's message when the address already has an account", async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('That email already has an account.', 'EMAIL_TAKEN', 409)
    );
    const user = userEvent.setup();
    render(<InviteMemberForm orgId="org-1" canInviteOwner={false} />);

    await fill(user, 'Grace', 'grace@example.com');
    await send(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That email already has an account.'
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('blocks an invalid email and a missing name without posting', async () => {
    const user = userEvent.setup();
    render(<InviteMemberForm orgId="org-1" canInviteOwner={false} />);

    await user.type(emailInput(), 'not-an-email');
    await send(user);

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('offers Member and Admin only when the caller cannot invite owners', async () => {
    const user = userEvent.setup();
    render(<InviteMemberForm orgId="org-1" canInviteOwner={false} />);

    await user.click(screen.getByRole('combobox'));

    expect(await screen.findByRole('option', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Member' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument();
  });

  it('offers Owner too, and sends it when chosen, for an owner', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ emailStatus: 'sent' });
    const user = userEvent.setup();
    render(<InviteMemberForm orgId="org-1" canInviteOwner />);

    await fill(user, 'Grace', 'grace@example.com');
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Owner' }));
    await send(user);

    await screen.findByRole('status');
    expect(apiClient.post).toHaveBeenCalledWith(URL, {
      body: { name: 'Grace', email: 'grace@example.com', orgRole: 'OWNER' },
    });
  });
});

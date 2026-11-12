// @vitest-environment happy-dom

/**
 * @see components/app/workspaces/workspace-invite-form.tsx
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

import { WorkspaceInviteForm } from '@/components/app/workspaces/workspace-invite-form';
import { apiClient, APIClientError } from '@/lib/api/client';

// The label also holds the help button, so match the inputs by role and name.
const nameInput = () => screen.getByRole('textbox', { name: /^Name/ });
const emailInput = () => screen.getByRole('textbox', { name: /^Email/ });

const MESSAGE = 'If that address can be invited, they will hear from us.';

function setup(orgId = 'org-1') {
  const user = userEvent.setup();
  render(<WorkspaceInviteForm orgId={orgId} />);
  return { user };
}

async function fill(user: ReturnType<typeof userEvent.setup>, name: string, email: string) {
  if (name) await user.type(nameInput(), name);
  if (email) await user.type(emailInput(), email);
}

describe('WorkspaceInviteForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults the role to Member', () => {
    setup();

    expect(screen.getByRole('combobox')).toHaveTextContent('Member');
  });

  it('posts name, email and the default role to the endpoint for the given workspace', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ email: 'bob@example.com', message: MESSAGE });
    const { user } = setup('org 7');

    await fill(user, 'Bob', 'bob@example.com');
    await user.click(screen.getByRole('button', { name: /Send invitation/ }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalled());
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/workspaces/org%207/invitations', {
      body: { name: 'Bob', email: 'bob@example.com', orgRole: 'MEMBER' },
    });
  });

  it('shows the API message, clears the fields and refreshes on success', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ email: 'bob@example.com', message: MESSAGE });
    const { user } = setup();

    await fill(user, 'Bob', 'bob@example.com');
    await user.click(screen.getByRole('button', { name: /Send invitation/ }));

    expect(await screen.findByRole('status')).toHaveTextContent(MESSAGE);
    expect(nameInput()).toHaveValue('');
    expect(emailInput()).toHaveValue('');
    expect(screen.getByRole('combobox')).toHaveTextContent('Member');
    expect(m.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a server error beside Save and keeps what was typed', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('Only an owner can invite an owner.', 'OWNER_STANDING', 403)
    );
    const { user } = setup();

    await fill(user, 'Bob', 'bob@example.com');
    await user.click(screen.getByRole('button', { name: /Send invitation/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an owner can invite an owner.'
    );
    expect(nameInput()).toHaveValue('Bob');
    expect(emailInput()).toHaveValue('bob@example.com');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it('puts a server validation error on the email field', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('Validation failed', 'VALIDATION_ERROR', 400, {
        email: ['Address is not allowed'],
      })
    );
    const { user } = setup();

    await fill(user, 'Bob', 'bob@example.com');
    await user.click(screen.getByRole('button', { name: /Send invitation/ }));

    expect(await screen.findByText('Address is not allowed')).toBeInTheDocument();
  });

  it('falls back to a generic message when the failure carries none', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('network down'));
    const { user } = setup();

    await fill(user, 'Bob', 'bob@example.com');
    await user.click(screen.getByRole('button', { name: /Send invitation/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be sent/i);
  });

  it('blocks a missing name with "Name is required" and sends nothing', async () => {
    const { user } = setup();

    await fill(user, '', 'bob@example.com');
    await user.click(screen.getByRole('button', { name: /Send invitation/ }));

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('blocks an invalid email and sends nothing', async () => {
    const { user } = setup();

    await fill(user, 'Bob', 'not-an-email');
    await user.click(screen.getByRole('button', { name: /Send invitation/ }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('disables the button and says it is sending while the post is in flight', async () => {
    let resolve: (value: unknown) => void = () => {};
    vi.mocked(apiClient.post).mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = setup();

    await fill(user, 'Bob', 'bob@example.com');
    await user.click(screen.getByRole('button', { name: /Send invitation/ }));

    expect(await screen.findByRole('button', { name: /Sending/ })).toBeDisabled();

    resolve({ email: 'bob@example.com', message: MESSAGE });
    expect(await screen.findByRole('status')).toHaveTextContent(MESSAGE);
    expect(screen.getByRole('button', { name: /Send invitation/ })).toBeEnabled();
  });
});

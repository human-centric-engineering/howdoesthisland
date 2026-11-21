// @vitest-environment happy-dom

/**
 * The signed-in redeem panel (t-60): what the code gives and the press that
 * redeems it, which posts the code, then shows what it gave in place of the
 * offer, or why not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: vi.fn(), get: vi.fn(), delete: vi.fn() },
}));

import { RedeemSignedIn } from '@/components/app/redeem/redeem-signed-in';
import { apiClient, APIClientError } from '@/lib/api/client';
import { AUTH_LANDING_ROUTE } from '@/lib/auth-landing/route';

const REDEMPTION = {
  redemptionId: 'r1',
  code: 'ABCD-EFGH-JKMN',
  credits: 500,
  balance: 1250,
  workspace: { id: 'w1', name: 'Acme Copy' },
};

const CHECK = {
  status: 'active',
  code: 'ABCD-EFGH-JKMN',
  credits: 500,
  expiresAt: '2027-02-19T23:59:59.999Z',
} as const;

beforeEach(() => vi.clearAllMocks());

describe('RedeemSignedIn', () => {
  it('replaces the offer with what was added once redeemed', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(REDEMPTION);
    render(<RedeemSignedIn check={CHECK} />);
    expect(screen.getByRole('heading', { name: 'Redeem your code' })).toBeInTheDocument();
    expect(screen.getByText(/Redeem it by 19 February 2027/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button'));

    expect(await screen.findByRole('heading', { name: 'Credits added' })).toBeInTheDocument();
    expect(screen.queryByText(/Redeem it by/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add/ })).not.toBeInTheDocument();
  });

  it('offers to add the credits the code gives', () => {
    render(<RedeemSignedIn check={CHECK} />);
    expect(
      screen.getByRole('button', { name: 'Add 500 CopyCredits to my workspace' })
    ).toBeEnabled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('posts the code to the redeem endpoint on press', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(REDEMPTION);
    render(<RedeemSignedIn check={CHECK} />);

    await userEvent.setup().click(screen.getByRole('button'));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/codes/redeem', {
      body: { code: 'ABCD-EFGH-JKMN' },
    });
  });

  it('shows the credits added, the workspace and the new balance, with next steps', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(REDEMPTION);
    render(<RedeemSignedIn check={CHECK} />);

    await userEvent.setup().click(screen.getByRole('button'));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Added 500 CopyCredits to Acme Copy.');
    expect(status).toHaveTextContent('Its balance is now 1,250 CopyCredits.');
    expect(screen.getByRole('link', { name: 'Review some copy' })).toHaveAttribute(
      'href',
      AUTH_LANDING_ROUTE
    );
    expect(screen.getByRole('link', { name: 'See your credits' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the server’s message when refused, and the button is usable again', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('This code has been used as many times as it allows.', 'CODE_USED_UP', 410)
    );
    render(<RedeemSignedIn check={CHECK} />);

    await userEvent.setup().click(screen.getByRole('button'));

    expect(
      await screen.findByText('This code has been used as many times as it allows.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add 500 CopyCredits to my workspace' })
    ).toBeEnabled();
  });

  it('clears the last failure when pressed again', async () => {
    vi.mocked(apiClient.post)
      .mockRejectedValueOnce(new APIClientError('Try later.', 'INTERNAL_ERROR', 500))
      .mockResolvedValueOnce(REDEMPTION);
    const user = userEvent.setup();
    render(<RedeemSignedIn check={CHECK} />);

    await user.click(screen.getByRole('button'));
    expect(await screen.findByText('Try later.')).toBeInTheDocument();
    await user.click(screen.getByRole('button'));

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Try later.')).not.toBeInTheDocument();
  });

  it('is disabled and says it is adding while the request is pending', async () => {
    let resolve: (v: unknown) => void = () => {};
    vi.mocked(apiClient.post).mockImplementation(() => new Promise((r) => (resolve = r)));
    render(<RedeemSignedIn check={CHECK} />);

    await userEvent.setup().click(screen.getByRole('button'));

    const pending = await screen.findByRole('button', { name: 'Adding…' });
    expect(pending).toBeDisabled();

    resolve(REDEMPTION);
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });
});

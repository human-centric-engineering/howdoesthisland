// @vitest-environment happy-dom

/**
 * Tests: the admin CopyCredits panel (t-57) — the list, a grant posted with
 * its reason, the page refreshed after, the limit warning, a change the form
 * itself refuses, and a refusal from the server shown by Save.
 *
 * @see components/app/admin/credits/credits-panel.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/admin/credits',
}));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: vi.fn(), get: vi.fn() },
}));

import { CreditsPanel, creditEntriesEndpoint } from '@/components/app/admin/credits/credits-panel';
import { apiClient, APIClientError } from '@/lib/api/client';
import type { AdminCreditsList, CreditChangeResult } from '@/lib/app/credits/wire';

const LIST: AdminCreditsList = {
  workspaces: [
    {
      orgId: 'org-a',
      name: 'Acme',
      slug: 'acme',
      balance: 1250,
      cap: { limitUsd: 10, remainingUsd: 6.5 },
    },
    { orgId: 'org-b', name: 'Bravo', slug: 'bravo', balance: 0, cap: null },
  ],
  truncated: false,
};

const RESULT: CreditChangeResult = {
  entry: {
    id: 'e1',
    amount: 500,
    kind: 'GRANT',
    reason: 'Pilot',
    createdAt: '2026-11-20T12:00:00.000Z',
  },
  balance: 500,
  capWarning: null,
};

function setup(list: AdminCreditsList = LIST, query = '') {
  const user = userEvent.setup();
  render(<CreditsPanel initial={list} query={query} />);
  return { user };
}

const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(name) });

async function openFor(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(within(rowOf(name)).getByRole('button', { name: 'Change' }));
  return screen.getByRole('form', { name: `Change credits for ${name}` });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreditsPanel', () => {
  it('lists each workspace with its balance and what its limit leaves', () => {
    setup();
    expect(rowOf('Acme')).toHaveTextContent('1,250');
    expect(rowOf('Acme')).toHaveTextContent('$6.50 of $10.00');
    expect(rowOf('Bravo')).toHaveTextContent('No limit');
  });

  it('grants credits with a reason, then refreshes the list and says the new balance', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(RESULT);
    const { user } = setup();
    const form = await openFor(user, 'Bravo');

    await user.type(within(form).getByRole('spinbutton'), '500');
    await user.type(within(form).getByRole('textbox', { name: /^Reason/ }), 'Pilot');
    await user.click(within(form).getByRole('button', { name: 'Grant credits' }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(creditEntriesEndpoint('org-b'), {
        body: { kind: 'grant', amount: 500, reason: 'Pilot' },
      })
    );
    expect(nav.refresh).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('Bravo now has 500 credits.');
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('says when the balance is worth more than the limit leaves this month', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      ...RESULT,
      balance: 1750,
      capWarning: { balanceUsd: 17.5, remainingUsd: 6.5, limitUsd: 10 },
    });
    const { user } = setup();
    const form = await openFor(user, 'Acme');
    await user.type(within(form).getByRole('spinbutton'), '500');
    await user.type(within(form).getByRole('textbox', { name: /^Reason/ }), 'Pilot');
    await user.click(within(form).getByRole('button', { name: 'Grant credits' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('worth $17.50, more than the $6.50');
    expect(status).toHaveTextContent('Raise the limit');
  });

  it('refuses a grant with no reason before sending anything', async () => {
    const { user } = setup();
    const form = await openFor(user, 'Acme');
    await user.type(within(form).getByRole('spinbutton'), '10');
    await user.click(within(form).getByRole('button', { name: 'Grant credits' }));

    expect(await within(form).findByText(/Say why/)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('asks for a number when the credits field is empty, not for a type', async () => {
    const { user } = setup();
    const form = await openFor(user, 'Acme');
    await user.type(within(form).getByRole('textbox', { name: /^Reason/ }), 'Pilot');
    await user.click(within(form).getByRole('button', { name: 'Grant credits' }));

    expect(await within(form).findByText(/Enter a number of credits/)).toBeInTheDocument();
    expect(within(form).queryByText(/NaN/)).toBeNull();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal by Save, and keeps the form open', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('Workspace not found', 'NOT_FOUND', 404)
    );
    const { user } = setup();
    const form = await openFor(user, 'Acme');
    await user.type(within(form).getByRole('spinbutton'), '10');
    await user.type(within(form).getByRole('textbox', { name: /^Reason/ }), 'Pilot');
    await user.click(within(form).getByRole('button', { name: 'Grant credits' }));

    expect(await within(form).findByText(/Workspace not found/)).toBeInTheDocument();
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('searches by putting the query in the address', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Find a workspace'), 'acme co');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(nav.push).toHaveBeenCalledWith('/admin/credits?q=acme%20co');
  });

  it('says when nothing matches, and when the list was cut short', () => {
    const { unmount } = render(
      <CreditsPanel initial={{ workspaces: [], truncated: false }} query="zzz" />
    );
    expect(screen.getByText('No active workspace matches “zzz”.')).toBeInTheDocument();
    unmount();

    setup({ ...LIST, truncated: true });
    expect(screen.getByText(/More workspaces match than are listed/)).toBeInTheDocument();
  });
});

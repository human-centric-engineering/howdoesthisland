// @vitest-environment happy-dom

/**
 * Tests: the admin review codes panel (t-59) — the list with what is used and
 * left, a mint posted with its idempotency key and the expiry's whole last
 * day, a retry after a failed answer sending the same key (so it cannot mint
 * twice) and a fresh key once a mint succeeds, a mint the form itself refuses,
 * the QR and link, and a revoke confirmed before it is sent.
 *
 * @see components/app/admin/codes/codes-panel.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/admin/codes',
}));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: vi.fn(), get: vi.fn(), delete: vi.fn() },
}));

import { CodesPanel, codeEndpoint, endOfDay } from '@/components/app/admin/codes/codes-panel';
import { apiClient, APIClientError } from '@/lib/api/client';
import {
  ADMIN_CODES_ENDPOINT,
  type AdminCodesList,
  type ReviewCodeView,
} from '@/lib/app/credits/codes/wire';

const CARD: ReviewCodeView = {
  id: 'cmcode0000000000000000001',
  code: 'ABCDEFGHJKMN',
  link: 'https://app.test/redeem?code=ABCDEFGHJKMN',
  campaign: 'Spring stand card',
  creditsPerRedemption: 300,
  maxRedemptions: 25,
  redemptionsUsed: 7,
  redemptionsLeft: 18,
  status: 'active',
  expiresAt: '2027-02-19T23:59:59.999Z',
  revokedAt: null,
  createdAt: '2026-11-21T09:00:00.000Z',
};
const REVOKED: ReviewCodeView = {
  ...CARD,
  id: 'cmcode0000000000000000002',
  code: 'PQRSTVWXYZ23',
  campaign: 'Old card',
  status: 'revoked',
  revokedAt: '2026-11-21T10:00:00.000Z',
};
const LIST: AdminCodesList = { codes: [CARD, REVOKED], truncated: false };

function setup(list: AdminCodesList = LIST) {
  const user = userEvent.setup();
  render(
    <CodesPanel
      initial={list}
      query=""
      defaultExpiry="2027-02-19"
      minExpiry="2026-11-21"
      maxExpiry="2029-11-20"
    />
  );
  return { user };
}

const rowOf = (code: string) => screen.getByRole('row', { name: new RegExp(code) });

function field(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no field #${id}`);
  return el;
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(field('code-campaign'), 'Spring stand card');
  await user.type(field('code-creditsPerRedemption'), '300');
  await user.clear(field('code-maxRedemptions'));
  await user.type(field('code-maxRedemptions'), '25');
}

const postedBodies = () =>
  vi
    .mocked(apiClient.post)
    .mock.calls.map(([, options]) => (options as { body: Record<string, unknown> }).body);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the list', () => {
  it('shows each code grouped, with its campaign, credits, uses used and left, and status', () => {
    setup();
    const row = rowOf('ABCD-EFGH-JKMN');
    expect(within(row).getByText('Spring stand card')).toBeInTheDocument();
    expect(within(row).getByText('300')).toBeInTheDocument();
    expect(within(row).getByText('7')).toBeInTheDocument();
    expect(within(row).getByText('18')).toBeInTheDocument();
    expect(within(row).getByText('19 Feb 2027')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
    expect(within(rowOf('PQRS-TVWX-YZ23')).getByText('Revoked')).toBeInTheDocument();
  });

  it('offers no revoke for a code already revoked', () => {
    setup();
    expect(within(rowOf('PQRS-TVWX-YZ23')).queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('shows a code’s QR and its link on request', async () => {
    const { user } = setup();
    await user.click(within(rowOf('ABCD-EFGH-JKMN')).getByRole('button', { name: 'QR and link' }));
    expect(screen.getByRole('img', { name: 'QR code for ABCD-EFGH-JKMN' })).toBeInTheDocument();
    expect(screen.getByText(CARD.link)).toBeInTheDocument();
  });

  it('says when nothing matches a search', () => {
    render(
      <CodesPanel
        initial={{ codes: [], truncated: false }}
        query="zzz"
        defaultExpiry="2027-02-19"
        minExpiry="2026-11-21"
        maxExpiry="2029-11-20"
      />
    );
    expect(screen.getByText('No code matches “zzz”.')).toBeInTheDocument();
  });
});

describe('making codes', () => {
  it('posts the form with a key and the expiry’s whole last day, shows the codes, and refreshes', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ codes: [CARD], replayed: false });
    const { user } = setup();
    await fillForm(user);

    await user.click(screen.getByRole('button', { name: 'Make codes' }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    const [path] = vi.mocked(apiClient.post).mock.calls[0] ?? [];
    expect(path).toBe(ADMIN_CODES_ENDPOINT);
    expect(postedBodies()[0]).toEqual({
      count: 1,
      creditsPerRedemption: 300,
      maxRedemptions: 25,
      expiresAt: '2027-02-19T23:59:59.999Z',
      campaign: 'Spring stand card',
      idempotencyKey: expect.any(String),
    });
    expect(await screen.findByText('Made 1 code.')).toBeInTheDocument();
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('retries a failed answer with the same key, and draws a new one once a mint succeeds', async () => {
    vi.mocked(apiClient.post)
      .mockRejectedValueOnce(new APIClientError('Network error', 'NETWORK_ERROR', 0))
      .mockResolvedValueOnce({ codes: [CARD], replayed: true })
      .mockResolvedValueOnce({ codes: [CARD], replayed: false });
    const { user } = setup();
    await fillForm(user);
    const make = screen.getByRole('button', { name: 'Make codes' });

    await user.click(make);
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    await user.click(make);
    expect(
      await screen.findByText('These codes were already made by this form; nothing new was made.')
    ).toBeInTheDocument();
    await user.click(make);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(3));

    const keys = postedBodies().map((b) => b.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('sends a new key once a field changes after a failed answer, so the edited form is not refused as a replay', async () => {
    vi.mocked(apiClient.post)
      .mockRejectedValueOnce(new APIClientError('Network error', 'NETWORK_ERROR', 0))
      .mockResolvedValueOnce({ codes: [CARD], replayed: false });
    const { user } = setup();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Make codes' }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));

    await user.type(field('code-campaign'), ' B');
    await user.click(screen.getByRole('button', { name: 'Make codes' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));

    const [first, second] = postedBodies();
    expect(second?.campaign).toBe('Spring stand card B');
    expect(second?.idempotencyKey).not.toBe(first?.idempotencyKey);
  });

  it('offers expiry days from today to three years ahead', () => {
    setup();
    expect(field('code-expiresAt').getAttribute('min')).toBe('2026-11-21');
    expect(field('code-expiresAt').getAttribute('max')).toBe('2029-11-20');
  });

  it('refuses a form without a campaign or credits before sending it', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Make codes' }));
    expect(await screen.findByText(/Say what it is for/)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal by Save', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError(
        'This idempotency key was already used for a different request',
        'CONFLICT',
        409
      )
    );
    const { user } = setup();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Make codes' }));
    expect(await screen.findByText(/already used for a different request/)).toBeInTheDocument();
  });
});

describe('revoking a code', () => {
  it('asks first, then sends the revoke and refreshes', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({
      ...CARD,
      status: 'revoked',
      revokedAt: '2026-11-21T11:00:00.000Z',
    });
    const { user } = setup();
    await user.click(within(rowOf('ABCD-EFGH-JKMN')).getByRole('button', { name: 'Revoke' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(apiClient.delete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith(codeEndpoint(CARD.id)));
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('sends nothing when kept', async () => {
    const { user } = setup();
    await user.click(within(rowOf('ABCD-EFGH-JKMN')).getByRole('button', { name: 'Revoke' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Keep it' })
    );
    expect(apiClient.delete).not.toHaveBeenCalled();
  });
});

describe('endOfDay', () => {
  it('is the last moment of the day in UTC, or nothing for a value that is not a date', () => {
    expect(endOfDay('2027-02-19')).toBe('2027-02-19T23:59:59.999Z');
    expect(endOfDay('')).toBe('');
  });
});

// @vitest-environment happy-dom

/**
 * The share panel (t-32): make a link, copy it, revoke one.
 *
 * Real: the dialog, the select, the Zod parsing of each answer and the save
 * failure. Replaced: the API client, which answers as the routes would.
 *
 * @see components/app/report/share/share-panel.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import { SharePanel } from '@/components/app/report/share/share-panel';
import { apiClient, APIClientError } from '@/lib/api/client';

const ID = 'asm_1';

const share = (over: Record<string, unknown> = {}) => ({
  id: 'share-1',
  state: 'active',
  expiresAt: '2026-12-16T09:00:00.000Z',
  revokedAt: null,
  viewCount: 3,
  createdAt: '2026-11-16T09:00:00.000Z',
  ...over,
});

async function openPanel() {
  const user = userEvent.setup();
  render(<SharePanel assessmentId={ID} />);
  await user.click(screen.getByRole('button', { name: 'Share' }));
  return { user, dialog: await screen.findByRole('dialog') };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.get).mockResolvedValue([]);
});

describe('SharePanel', () => {
  it("reads the report's links once, when opened", async () => {
    vi.mocked(apiClient.get).mockResolvedValue([
      share(),
      share({
        id: 'share-0',
        state: 'revoked',
        revokedAt: '2026-11-17T09:00:00.000Z',
        viewCount: 1,
      }),
    ]);
    const { dialog } = await openPanel();

    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/assessments/asm_1/shares');
    const rows = await within(dialog).findAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(/Active · expires .*2026 · 3 views/);
    expect(rows[1]).toHaveTextContent(/Revoked · revoked .*2026 · 1 view$/);
    // Only a live link can be revoked.
    expect(within(rows[0]).getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('says so when there are no links yet', async () => {
    const { dialog } = await openPanel();
    expect(await within(dialog).findByText('No links yet.')).toBeInTheDocument();
  });

  it('makes a 30-day link by default and shows its address once, to copy', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({
      ...share({ viewCount: 0 }),
      token: 'tok',
      url: 'https://app.example.com/r/tok',
    });
    const { user, dialog } = await openPanel();
    // user-event puts its own clipboard in place at setup.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');

    await user.click(within(dialog).getByRole('button', { name: 'Make a link' }));

    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/assessments/asm_1/shares', {
      body: { expiresInDays: 30 },
    });
    expect(await within(dialog).findByLabelText('New link')).toHaveValue(
      'https://app.example.com/r/tok'
    );
    expect(within(dialog).getByText(/shown only once/)).toBeInTheDocument();
    // The new link joins the list.
    expect(within(dialog).getByRole('listitem')).toHaveTextContent(/Active/);

    await user.click(within(dialog).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('https://app.example.com/r/tok');
    expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('makes a link for the lifetime chosen', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ ...share(), token: 't', url: 'u' });
    const { user, dialog } = await openPanel();

    await user.click(within(dialog).getByRole('combobox', { name: 'Link works for' }));
    await user.click(screen.getByRole('option', { name: '7 days' }));
    await user.click(within(dialog).getByRole('button', { name: 'Make a link' }));

    expect(apiClient.post).toHaveBeenCalledWith('/api/v1/assessments/asm_1/shares', {
      body: { expiresInDays: 7 },
    });
  });

  it('forgets the address when the dialog closes', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ ...share(), token: 't', url: 'https://x/r/t' });
    const { user, dialog } = await openPanel();
    await user.click(within(dialog).getByRole('button', { name: 'Make a link' }));
    await within(dialog).findByLabelText('New link');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Share' }));

    const reopened = await screen.findByRole('dialog');
    expect(within(reopened).queryByLabelText('New link')).toBeNull();
  });

  it('shows a refused make beside its button, with the server’s message', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('This review has no report yet.', 'REPORT_NOT_READY', 409)
    );
    const { user, dialog } = await openPanel();

    await user.click(within(dialog).getByRole('button', { name: 'Make a link' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This review has no report yet.'
    );
    expect(within(dialog).queryByLabelText('New link')).toBeNull();
  });

  it('revokes a link and shows it revoked', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([share()]);
    vi.mocked(apiClient.delete).mockResolvedValue(
      share({ state: 'revoked', revokedAt: '2026-11-17T09:00:00.000Z' })
    );
    const { user, dialog } = await openPanel();

    await user.click(await within(dialog).findByRole('button', { name: 'Revoke' }));

    expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/shares/share-1');
    await waitFor(() => expect(within(dialog).getByRole('listitem')).toHaveTextContent(/Revoked/));
    expect(within(dialog).queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('shows a failed revoke, naming what failed, and leaves the link as it was', async () => {
    vi.mocked(apiClient.get).mockResolvedValue([share()]);
    vi.mocked(apiClient.delete).mockRejectedValue(
      new APIClientError('Share link not found', 'NOT_FOUND', 404)
    );
    const { user, dialog } = await openPanel();

    await user.click(await within(dialog).findByRole('button', { name: 'Revoke' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Couldn't revoke the link/);
    expect(within(dialog).getByRole('listitem')).toHaveTextContent(/Active/);
  });

  it('refuses an answer that is not a link, rather than show a broken one', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'share-1' });
    const { user, dialog } = await openPanel();

    await user.click(within(dialog).getByRole('button', { name: 'Make a link' }));

    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('New link')).toBeNull();
  });

  it('keeps a link made while the list was still loading, alongside the links the load brings', async () => {
    let answerList: (list: unknown) => void = () => undefined;
    vi.mocked(apiClient.get).mockReturnValue(
      new Promise((resolve) => {
        answerList = resolve;
      })
    );
    vi.mocked(apiClient.post).mockResolvedValue({
      ...share({ id: 'share-new', viewCount: 0 }),
      token: 'tok',
      url: 'https://app.example.com/r/tok',
    });
    const { user, dialog } = await openPanel();

    await user.click(within(dialog).getByRole('button', { name: 'Make a link' }));
    await within(dialog).findByLabelText('New link');
    // The list answers late, with only the link that was there before.
    answerList([share({ id: 'share-old', viewCount: 5 })]);

    await waitFor(() => expect(within(dialog).getAllByRole('listitem')).toHaveLength(2));
    const [first, second] = within(dialog).getAllByRole('listitem');
    expect(first).toHaveTextContent(/0 views/);
    expect(second).toHaveTextContent(/5 views/);
  });

  it('keeps a link revoked while a newer list was loading revoked, though that list says active', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce([share()]);
    let answerRevoke: (value: unknown) => void = () => undefined;
    vi.mocked(apiClient.delete).mockReturnValue(
      new Promise((resolve) => {
        answerRevoke = resolve;
      })
    );
    const { user, dialog } = await openPanel();
    await user.click(await within(dialog).findByRole('button', { name: 'Revoke' }));

    // Closed and reopened while the revoke is in flight; the new list is slow.
    let answerList: (list: unknown) => void = () => undefined;
    vi.mocked(apiClient.get).mockReturnValue(
      new Promise((resolve) => {
        answerList = resolve;
      })
    );
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Share' }));
    const reopened = await screen.findByRole('dialog');
    answerRevoke(share({ state: 'revoked', revokedAt: '2026-11-17T09:00:00.000Z' }));
    // The list was read before the revoke landed, so it has the link active.
    answerList([share()]);

    await waitFor(() =>
      expect(within(reopened).getByRole('listitem')).toHaveTextContent(/Revoked/)
    );
  });

  it('shows Loading, not a part-list, when a link is made before the list lands', async () => {
    let answerList: (list: unknown) => void = () => undefined;
    vi.mocked(apiClient.get).mockReturnValue(
      new Promise((resolve) => {
        answerList = resolve;
      })
    );
    vi.mocked(apiClient.post).mockResolvedValue({
      ...share({ id: 'share-new', viewCount: 0 }),
      token: 'tok',
      url: 'https://app.example.com/r/tok',
    });
    const { user, dialog } = await openPanel();
    await user.click(within(dialog).getByRole('button', { name: 'Make a link' }));
    await within(dialog).findByLabelText('New link');

    expect(within(dialog).getByText('Loading…')).toBeInTheDocument();
    expect(within(dialog).queryByRole('listitem')).toBeNull();
    answerList([share({ id: 'share-old' })]);
    await waitFor(() => expect(within(dialog).getAllByRole('listitem')).toHaveLength(2));
  });

  it('does not bring back the address of a link whose make finished after the dialog closed', async () => {
    let answerMake: (value: unknown) => void = () => undefined;
    vi.mocked(apiClient.post).mockReturnValue(
      new Promise((resolve) => {
        answerMake = resolve;
      })
    );
    const { user, dialog } = await openPanel();
    await user.click(within(dialog).getByRole('button', { name: 'Make a link' }));
    await user.keyboard('{Escape}');
    answerMake({
      ...share({ viewCount: 0 }),
      token: 'tok',
      url: 'https://app.example.com/r/tok',
    });

    await user.click(screen.getByRole('button', { name: 'Share' }));
    const reopened = await screen.findByRole('dialog');
    expect(within(reopened).queryByLabelText('New link')).toBeNull();
  });

  it('does not show the last list again while a reopened dialog loads, since it may be stale', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce([share()]);
    const { user, dialog } = await openPanel();
    await within(dialog).findByRole('button', { name: 'Revoke' });

    vi.mocked(apiClient.get).mockReturnValue(new Promise(() => undefined));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Share' }));
    const reopened = await screen.findByRole('dialog');

    expect(within(reopened).queryByRole('listitem')).toBeNull();
    expect(within(reopened).queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('shows a list that could not be loaded as a failure, not as empty', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new APIClientError('Server error', 'INTERNAL', 500));
    const { dialog } = await openPanel();

    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(within(dialog).queryByText('No links yet.')).toBeNull();
  });
});

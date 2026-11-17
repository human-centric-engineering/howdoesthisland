// @vitest-environment happy-dom

/**
 * @see components/app/settings/api-keys/api-keys-manager.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
}));

import { ApiKeysManager } from '@/components/app/settings/api-keys/api-keys-manager';
import type { ApiKeyRow } from '@/components/app/settings/api-keys/schemas';
import { apiClient, APIClientError } from '@/lib/api/client';

/** What core's GET reports an install can mint: core's five plus the app's two. */
const AVAILABLE = ['chat', 'analytics', 'knowledge', 'webhook', 'admin', 'assess', 'reports'];

function row(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: 'key-1',
    name: 'CI checks',
    keyPrefix: 'sk_abcd1234',
    scopes: ['assess'],
    orgId: 'org-1',
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

function setup(
  keys: ApiKeyRow[] = [row()],
  {
    workspaceName = 'Acme copy desk',
    available = AVAILABLE,
    renderedAt = new Date().toISOString(),
  }: { workspaceName?: string | null; available?: string[]; renderedAt?: string } = {}
) {
  const user = userEvent.setup();
  render(
    <ApiKeysManager
      initialKeys={keys}
      availableScopes={available}
      workspaceName={workspaceName}
      renderedAt={renderedAt}
    />
  );
  return { user };
}

const yourKeys = () => screen.getByRole('region', { name: 'Your keys' });
const nameInput = () => screen.getByRole('textbox', { name: /^Name/ });

describe('ApiKeysManager', () => {
  beforeEach(() => {
    vi.mocked(apiClient.post).mockReset();
    vi.mocked(apiClient.delete).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('the list', () => {
    it('shows each key with its name, prefix, what it can do and its state', () => {
      setup([
        row(),
        row({
          id: 'key-2',
          name: 'Old export',
          keyPrefix: 'sk_zzzz9999',
          scopes: ['assess', 'reports'],
          revokedAt: '2026-11-02T10:00:00.000Z',
        }),
        row({ id: 'key-3', name: 'Lapsed', expiresAt: '2020-01-01T00:00:00.000Z' }),
      ]);

      const rows = within(yourKeys()).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(3);
      expect(rows[0]).toHaveTextContent('CI checks');
      expect(rows[0]).toHaveTextContent('sk_abcd1234…');
      expect(rows[0]).toHaveTextContent('Run reviews');
      expect(rows[0]).toHaveTextContent('Never');
      expect(rows[0]).toHaveTextContent('Active');
      expect(rows[1]).toHaveTextContent('Run reviews, Download and list reports');
      expect(rows[1]).toHaveTextContent('Revoked');
      expect(rows[2]).toHaveTextContent('Expired');
    });

    it("reads expiry against the server's render time, not the browser clock", () => {
      // The browser clock is past the key's expiry; the server rendered before it.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-12-01T00:00:00.000Z'));
      setup([row({ expiresAt: '2026-11-20T00:00:00.000Z' })], {
        renderedAt: '2026-11-17T12:00:00.000Z',
      });
      const rows = within(yourKeys()).getAllByRole('row').slice(1);
      expect(rows[0]).toHaveTextContent('Active');
      expect(rows[0]).not.toHaveTextContent('Expired');
    });

    it('offers no revoke on a revoked key', () => {
      setup([row({ revokedAt: '2026-11-02T10:00:00.000Z' })]);
      expect(within(yourKeys()).queryByRole('button', { name: /Revoke/ })).toBeNull();
    });

    it('labels a platform key as tied to no one workspace', () => {
      setup([row({ orgId: null, scopes: ['admin'] })]);
      expect(yourKeys()).toHaveTextContent('Platform key: not tied to one workspace');
    });

    it('does not talk about workspaces on a platform key where none is named', () => {
      setup([row({ orgId: null, scopes: ['admin'] })], { workspaceName: null });
      expect(yourKeys()).not.toHaveTextContent('workspace');
    });

    it('says so when there are no keys', () => {
      setup([], { workspaceName: null });
      expect(yourKeys()).toHaveTextContent('You haven’t made any keys yet.');
    });

    it('says the list is this workspace’s, since core lists only its keys', () => {
      setup([], { workspaceName: 'Acme copy desk' });
      expect(yourKeys()).toHaveTextContent('The keys you made in Acme copy desk');
      expect(yourKeys()).toHaveTextContent('A key made in another workspace is listed there.');
      expect(yourKeys()).toHaveTextContent('You haven’t made any keys in this workspace yet.');
    });

    it('marks a key Expired once it lapses while the page is open', () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      vi.setSystemTime(new Date('2026-11-17T12:00:00.000Z'));
      setup([row({ expiresAt: '2026-11-17T12:00:30.000Z' })], {
        renderedAt: '2026-11-17T12:00:00.000Z',
      });
      expect(within(yourKeys()).getAllByRole('row')[1]).toHaveTextContent('Active');

      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(within(yourKeys()).getAllByRole('row')[1]).toHaveTextContent('Expired');
    });
  });

  describe('the workspace a key acts in', () => {
    it('names the active workspace', () => {
      setup();
      // Named in the make-a-key card and again over the list it scopes.
      const named = screen.getAllByText('Acme copy desk');
      expect(named).toHaveLength(2);
      expect(named.every((el) => el.tagName === 'STRONG')).toBe(true);
      expect(named[0]?.parentElement).toHaveTextContent('A key acts as you, in Acme copy desk');
    });

    it('names none when there is no workspace to name', () => {
      setup([row()], { workspaceName: null });
      expect(screen.queryByText(/the reviews it runs and reads/)).toBeNull();
      expect(screen.getByText(/can do only what you choose for it below/)).toBeInTheDocument();
    });
  });

  describe('the scopes offered', () => {
    it("offers the app's scopes only, never core's or admin", () => {
      setup();
      const boxes = within(screen.getByRole('group', { name: /What it can do/ })).getAllByRole(
        'checkbox'
      );
      expect(boxes.map((b) => b.id)).toEqual(['api-key-scope-assess', 'api-key-scope-reports']);
      expect(screen.queryByLabelText(/admin/i)).toBeNull();
      expect(screen.queryByLabelText(/chat/i)).toBeNull();
    });

    it('leaves out an app scope this install cannot mint', () => {
      setup([row()], { available: ['chat', 'assess'] });
      expect(screen.getByLabelText('Run reviews')).toBeInTheDocument();
      expect(screen.queryByLabelText('Download and list reports')).toBeNull();
    });

    it('offers no form when the install can mint none of them', () => {
      setup([row()], { available: ['chat', 'admin'] });
      expect(screen.queryByRole('button', { name: 'Make key' })).toBeNull();
      expect(screen.getByText(/no API access to offer yet/)).toBeInTheDocument();
    });
  });

  describe('making a key', () => {
    it('sends the name, the ticked scopes and the chosen expiry, and shows the key once', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-17T12:00:00.000Z'));
      vi.mocked(apiClient.post).mockResolvedValue({
        key: {
          id: 'key-new',
          name: 'Newsletter tool',
          keyPrefix: 'sk_newp1234',
          scopes: ['assess', 'reports'],
          orgId: 'org-1',
          expiresAt: '2027-02-15T12:00:00.000Z',
          createdAt: '2026-11-17T12:00:00.000Z',
          rawKey: 'sk_newp1234_the_whole_secret',
        },
      });
      const { user } = setup([]);

      await user.type(nameInput(), '  Newsletter tool ');
      await user.click(screen.getByLabelText('Download and list reports'));
      await user.click(screen.getByRole('button', { name: 'Make key' }));

      await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
      expect(apiClient.post).toHaveBeenCalledWith('/api/v1/user/api-keys', {
        body: {
          name: 'Newsletter tool',
          scopes: ['assess', 'reports'],
          // The 90-day default, from the faked now.
          expiresAt: '2027-02-15T12:00:00.000Z',
        },
      });

      expect(await screen.findByTestId('new-api-key')).toHaveTextContent(
        'sk_newp1234_the_whole_secret'
      );
      // Added to the list, without its secret.
      const rows = within(yourKeys()).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent('Newsletter tool');
      expect(rows[0]).not.toHaveTextContent('the_whole_secret');
      // The form is ready for another.
      expect(nameInput()).toHaveValue('');

      await user.click(screen.getByRole('button', { name: 'I’ve saved it' }));
      expect(screen.queryByTestId('new-api-key')).toBeNull();
      expect(document.body).not.toHaveTextContent('the_whole_secret');
    });

    it('sends no expiry when No expiry is chosen', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        key: {
          id: 'key-new',
          name: 'Forever',
          keyPrefix: 'sk_newp1234',
          scopes: ['assess'],
          orgId: 'org-1',
          expiresAt: null,
          createdAt: '2026-11-17T12:00:00.000Z',
          rawKey: 'sk_secret',
        },
      });
      const { user } = setup([]);

      await user.type(nameInput(), 'Forever');
      await user.click(screen.getByRole('combobox', { name: /Expires after/ }));
      await user.click(await screen.findByRole('option', { name: 'No expiry' }));
      await user.click(screen.getByRole('button', { name: 'Make key' }));

      await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
      expect(vi.mocked(apiClient.post).mock.calls[0]?.[1]).toEqual({
        body: { name: 'Forever', scopes: ['assess'] },
      });
    });

    it('copies the key and says so', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        key: {
          id: 'key-new',
          name: 'Copy me',
          keyPrefix: 'sk_newp1234',
          scopes: ['assess'],
          orgId: 'org-1',
          expiresAt: null,
          createdAt: '2026-11-17T12:00:00.000Z',
          rawKey: 'sk_copy_this',
        },
      });
      const { user } = setup([]);
      const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

      await user.type(nameInput(), 'Copy me');
      await user.click(screen.getByRole('button', { name: 'Make key' }));
      await user.click(await screen.findByRole('button', { name: /Copy key/ }));

      expect(writeText).toHaveBeenCalledWith('sk_copy_this');
      expect(await screen.findByText('Copied.')).toHaveAttribute('role', 'status');
    });

    it('says to copy it by hand when the clipboard refuses, in a region there before the press', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        key: {
          id: 'key-new',
          name: 'No clipboard',
          keyPrefix: 'sk_newp1234',
          scopes: ['assess'],
          orgId: 'org-1',
          expiresAt: null,
          createdAt: '2026-11-17T12:00:00.000Z',
          rawKey: 'sk_by_hand',
        },
      });
      const { user } = setup([]);
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));

      await user.type(nameInput(), 'No clipboard');
      await user.click(screen.getByRole('button', { name: 'Make key' }));
      const panel = (await screen.findByTestId('new-api-key')).closest('[class*="border-amber"]');
      // Empty but mounted, so what goes in it is announced.
      const region = within(panel as HTMLElement).getByRole('status');
      expect(region).toBeEmptyDOMElement();

      await user.click(screen.getByRole('button', { name: /Copy key/ }));
      await waitFor(() =>
        expect(region).toHaveTextContent(
          'Couldn’t copy it here. Select the key and copy it yourself.'
        )
      );
    });

    it("clears an earlier key's panel when a new key cannot be read back at all", async () => {
      vi.mocked(apiClient.post)
        .mockResolvedValueOnce({
          key: {
            id: 'key-a',
            name: 'First',
            keyPrefix: 'sk_aaaa1234',
            scopes: ['assess'],
            orgId: 'org-1',
            expiresAt: null,
            createdAt: '2026-11-17T12:00:00.000Z',
            rawKey: 'sk_first_secret',
          },
        })
        .mockResolvedValueOnce({ unexpected: true });
      const { user } = setup([]);

      await user.type(nameInput(), 'First');
      await user.click(screen.getByRole('button', { name: 'Make key' }));
      expect(await screen.findByTestId('new-api-key')).toHaveTextContent('sk_first_secret');

      await user.type(nameInput(), 'Second');
      await user.click(screen.getByRole('button', { name: 'Make key' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The key was made');
      expect(screen.queryByTestId('new-api-key')).toBeNull();
    });

    it('blocks a key with no name or nothing ticked, without calling the API', async () => {
      const { user } = setup([]);
      await user.click(screen.getByLabelText('Run reviews')); // untick the default
      await user.click(screen.getByRole('button', { name: 'Make key' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Give the key a name.');
      expect(alert).toHaveTextContent('Choose at least one thing it can do.');
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('takes focus to the first scope when only the scopes are missing', async () => {
      const { user } = setup([]);
      await user.type(nameInput(), 'No scopes');
      await user.click(screen.getByLabelText('Run reviews')); // untick the default
      await user.click(screen.getByRole('button', { name: 'Make key' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Choose at least one thing it can do.'
      );
      await waitFor(() => expect(screen.getByLabelText('Run reviews')).toHaveFocus());
    });

    it('still shows the value of a key it made but cannot fully read, and says not to retry', async () => {
      // 201 with a row the page's schema refuses (no keyPrefix): the key exists.
      vi.mocked(apiClient.post).mockResolvedValue({
        key: { id: 'key-new', name: 'Drifted', scopes: ['assess'], rawKey: 'sk_drifted_secret' },
      });
      const { user } = setup([]);

      await user.type(nameInput(), 'Drifted');
      await user.click(screen.getByRole('button', { name: 'Make key' }));

      expect(await screen.findByTestId('new-api-key')).toHaveTextContent('sk_drifted_secret');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('The key was made');
      expect(alert).not.toHaveTextContent('Try again');
      expect(nameInput()).toHaveValue('');

      // Dismissing the panel takes the warning that points at it with it.
      await user.click(screen.getByRole('button', { name: 'I’ve saved it' }));
      expect(screen.queryByTestId('new-api-key')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('says the key was made, and to revoke it, when the response has no value to show', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ unexpected: true });
      const { user } = setup([]);

      await user.type(nameInput(), 'Lost');
      await user.click(screen.getByRole('button', { name: 'Make key' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('The key was made');
      expect(alert).toHaveTextContent('revoke it');
      expect(alert).not.toHaveTextContent('Try again');
      expect(screen.queryByTestId('new-api-key')).toBeNull();
    });

    it("shows the API's refusal by Save and shows no key", async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        new APIClientError('Unknown scope. Valid scopes: chat', 'VALIDATION_ERROR', 400)
      );
      const { user } = setup([]);

      await user.type(nameInput(), 'Refused');
      await user.click(screen.getByRole('button', { name: 'Make key' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Unknown scope');
      expect(screen.queryByTestId('new-api-key')).toBeNull();
      expect(within(yourKeys()).queryAllByRole('row')).toHaveLength(0);
    });
  });

  describe('revoking a key', () => {
    async function revokeFirst(user: ReturnType<typeof userEvent.setup>, name: string) {
      await user.click(within(yourKeys()).getAllByRole('button', { name: `Revoke ${name}` })[0]);
      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    }

    it('moves focus on each revoke, even of two keys with one name', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ message: 'API key revoked' });
      const { user } = setup([row({ id: 'key-1', name: 'CI' }), row({ id: 'key-2', name: 'CI' })]);
      const heading = () => screen.getByRole('heading', { name: 'Your keys' });

      await revokeFirst(user, 'CI');
      await waitFor(() => expect(heading()).toHaveFocus());
      heading().blur();

      await revokeFirst(user, 'CI');
      expect(apiClient.delete).toHaveBeenLastCalledWith('/api/v1/user/api-keys/key-2');
      await waitFor(() => expect(heading()).toHaveFocus());
    });

    it('drops the revoked line once a new key is being made', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ message: 'API key revoked' });
      vi.mocked(apiClient.post).mockResolvedValue({
        key: {
          id: 'key-new',
          name: 'Next',
          keyPrefix: 'sk_newp1234',
          scopes: ['assess'],
          orgId: 'org-1',
          expiresAt: null,
          createdAt: '2026-11-17T12:00:00.000Z',
          rawKey: 'sk_next',
        },
      });
      const { user } = setup([row({ name: 'Old' })]);

      await revokeFirst(user, 'Old');
      expect(within(yourKeys()).getByRole('status')).toHaveTextContent('Revoked “Old”.');

      await user.type(nameInput(), 'Next');
      await user.click(screen.getByRole('button', { name: 'Make key' }));
      await screen.findByTestId('new-api-key');
      expect(within(yourKeys()).getByRole('status')).toHaveTextContent('');
    });

    it('revokes after confirming, and marks the row revoked', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ message: 'API key revoked' });
      const { user } = setup();

      await user.click(within(yourKeys()).getByRole('button', { name: /Revoke CI checks/ }));
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toHaveTextContent('Revoke “CI checks”?');
      await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

      await waitFor(() =>
        expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/user/api-keys/key-1')
      );
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      const rows = within(yourKeys()).getAllByRole('row').slice(1);
      expect(rows[0]).toHaveTextContent('Revoked');
      expect(within(yourKeys()).queryByRole('button', { name: /Revoke/ })).toBeNull();
      // Its button is gone, so focus lands on the list, which says what happened.
      expect(within(yourKeys()).getByRole('status')).toHaveTextContent('Revoked “CI checks”.');
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Your keys' })).toHaveFocus());
    });

    it('does not revoke when cancelled', async () => {
      const { user } = setup();
      await user.click(within(yourKeys()).getByRole('button', { name: /Revoke CI checks/ }));
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
      );
      expect(apiClient.delete).not.toHaveBeenCalled();
      expect(within(yourKeys()).getAllByRole('row')[1]).toHaveTextContent('Active');
    });

    it('keeps the dialog open with the failure when the revoke fails', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        new APIClientError('API key not found', 'NOT_FOUND', 404)
      );
      const { user } = setup();
      // Read before the dialog opens: an open dialog hides the page from the a11y tree.
      const list = yourKeys();

      await user.click(within(list).getByRole('button', { name: /Revoke CI checks/ }));
      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('API key not found');
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(list).toHaveTextContent('Active');
      expect(list).not.toHaveTextContent('Revoked');
    });
  });
});

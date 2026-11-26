// @vitest-environment happy-dom

/**
 * @see components/app/settings/mcp-keys/mcp-keys-manager.tsx
 * @see components/app/settings/mcp-keys/schemas.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
}));

import { McpKeysManager } from '@/components/app/settings/mcp-keys/mcp-keys-manager';
import {
  mcpKeyState,
  mcpKeysEndpoint,
  revokeMcpKeyEndpoint,
  type McpKeyRow,
} from '@/components/app/settings/mcp-keys/schemas';
import { apiClient, APIClientError } from '@/lib/api/client';

const ORG = 'cmorg000000000000000team1';

function row(overrides: Partial<McpKeyRow> = {}): McpKeyRow {
  return {
    id: 'key-1',
    name: 'Sam’s Claude',
    keyPrefix: 'smcp_abcdefg',
    isActive: true,
    expiresAt: null,
    lastUsedAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    createdByName: 'Sam',
    ...overrides,
  };
}

function setup(keys: McpKeyRow[] = [row()], renderedAt = new Date().toISOString()) {
  const user = userEvent.setup();
  render(<McpKeysManager orgId={ORG} initialKeys={keys} renderedAt={renderedAt} />);
  return { user };
}

const nameInput = () => screen.getByRole('textbox', { name: /^Name/ });
const bodyRows = () => screen.getAllByRole('row').slice(1);

function minted(overrides: Record<string, unknown> = {}) {
  return {
    key: {
      ...row({ id: 'key-new', name: 'Newsletter tool' }),
      plaintext: 'smcp_the_whole_secret',
      ...overrides,
    },
  };
}

describe('McpKeysManager', () => {
  beforeEach(() => {
    vi.mocked(apiClient.post).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('the list', () => {
    it('shows each key with its prefix, maker, usage and state, and never a secret', () => {
      setup([
        row(),
        row({ id: 'key-2', name: 'Old', isActive: false, createdByName: null }),
        row({ id: 'key-3', name: 'Lapsed', expiresAt: '2020-01-01T00:00:00.000Z' }),
      ]);
      const rows = bodyRows();
      expect(rows).toHaveLength(3);
      expect(rows[0]).toHaveTextContent('Sam’s Claude');
      expect(rows[0]).toHaveTextContent('smcp_abcdefg…');
      expect(rows[0]).toHaveTextContent('Sam');
      expect(rows[0]).toHaveTextContent('Never');
      expect(rows[0]).toHaveTextContent('No expiry');
      expect(rows[0]).toHaveTextContent('Active');
      expect(rows[1]).toHaveTextContent('Revoked');
      expect(rows[1]).toHaveTextContent('A deleted account');
      expect(rows[2]).toHaveTextContent('Expired');
    });

    it('says so when there are no keys', () => {
      setup([]);
      expect(screen.getByText('No one has made a key here yet.')).toBeInTheDocument();
    });

    it('offers no revoke on a revoked key, but keeps it on an expired one', () => {
      setup([
        row({ id: 'a', name: 'Live' }),
        row({ id: 'b', name: 'Gone', isActive: false }),
        row({ id: 'c', name: 'Lapsed', expiresAt: '2020-01-01T00:00:00.000Z' }),
      ]);
      expect(screen.getByRole('button', { name: 'Revoke Live' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Revoke Gone' })).toBeNull();
      // AMBIGUOUS: only 'revoked' hides the button; an expired key can still be revoked.
      expect(screen.getByRole('button', { name: 'Revoke Lapsed' })).toBeInTheDocument();
    });

    it("reads expiry against the server's render time, not the browser clock", () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-12-01T00:00:00.000Z'));
      setup([row({ expiresAt: '2026-11-20T00:00:00.000Z' })], '2026-11-17T12:00:00.000Z');
      expect(bodyRows()[0]).toHaveTextContent('Active');
    });
  });

  describe('making a key', () => {
    it('posts the name and the default 90-day expiry, shows the value once and adds the row', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-17T12:00:00.000Z'));
      vi.mocked(apiClient.post).mockResolvedValue(minted());
      const { user } = setup([]);

      await user.type(nameInput(), '  Newsletter tool ');
      await user.click(screen.getByRole('button', { name: 'Make key' }));

      await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
      // No scopes are offered or sent: the API fixes them.
      expect(apiClient.post).toHaveBeenCalledWith(`/api/v1/workspaces/${ORG}/mcp-keys`, {
        body: { name: 'Newsletter tool', expiresAt: '2027-02-15T12:00:00.000Z' },
      });

      expect(await screen.findByTestId('new-mcp-key')).toHaveTextContent('smcp_the_whole_secret');
      const rows = bodyRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent('Newsletter tool');
      expect(rows[0]).not.toHaveTextContent('the_whole_secret');
      expect(nameInput()).toHaveValue('');
      // A second key would replace this one's only showing, so none until it is saved.
      expect(screen.getByRole('button', { name: 'Make key' })).toBeDisabled();
      expect(document.body).toHaveTextContent('Save the new key above before you make another.');

      await user.click(screen.getByRole('button', { name: 'I’ve saved it' }));
      expect(screen.queryByTestId('new-mcp-key')).toBeNull();
      expect(document.body).not.toHaveTextContent('the_whole_secret');
      expect(screen.getByRole('button', { name: 'Make key' })).toBeEnabled();
    });

    it('puts a new key at the top of the existing list', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(minted());
      const { user } = setup([row()]);
      await user.type(nameInput(), 'Newsletter tool');
      await user.click(screen.getByRole('button', { name: 'Make key' }));
      await screen.findByTestId('new-mcp-key');
      expect(bodyRows()[0]).toHaveTextContent('Newsletter tool');
      expect(bodyRows()[1]).toHaveTextContent('Sam’s Claude');
    });

    it('sends no expiry when No expiry is chosen', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(minted({}));
      const { user } = setup([]);
      await user.type(nameInput(), 'Forever');
      await user.click(screen.getByRole('combobox', { name: /Expires after/ }));
      await user.click(await screen.findByRole('option', { name: 'No expiry' }));
      await user.click(screen.getByRole('button', { name: 'Make key' }));

      await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
      expect(vi.mocked(apiClient.post).mock.calls[0]?.[1]).toEqual({ body: { name: 'Forever' } });
    });

    it('copies the key and says so', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(minted());
      const { user } = setup([]);
      const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
      await user.type(nameInput(), 'Copy me');
      await user.click(screen.getByRole('button', { name: 'Make key' }));
      await user.click(await screen.findByRole('button', { name: /Copy key/ }));
      expect(writeText).toHaveBeenCalledWith('smcp_the_whole_secret');
      expect(await screen.findByText('Copied.')).toHaveAttribute('role', 'status');
    });

    it('says to copy it by hand when the clipboard refuses', async () => {
      vi.mocked(apiClient.post).mockResolvedValue(minted());
      const { user } = setup([]);
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
      await user.type(nameInput(), 'No clipboard');
      await user.click(screen.getByRole('button', { name: 'Make key' }));
      await user.click(await screen.findByRole('button', { name: /Copy key/ }));
      expect(
        await screen.findByText('Couldn’t copy it here. Select the key and copy it yourself.')
      ).toBeInTheDocument();
    });

    it('blocks a key with no name without calling the API', async () => {
      const { user } = setup([]);
      await user.click(screen.getByRole('button', { name: 'Make key' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Give the key a name.');
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('shows the API’s refusal by Save, shows no key and adds no row', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        new APIClientError('Workspaces are not available', 'WORKSPACES_UNAVAILABLE', 400)
      );
      const { user } = setup([]);
      await user.type(nameInput(), 'Refused');
      await user.click(screen.getByRole('button', { name: 'Make key' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Workspaces are not available');
      expect(screen.queryByTestId('new-mcp-key')).toBeNull();
      expect(screen.getByText('No one has made a key here yet.')).toBeInTheDocument();
    });

    it('still shows the value of a key it made but cannot fully read, and says not to retry', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        key: { id: 'key-new', name: 'Drifted', plaintext: 'smcp_drifted_secret' },
      });
      const { user } = setup([]);
      await user.type(nameInput(), 'Drifted');
      await user.click(screen.getByRole('button', { name: 'Make key' }));

      expect(await screen.findByTestId('new-mcp-key')).toHaveTextContent('smcp_drifted_secret');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('The key was made');
      expect(alert).not.toHaveTextContent('Try again');
      // Not listed: the page could not read the row back.
      expect(screen.getByText('No one has made a key here yet.')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'I’ve saved it' }));
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
      expect(screen.queryByTestId('new-mcp-key')).toBeNull();
    });
  });

  describe('revoking a key', () => {
    it('posts to the revoke endpoint after confirming, flips the badge and drops the button', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ key: row({ isActive: false }) });
      const { user } = setup();

      await user.click(screen.getByRole('button', { name: /Revoke Sam’s Claude/ }));
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toHaveTextContent('Revoke “Sam’s Claude”?');
      await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

      await waitFor(() =>
        expect(apiClient.post).toHaveBeenCalledWith(
          `/api/v1/workspaces/${ORG}/mcp-keys/key-1/revoke`
        )
      );
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
      expect(bodyRows()[0]).toHaveTextContent('Revoked');
      expect(bodyRows()[0]).not.toHaveTextContent('Active');
      expect(screen.queryByRole('button', { name: /^Revoke/ })).toBeNull();
      expect(
        screen.getAllByRole('status').some((s) => s.textContent === 'Revoked “Sam’s Claude”.')
      ).toBe(true);
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: /This workspace’s keys/ })).toHaveFocus()
      );
    });

    it('does not revoke when cancelled', async () => {
      const { user } = setup();
      await user.click(screen.getByRole('button', { name: /Revoke Sam’s Claude/ }));
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
      );
      expect(apiClient.post).not.toHaveBeenCalled();
      expect(bodyRows()[0]).toHaveTextContent('Active');
    });

    it('keeps the dialog open with the failure beside the buttons when the revoke fails', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        new APIClientError('MCP key not found', 'NOT_FOUND', 404)
      );
      const { user } = setup();
      const list = bodyRows()[0];

      await user.click(screen.getByRole('button', { name: /Revoke Sam’s Claude/ }));
      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('MCP key not found');
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(list).toHaveTextContent('Active');
      expect(list).not.toHaveTextContent('Revoked');
    });
  });
});

describe('mcp-keys schemas', () => {
  it('builds the endpoints, encoding the ids', () => {
    expect(mcpKeysEndpoint('a/b')).toBe('/api/v1/workspaces/a%2Fb/mcp-keys');
    expect(revokeMcpKeyEndpoint('o', 'k k')).toBe('/api/v1/workspaces/o/mcp-keys/k%20k/revoke');
  });

  it('reads a key’s state: revoked beats expired, expiry is inclusive of now', () => {
    const now = new Date('2026-11-17T12:00:00.000Z');
    expect(mcpKeyState({ isActive: false, expiresAt: '2020-01-01T00:00:00.000Z' }, now)).toBe(
      'revoked'
    );
    expect(mcpKeyState({ isActive: true, expiresAt: now.toISOString() }, now)).toBe('expired');
    expect(mcpKeyState({ isActive: true, expiresAt: '2026-11-17T12:00:01.000Z' }, now)).toBe(
      'active'
    );
    expect(mcpKeyState({ isActive: true, expiresAt: null }, now)).toBe('active');
  });
});

// @vitest-environment happy-dom

/**
 * The workspace's Support access section (t-97): what each role is shown, and
 * that granting and revoking reach core's routes for this workspace. Core's
 * components are rendered for real; only the network is faked.
 *
 * @see components/app/workspaces/workspace-support-access.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const m = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock('@/lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client')>()),
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import { WorkspaceSupportAccess } from '@/components/app/workspaces/workspace-support-access';
import type { SupportGrantRow } from '@/components/admin/support-access/support-grants-table';
import { apiClient, APIClientError } from '@/lib/api/client';

const OPEN: SupportGrantRow = {
  id: 'g-open',
  level: 'READ_ONLY',
  reason: 'Ticket 42: a review will not finish',
  expiresAt: '2026-12-01T12:00:00.000Z',
  createdAt: '2026-11-27T12:00:00.000Z',
  revokedAt: null,
  grantedBy: { id: 'u-owner', name: 'Olive Owner' },
  revokedBy: null,
  open: true,
};

const REVOKED: SupportGrantRow = {
  ...OPEN,
  id: 'g-old',
  level: 'ADMIN',
  reason: 'An earlier problem',
  revokedAt: '2026-11-02T00:00:00.000Z',
  revokedBy: { id: 'u-owner', name: 'Olive Owner' },
  open: false,
};

/** The activity table's own fetch: one page, empty. */
const fetchMock = vi.fn();

describe('WorkspaceSupportAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [],
          meta: { page: 1, limit: 25, total: 0, totalPages: 0 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  describe('for an OWNER', () => {
    it('shows the open grant, the history and the grant form', async () => {
      render(<WorkspaceSupportAccess orgId="ws-1" orgRole="OWNER" grants={[OPEN, REVOKED]} />);

      const summary = screen.getByTestId('support-open-grant');
      expect(summary).toHaveTextContent('Support can enter this workspace at Read-only level');
      expect(summary).toHaveTextContent('Reason: Ticket 42: a review will not finish');
      expect(screen.getByRole('button', { name: /Replace grant/ })).toBeInTheDocument();
      expect(screen.getByText('An earlier problem')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'What support did' })).toBeInTheDocument();
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringMatching(/^\/api\/v1\/orgs\/ws-1\/support-grants\/activity\?/)
        )
      );
    });

    it('says nothing is granted when there is no open grant', () => {
      render(<WorkspaceSupportAccess orgId="ws-1" orgRole="OWNER" grants={[]} />);

      expect(screen.getByTestId('support-open-grant')).toHaveTextContent(
        'Support cannot enter this workspace'
      );
      expect(screen.getByRole('button', { name: /Grant access/ })).toBeInTheDocument();
      // No grants, so nothing support did to list.
      expect(screen.queryByRole('heading', { name: 'What support did' })).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("grants through core's route for this workspace", async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ grant: OPEN, replacedGrantIds: [] });
      const user = userEvent.setup();
      render(<WorkspaceSupportAccess orgId="ws-1" orgRole="OWNER" grants={[]} />);

      await user.type(screen.getByRole('textbox', { name: /^Reason/ }), 'Ticket 42');
      await user.click(screen.getByRole('button', { name: /Grant access/ }));

      await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
      expect(apiClient.post).toHaveBeenCalledWith('/api/v1/orgs/ws-1/support-grants', {
        body: { level: 'ADMIN', reason: 'Ticket 42', durationHours: 24 },
      });
      expect(m.refresh).toHaveBeenCalledTimes(1);
    });

    it('shows a refused grant beside the button', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        new APIClientError('Only an owner may grant support access', 'FORBIDDEN', 403)
      );
      const user = userEvent.setup();
      render(<WorkspaceSupportAccess orgId="ws-1" orgRole="OWNER" grants={[]} />);

      await user.type(screen.getByRole('textbox', { name: /^Reason/ }), 'Ticket 42');
      await user.click(screen.getByRole('button', { name: /Grant access/ }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Only an owner may grant support access'
      );
      expect(m.refresh).not.toHaveBeenCalled();
    });

    it("revokes the open grant through core's route for this workspace", async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ revoked: true });
      const user = userEvent.setup();
      render(<WorkspaceSupportAccess orgId="ws-1" orgRole="OWNER" grants={[OPEN]} />);

      await user.click(screen.getByRole('button', { name: 'Revoke' }));
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Revoke' })
      );

      await waitFor(() =>
        expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/orgs/ws-1/support-grants/g-open')
      );
      expect(m.refresh).toHaveBeenCalledTimes(1);
    });

    it('shows a failed revoke in the dialog', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(
        new APIClientError('Support grant not found', 'NOT_FOUND', 404)
      );
      const user = userEvent.setup();
      render(<WorkspaceSupportAccess orgId="ws-1" orgRole="OWNER" grants={[OPEN]} />);

      await user.click(screen.getByRole('button', { name: 'Revoke' }));
      const dialog = screen.getByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Support grant not found');
      expect(m.refresh).not.toHaveBeenCalled();
    });
  });

  describe('for an ADMIN', () => {
    it('shows the grants and revoke, with no grant form', () => {
      render(<WorkspaceSupportAccess orgId="ws-1" orgRole="ADMIN" grants={[OPEN, REVOKED]} />);

      expect(screen.getByTestId('support-open-grant')).toHaveTextContent('Read-only');
      expect(screen.getByText(/Only an owner of this workspace can grant/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Grant access|Replace grant/ })).toBeNull();
      expect(screen.queryByRole('textbox', { name: /^Reason/ })).toBeNull();
      expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    });

    it("revokes through core's route for this workspace", async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({ revoked: true });
      const user = userEvent.setup();
      render(<WorkspaceSupportAccess orgId="ws-2" orgRole="ADMIN" grants={[OPEN]} />);

      await user.click(screen.getByRole('button', { name: 'Revoke' }));
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Revoke' })
      );

      await waitFor(() =>
        expect(apiClient.delete).toHaveBeenCalledWith('/api/v1/orgs/ws-2/support-grants/g-open')
      );
    });
  });

  it('shows a MEMBER nothing', () => {
    const { container } = render(
      <WorkspaceSupportAccess orgId="ws-1" orgRole="MEMBER" grants={[OPEN]} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('says the grants could not be loaded, with no form, when they failed', () => {
    render(<WorkspaceSupportAccess orgId="ws-1" orgRole="OWNER" grants={null} />);

    expect(screen.getByText(/this workspace's support grants/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Grant access/ })).toBeNull();
    expect(screen.queryByTestId('support-open-grant')).toBeNull();
  });

  it('offers no grant in the install workspace, which needs none', () => {
    render(<WorkspaceSupportAccess orgId="install" orgRole="OWNER" grants={[]} />);

    expect(screen.getByText(/platform.s own workspace/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Grant access/ })).toBeNull();
  });
});

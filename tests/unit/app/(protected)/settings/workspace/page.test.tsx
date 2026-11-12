// @vitest-environment happy-dom

/**
 * Workspace settings page (t-8): gating by tenancy mode and role, and what
 * each role is shown.
 *
 * @see app/(protected)/settings/workspace/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  isMultiTenant: vi.fn(),
  requireAuth: vi.fn(),
  requireServerData: vi.fn(),
  loadServerData: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('@/lib/tenancy/context', () => ({ isMultiTenant: m.isMultiTenant }));
vi.mock('@/lib/auth/utils', () => ({ requireAuth: m.requireAuth }));
vi.mock('@/lib/api/server-load', () => ({
  requireServerData: m.requireServerData,
  loadServerData: m.loadServerData,
}));
vi.mock('next/navigation', () => ({
  notFound: m.notFound,
  useRouter: () => ({ refresh: vi.fn() }),
}));
// The form is covered by its own test; here we check what the page hands it.
vi.mock('@/components/app/workspaces/invite-member-form', () => ({
  InviteMemberForm: ({ orgId, canInviteOwner }: { orgId: string; canInviteOwner: boolean }) => (
    <div data-testid="invite-form" data-org={orgId} data-owner={String(canInviteOwner)} />
  ),
}));

import WorkspaceSettingsPage from '@/app/(protected)/settings/workspace/page';

const orgs = (role: string, active = true) => ({
  data: {
    activeOrgId: active ? 'org-1' : null,
    orgs: [{ id: 'org-1', name: 'Acme', status: 'ACTIVE', role, active }],
  },
  meta: undefined,
});

const ROSTER = {
  ok: true,
  data: {
    members: [
      { id: 'me', name: 'Me', email: 'me@example.com', role: 'OWNER', joinedAt: '2026-01-01' },
      { id: 'u2', name: null, email: 'bob@example.com', role: 'MEMBER', joinedAt: '2026-02-01' },
    ],
  },
};

describe('WorkspaceSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.isMultiTenant.mockReturnValue(true);
    m.requireAuth.mockResolvedValue({ user: { id: 'me' } });
    m.notFound.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
    m.loadServerData.mockResolvedValue(ROSTER);
  });

  it('is not found at single tenancy, before reading anything', async () => {
    m.isMultiTenant.mockReturnValue(false);

    await expect(WorkspaceSettingsPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(m.requireServerData).not.toHaveBeenCalled();
  });

  it('tells someone with no active workspace to choose one', async () => {
    m.requireServerData.mockResolvedValue(orgs('OWNER', false));

    render(await WorkspaceSettingsPage());

    expect(screen.getByText(/not in a workspace right now/)).toBeInTheDocument();
    expect(m.loadServerData).not.toHaveBeenCalled();
    expect(screen.queryByTestId('invite-form')).not.toBeInTheDocument();
  });

  it('shows an owner the roster, marks them as you, and lets them invite owners', async () => {
    m.requireServerData.mockResolvedValue(orgs('OWNER'));

    render(await WorkspaceSettingsPage());

    expect(m.requireServerData).toHaveBeenCalledWith('/api/v1/orgs');
    expect(m.loadServerData).toHaveBeenCalledWith('/api/v1/orgs/org-1/members');
    expect(screen.getByRole('heading', { name: 'Acme' })).toBeInTheDocument();
    expect(screen.getByText('(you)')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    const form = screen.getByTestId('invite-form');
    expect(form).toHaveAttribute('data-org', 'org-1');
    expect(form).toHaveAttribute('data-owner', 'true');
  });

  it('shows an admin the roster and the form without the Owner option', async () => {
    m.requireServerData.mockResolvedValue(orgs('ADMIN'));

    render(await WorkspaceSettingsPage());

    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    expect(screen.getByTestId('invite-form')).toHaveAttribute('data-owner', 'false');
  });

  it('tells a member to ask an owner or admin, without fetching the roster', async () => {
    m.requireServerData.mockResolvedValue(orgs('MEMBER'));

    render(await WorkspaceSettingsPage());

    expect(screen.getByText(/Only the workspace.s owners and admins/)).toBeInTheDocument();
    expect(m.loadServerData).not.toHaveBeenCalled();
    expect(screen.queryByTestId('invite-form')).not.toBeInTheDocument();
    expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();
  });

  it('shows a load-failed notice, still with the invite form, when the roster fails', async () => {
    m.requireServerData.mockResolvedValue(orgs('OWNER'));
    m.loadServerData.mockResolvedValue({ ok: false, failure: { kind: 'http', status: 500 } });

    render(await WorkspaceSettingsPage());

    expect(screen.getByText(/the members of this workspace/)).toBeInTheDocument();
    expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();
    expect(screen.getByTestId('invite-form')).toBeInTheDocument();
  });

  it('shows the load-failed notice when the roster body is malformed', async () => {
    m.requireServerData.mockResolvedValue(orgs('OWNER'));
    m.loadServerData.mockResolvedValue({ ok: true, data: { members: [{ id: 5 }] } });

    render(await WorkspaceSettingsPage());

    expect(screen.getByText(/the members of this workspace/)).toBeInTheDocument();
  });
});

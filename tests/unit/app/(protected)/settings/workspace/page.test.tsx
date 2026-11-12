// @vitest-environment happy-dom

/**
 * Workspace settings page (t-8, t-9): gating by tenancy mode and role, and what
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
// Core's own components, covered by core's tests; here we check what the page
// hands them.
vi.mock('@/components/admin/members/member-invite-form', () => ({
  MemberInviteForm: () => <div data-testid="core-invite-form" />,
}));
vi.mock('@/components/app/workspaces/workspace-invite-form', () => ({
  WorkspaceInviteForm: ({ orgId }: { orgId: string }) => (
    <div data-testid="invite-form" data-org={orgId} />
  ),
}));
vi.mock('@/components/app/workspaces/workspace-invitations', () => ({
  WorkspaceInvitations: ({ invitations }: { invitations: Array<{ id: string }> }) => (
    <ul data-testid="invitations">
      {invitations.map((invitation) => (
        <li key={invitation.id}>{invitation.id}</li>
      ))}
    </ul>
  ),
}));
vi.mock('@/components/admin/members/members-table', () => ({
  MembersTable: ({
    orgId,
    members,
    currentUserId,
  }: {
    orgId: string;
    members: Array<{ id: string; email: string }>;
    currentUserId: string | null;
  }) => (
    <ul data-testid="members-table" data-org={orgId} data-me={currentUserId ?? ''}>
      {members.map((member) => (
        <li key={member.id}>{member.email}</li>
      ))}
    </ul>
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

const INVITATIONS = {
  ok: true,
  data: {
    invitations: [
      {
        id: 'inv-1',
        workspace: { id: 'org-2', name: 'Globex' },
        role: 'MEMBER',
        invitedBy: 'Ann',
        expiresAt: '2026-12-01T00:00:00.000Z',
      },
    ],
  },
};

const ROSTER = {
  ok: true,
  data: {
    members: [
      { id: 'me', name: 'Me', email: 'me@example.com', role: 'OWNER', joinedAt: '2026-01-01' },
      { id: 'u2', name: null, email: 'bob@example.com', role: 'MEMBER', joinedAt: '2026-02-01' },
    ],
  },
};

/** Answers the two server loads by URL: the caller's invitations and the roster. */
function mockLoads(overrides: { invitations?: unknown; roster?: unknown } = {}) {
  m.loadServerData.mockImplementation(async (url: string) => {
    if (url === '/api/v1/workspaces/invitations') return overrides.invitations ?? INVITATIONS;
    return overrides.roster ?? ROSTER;
  });
}

describe('WorkspaceSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.isMultiTenant.mockReturnValue(true);
    m.requireAuth.mockResolvedValue({ user: { id: 'me' } });
    m.notFound.mockImplementation(() => {
      throw new Error('NEXT_NOT_FOUND');
    });
    mockLoads();
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
    expect(m.loadServerData).not.toHaveBeenCalledWith('/api/v1/orgs/org-1/members');
    expect(screen.queryByTestId('invite-form')).not.toBeInTheDocument();
  });

  it('shows invitations to someone with no active workspace', async () => {
    m.requireServerData.mockResolvedValue(orgs('OWNER', false));

    render(await WorkspaceSettingsPage());

    expect(m.loadServerData).toHaveBeenCalledWith('/api/v1/workspaces/invitations');
    expect(screen.getByTestId('invitations')).toHaveTextContent('inv-1');
  });

  it('shows the invitations notice when the load fails with no active workspace', async () => {
    m.requireServerData.mockResolvedValue(orgs('OWNER', false));
    mockLoads({ invitations: { ok: false, failure: { kind: 'http', status: 500 } } });

    render(await WorkspaceSettingsPage());

    expect(screen.getByText(/your invitations/)).toBeInTheDocument();
    expect(screen.queryByTestId('invitations')).not.toBeInTheDocument();
  });

  it.each(['OWNER', 'ADMIN'])(
    'gives an %s the roster and the invite form for the active workspace',
    async (role) => {
      m.requireServerData.mockResolvedValue(orgs(role));

      render(await WorkspaceSettingsPage());

      expect(m.requireServerData).toHaveBeenCalledWith('/api/v1/orgs');
      expect(m.loadServerData).toHaveBeenCalledWith('/api/v1/orgs/org-1/members');
      expect(screen.getByRole('heading', { name: 'Acme' })).toBeInTheDocument();
      const table = screen.getByTestId('members-table');
      expect(table).toHaveAttribute('data-org', 'org-1');
      expect(table).toHaveAttribute('data-me', 'me');
      expect(screen.getByText('bob@example.com')).toBeInTheDocument();
      expect(screen.getByTestId('invite-form')).toHaveAttribute('data-org', 'org-1');
      expect(screen.queryByTestId('core-invite-form')).not.toBeInTheDocument();
    }
  );

  it('tells a member to ask an owner or admin, without fetching the roster', async () => {
    m.requireServerData.mockResolvedValue(orgs('MEMBER'));

    render(await WorkspaceSettingsPage());

    expect(screen.getByText(/Only the workspace.s owners and admins/)).toBeInTheDocument();
    expect(m.loadServerData).not.toHaveBeenCalledWith('/api/v1/orgs/org-1/members');
    expect(screen.queryByTestId('invite-form')).not.toBeInTheDocument();
    expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();
  });

  it('shows a member their invitations', async () => {
    m.requireServerData.mockResolvedValue(orgs('MEMBER'));

    render(await WorkspaceSettingsPage());

    expect(screen.getByTestId('invitations')).toHaveTextContent('inv-1');
  });

  it('shows the invitations notice, not the list, when the invitations load fails', async () => {
    m.requireServerData.mockResolvedValue(orgs('OWNER'));
    mockLoads({ invitations: { ok: false, failure: { kind: 'http', status: 500 } } });

    render(await WorkspaceSettingsPage());

    expect(screen.getByText(/your invitations/)).toBeInTheDocument();
    expect(screen.queryByTestId('invitations')).not.toBeInTheDocument();
    expect(screen.getByTestId('members-table')).toBeInTheDocument();
  });

  it('shows the invitations notice when the invitations body is malformed', async () => {
    m.requireServerData.mockResolvedValue(orgs('MEMBER'));
    mockLoads({ invitations: { ok: true, data: { invitations: [{ id: 5 }] } } });

    render(await WorkspaceSettingsPage());

    expect(screen.getByText(/your invitations/)).toBeInTheDocument();
  });

  it('shows a load-failed notice, still with the invite form, when the roster fails', async () => {
    m.requireServerData.mockResolvedValue(orgs('OWNER'));
    mockLoads({ roster: { ok: false, failure: { kind: 'http', status: 500 } } });

    render(await WorkspaceSettingsPage());

    expect(screen.getByText(/the members of this workspace/)).toBeInTheDocument();
    expect(screen.queryByText('bob@example.com')).not.toBeInTheDocument();
    expect(screen.getByTestId('invite-form')).toBeInTheDocument();
  });

  it('shows the load-failed notice when the roster body is malformed', async () => {
    m.requireServerData.mockResolvedValue(orgs('OWNER'));
    mockLoads({ roster: { ok: true, data: { members: [{ id: 5 }] } } });

    render(await WorkspaceSettingsPage());

    expect(screen.getByText(/the members of this workspace/)).toBeInTheDocument();
  });
});

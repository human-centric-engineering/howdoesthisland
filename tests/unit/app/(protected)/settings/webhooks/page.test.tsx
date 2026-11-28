// @vitest-environment happy-dom

/**
 * Webhooks settings page (t-100): gating by tenancy mode and role, what it
 * loads, and what it hands the manager.
 *
 * @see app/(protected)/settings/webhooks/page.tsx
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
// Covered by its own test; here we check what the page hands it.
vi.mock('@/components/app/settings/webhooks/webhooks-manager', () => ({
  WebhooksManager: ({
    orgId,
    initialSubscriptions,
    projects,
  }: {
    orgId: string;
    initialSubscriptions: Array<{ id: string }>;
    projects: Array<{ id: string }>;
  }) => (
    <div
      data-testid="manager"
      data-org={orgId}
      data-subscriptions={initialSubscriptions.map((s) => s.id).join(',')}
      data-projects={projects.map((p) => p.id).join(',')}
    />
  ),
}));

import WebhooksPage from '@/app/(protected)/settings/webhooks/page';

const SUBSCRIPTIONS_URL = '/api/v1/workspaces/org-1/event-subscriptions';
const PROJECTS_URL = '/api/v1/projects?limit=100';

const orgs = (role: string, active = true) => ({
  data: {
    activeOrgId: active ? 'org-1' : null,
    orgs: [{ id: 'org-1', name: 'Acme', status: 'ACTIVE', role, active }],
  },
  meta: undefined,
});

const SUBSCRIPTIONS = {
  ok: true,
  data: {
    subscriptions: [
      {
        id: 'hook-1',
        name: 'CMS',
        eventType: 'app.assessment.finished',
        url: 'https://cms.example.com/hook',
        headerNames: [],
        projectId: null,
        isEnabled: true,
        hasSecret: true,
        createdAt: '2026-11-27T10:00:00.000Z',
        updatedAt: '2026-11-27T10:00:00.000Z',
        createdByName: 'Sam',
        lastDelivery: null,
      },
    ],
  },
};

const PROJECTS = { ok: true, data: [{ id: 'proj-1', name: 'Spring launch', extra: true }] };

function mockLoads(overrides: { subscriptions?: unknown; projects?: unknown } = {}) {
  m.loadServerData.mockImplementation(async (url: string) => {
    if (url === SUBSCRIPTIONS_URL) return overrides.subscriptions ?? SUBSCRIPTIONS;
    if (url === PROJECTS_URL) return overrides.projects ?? PROJECTS;
    throw new Error(`Unexpected load: ${url}`);
  });
}

describe('WebhooksPage', () => {
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

    await expect(WebhooksPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(m.requireServerData).not.toHaveBeenCalled();
    expect(m.loadServerData).not.toHaveBeenCalled();
  });

  it('keeps a MEMBER out: says who to ask, and never loads the webhooks', async () => {
    m.requireServerData.mockResolvedValue(orgs('MEMBER'));

    render(await WebhooksPage());

    expect(screen.getByText(/Only the workspace’s owners and admins/)).toBeInTheDocument();
    expect(screen.queryByTestId('manager')).not.toBeInTheDocument();
    expect(m.loadServerData).not.toHaveBeenCalled();
  });

  it('tells someone with no active workspace to choose one, loading nothing', async () => {
    m.requireServerData.mockResolvedValue(orgs('OWNER', false));

    render(await WebhooksPage());

    expect(screen.getByText(/not in a workspace right now/)).toBeInTheDocument();
    expect(m.loadServerData).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'ADMIN'])(
    'gives an %s the manager with the webhooks and projects, in one load each',
    async (role) => {
      m.requireServerData.mockResolvedValue(orgs(role));

      render(await WebhooksPage());

      const manager = screen.getByTestId('manager');
      expect(manager).toHaveAttribute('data-org', 'org-1');
      expect(manager).toHaveAttribute('data-subscriptions', 'hook-1');
      expect(manager).toHaveAttribute('data-projects', 'proj-1');
      expect(m.loadServerData).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('link', { name: 'How to receive one' })).toHaveAttribute(
        'href',
        '/developers#webhooks'
      );
      expect(screen.getByRole('link', { name: 'Acme' })).toHaveAttribute(
        'href',
        '/settings/workspace'
      );
    }
  );

  it('shows a load-failed notice in place of the manager when the webhooks do not load', async () => {
    m.requireServerData.mockResolvedValue(orgs('OWNER'));
    mockLoads({ subscriptions: { ok: false, failure: { kind: 'http', status: 500 } } });

    render(await WebhooksPage());

    expect(screen.queryByTestId('manager')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("this workspace's webhooks");
  });

  it('still offers the whole workspace when the projects do not load', async () => {
    m.requireServerData.mockResolvedValue(orgs('OWNER'));
    mockLoads({ projects: { ok: false, failure: { kind: 'http', status: 500 } } });

    render(await WebhooksPage());

    expect(screen.getByTestId('manager')).toHaveAttribute('data-projects', '');
  });
});

// @vitest-environment happy-dom

/**
 * API-keys page (t-43): what it reads and what it hands the key manager.
 *
 * @see app/(protected)/settings/api-keys/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  isMultiTenant: vi.fn(),
  requireAuth: vi.fn(),
  requireServerData: vi.fn(),
  loadServerData: vi.fn(),
  manager: vi.fn(),
}));

vi.mock('@/lib/tenancy/context', () => ({ isMultiTenant: m.isMultiTenant }));
vi.mock('@/lib/auth/utils', () => ({ requireAuth: m.requireAuth }));
vi.mock('@/lib/api/server-load', () => ({
  requireServerData: m.requireServerData,
  loadServerData: m.loadServerData,
}));
// The manager has its own tests; here we check what the page hands it.
vi.mock('@/components/app/settings/api-keys/api-keys-manager', () => ({
  ApiKeysManager: (props: unknown) => {
    m.manager(props);
    return <div data-testid="manager" />;
  },
}));

import ApiKeysPage from '@/app/(protected)/settings/api-keys/page';

const KEY = {
  id: 'key-1',
  name: 'CI checks',
  keyPrefix: 'sk_abcd1234',
  scopes: ['assess'],
  orgId: 'org-1',
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-11-01T10:00:00.000Z',
};

const KEYS = { data: { keys: [KEY], availableScopes: ['chat', 'assess'] }, meta: undefined };

const orgs = (active: boolean) => ({
  ok: true,
  data: { orgs: [{ id: 'org-1', name: 'Acme', status: 'ACTIVE', role: 'OWNER', active }] },
  meta: undefined,
});

async function renderPage() {
  render(await ApiKeysPage());
  return m.manager.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

describe('ApiKeysPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.requireAuth.mockResolvedValue({ user: { id: 'user-1' } });
    m.requireServerData.mockResolvedValue(KEYS);
  });

  it('reads the keys from core and hands them, and the mintable scopes, to the manager', async () => {
    m.isMultiTenant.mockReturnValue(true);
    m.loadServerData.mockResolvedValue(orgs(true));

    const props = await renderPage();

    expect(m.requireAuth).toHaveBeenCalled();
    expect(m.requireServerData).toHaveBeenCalledWith('/api/v1/user/api-keys');
    expect(props).toEqual({
      initialKeys: [KEY],
      availableScopes: ['chat', 'assess'],
      workspaceName: 'Acme',
    });
    expect(screen.getByRole('heading', { level: 1, name: 'API keys' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('names no workspace and reads no orgs at single tenancy', async () => {
    m.isMultiTenant.mockReturnValue(false);

    const props = await renderPage();

    expect(m.loadServerData).not.toHaveBeenCalled();
    expect(props.workspaceName).toBeNull();
  });

  it('names no workspace when none is active', async () => {
    m.isMultiTenant.mockReturnValue(true);
    m.loadServerData.mockResolvedValue(orgs(false));
    expect((await renderPage()).workspaceName).toBeNull();
  });

  it('still renders the keys when the workspace cannot be read', async () => {
    m.isMultiTenant.mockReturnValue(true);
    m.loadServerData.mockResolvedValue({
      ok: false,
      failure: { kind: 'failed', status: 500, code: null },
    });

    const props = await renderPage();

    expect(props.workspaceName).toBeNull();
    expect(props.initialKeys).toEqual([KEY]);
  });

  it('refuses a key list it cannot read', async () => {
    m.isMultiTenant.mockReturnValue(false);
    m.requireServerData.mockResolvedValue({ data: { keys: 'nope' }, meta: undefined });
    await expect(ApiKeysPage()).rejects.toThrow();
  });
});

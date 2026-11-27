/**
 * An MCP key stops authenticating once its creator leaves the key's workspace
 * (t-96): the edit HowDoesThisLand carries to core's
 * `lib/orchestration/mcp/auth.ts` (divergence row 34).
 *
 * A key acts as its creator, so it is read per request as an `sk_` key's
 * owner is (`enterApiKeyOrg`): the creator must be a member of the key's org,
 * except for the install org at `single`, where that rule does not check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({ TENANCY_MODE: 'multi' }));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

const db = vi.hoisted(() => ({
  findKey: vi.fn(),
  touchKey: vi.fn(),
  findMembership: vi.fn(),
}));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    mcpApiKey: { findUnique: db.findKey, update: db.touchKey },
    orgMembership: { findUnique: db.findMembership },
  },
}));
vi.mock('@/lib/logging', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { authenticateMcpRequest } from '@/lib/orchestration/mcp/auth';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';

const ORG = 'cmorg00000000000000000org1';

function key(overrides: Partial<{ createdBy: string | null; orgId: string | null }> = {}) {
  return {
    id: 'key-1',
    name: 'Laptop',
    keyHash: 'hash',
    keyPrefix: 'smcp_abc',
    scopes: ['tools:list', 'tools:execute'],
    scopedAgentId: null,
    scope: null,
    createdBy: 'user-1',
    isActive: true,
    expiresAt: null,
    orgId: ORG,
    org: { status: 'ACTIVE' },
    ...overrides,
  };
}

const authenticate = () => authenticateMcpRequest('smcp_abc', '127.0.0.1', 'test');

beforeEach(() => {
  mockEnv.TENANCY_MODE = 'multi';
  db.touchKey.mockResolvedValue({});
  db.findMembership.mockResolvedValue({ role: 'MEMBER', org: { status: 'ACTIVE' } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('authenticateMcpRequest and the key’s creator', () => {
  it('admits a key whose creator is a member of its workspace, asking about that workspace', async () => {
    db.findKey.mockResolvedValue(key());

    const auth = await authenticate();

    expect(auth).toMatchObject({ orgId: ORG, createdBy: 'user-1' });
    expect(db.findMembership).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId_userId: { orgId: ORG, userId: 'user-1' } } })
    );
  });

  it('refuses a key whose creator has left the workspace, and does not count it as used', async () => {
    db.findKey.mockResolvedValue(key());
    db.findMembership.mockResolvedValue(null);

    expect(await authenticate()).toBeNull();
    expect(db.touchKey).not.toHaveBeenCalled();
  });

  it('refuses a key whose creator was erased, without asking who is a member', async () => {
    db.findKey.mockResolvedValue(key({ createdBy: null }));

    expect(await authenticate()).toBeNull();
    expect(db.findMembership).not.toHaveBeenCalled();
  });

  it('admits the key again once its creator is a member again, since it reads each request', async () => {
    db.findKey.mockResolvedValue(key());
    db.findMembership.mockResolvedValueOnce(null);

    expect(await authenticate()).toBeNull();
    expect(await authenticate()).toMatchObject({ orgId: ORG });
  });

  it('checks a key bound to another workspace at single, as an sk_ key is', async () => {
    mockEnv.TENANCY_MODE = 'single';
    db.findKey.mockResolvedValue(key());
    db.findMembership.mockResolvedValue(null);

    expect(await authenticate()).toBeNull();
  });

  it('does not check the install org at single, where an sk_ key’s owner is not checked either', async () => {
    mockEnv.TENANCY_MODE = 'single';
    db.findKey.mockResolvedValue(key({ orgId: INSTALL_ORG_ID }));
    db.findMembership.mockResolvedValue(null);

    expect(await authenticate()).toMatchObject({ orgId: INSTALL_ORG_ID });
    expect(db.findMembership).not.toHaveBeenCalled();
  });
});

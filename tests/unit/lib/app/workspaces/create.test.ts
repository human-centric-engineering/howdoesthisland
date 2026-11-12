/**
 * Tests: `createTeamWorkspace` and the ownership cap (t-8).
 *
 * Collaborators are mocked at the module edge: the org create (`createWorkspaceOrg`)
 * and the equip step (`equipWorkspace`) have their own tests in `provision.test.ts`.
 * `slugStem` stays real, so the slug the org is asked for is the one the name
 * produces.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: mockLogger }));

vi.mock('@/lib/db/client', () => ({
  prisma: { orgMembership: { count: vi.fn() } },
}));

const mockCreateWorkspaceOrg = vi.hoisted(() => vi.fn());
const mockEquipWorkspace = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/workspaces/provision', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/app/workspaces/provision')>();
  return {
    ...actual,
    createWorkspaceOrg: mockCreateWorkspaceOrg,
    equipWorkspace: mockEquipWorkspace,
  };
});

const mockEraseOrg = vi.hoisted(() => vi.fn());
vi.mock('@/lib/privacy/erase-org', () => ({ eraseOrg: mockEraseOrg }));
const mockRunAsSystem = vi.hoisted(() =>
  vi.fn((_reason: string, fn: () => Promise<unknown>) => fn())
);
vi.mock('@/lib/tenancy/context', () => ({ runAsSystem: mockRunAsSystem }));

import { prisma } from '@/lib/db/client';
import {
  CAP_UNDO_ACTOR,
  countOwnedWorkspaces,
  createTeamWorkspace,
  WorkspaceLimitError,
} from '@/lib/app/workspaces/create';
import { MAX_OWNED_WORKSPACES } from '@/lib/app/workspaces/validations';
import { APIError } from '@/lib/api/errors';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { ORG_OWNER_ROLE } from '@/lib/tenancy/roles';

const USER_ID = 'cmuser00000000000000000001';
const ORG = { id: 'cmorg000000000000000000001', slug: 'design-team', name: 'Design Team' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.orgMembership.count).mockResolvedValue(0);
  mockCreateWorkspaceOrg.mockResolvedValue(ORG);
  mockEquipWorkspace.mockResolvedValue({ granted: true });
  mockEraseOrg.mockResolvedValue({ erasedAt: new Date(), members: 1 });
});

describe('countOwnedWorkspaces', () => {
  it('counts only this user’s OWNER memberships, leaving the install org out', async () => {
    vi.mocked(prisma.orgMembership.count).mockResolvedValue(3);

    const owned = await countOwnedWorkspaces(USER_ID);

    expect(owned).toBe(3);
    expect(prisma.orgMembership.count).toHaveBeenCalledWith({
      where: { userId: USER_ID, role: ORG_OWNER_ROLE, orgId: { not: INSTALL_ORG_ID } },
    });
  });
});

describe('WorkspaceLimitError', () => {
  it('is a 409 APIError carrying the limit', () => {
    const error = new WorkspaceLimitError(10);

    expect(error).toBeInstanceOf(APIError);
    expect(error.status).toBe(409);
    expect(error.code).toBe('WORKSPACE_LIMIT_REACHED');
    expect(error.details).toEqual({ limit: 10 });
    expect(error.message).toContain('10');
  });
});

describe('createTeamWorkspace', () => {
  it('creates the org owned by the caller, from a slug stem of the name', async () => {
    await createTeamWorkspace({ name: 'Design Team', ownerUserId: USER_ID });

    expect(mockCreateWorkspaceOrg).toHaveBeenCalledWith('Design Team', 'design-team', USER_ID);
  });

  it('equips the new org under the team-workspace source label', async () => {
    await createTeamWorkspace({ name: 'Design Team', ownerUserId: USER_ID });

    expect(mockEquipWorkspace).toHaveBeenCalledWith(ORG.id, 'app.team-workspace');
  });

  it('returns the workspace with the caller as OWNER', async () => {
    const result = await createTeamWorkspace({ name: 'Design Team', ownerUserId: USER_ID });

    expect(result).toEqual({
      id: ORG.id,
      slug: ORG.slug,
      name: ORG.name,
      role: 'OWNER',
    });
  });

  it('logs the creation with whether the grant landed', async () => {
    mockEquipWorkspace.mockResolvedValue({ granted: false });

    await createTeamWorkspace({ name: 'Design Team', ownerUserId: USER_ID });

    expect(mockLogger.info).toHaveBeenCalledWith('Team workspace created', {
      orgId: ORG.id,
      slug: ORG.slug,
      ownerUserId: USER_ID,
      granted: false,
    });
  });

  it('still creates at one under the cap', async () => {
    vi.mocked(prisma.orgMembership.count).mockResolvedValue(MAX_OWNED_WORKSPACES - 1);

    await expect(
      createTeamWorkspace({ name: 'Design Team', ownerUserId: USER_ID })
    ).resolves.toMatchObject({ id: ORG.id });
    expect(mockCreateWorkspaceOrg).toHaveBeenCalledTimes(1);
  });

  it('refuses at the cap, before creating anything', async () => {
    vi.mocked(prisma.orgMembership.count).mockResolvedValue(MAX_OWNED_WORKSPACES);

    const error = await createTeamWorkspace({ name: 'Design Team', ownerUserId: USER_ID }).catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(WorkspaceLimitError);
    expect((error as WorkspaceLimitError).details).toEqual({ limit: MAX_OWNED_WORKSPACES });
    expect(mockCreateWorkspaceOrg).not.toHaveBeenCalled();
    expect(mockEquipWorkspace).not.toHaveBeenCalled();
  });

  it('refuses above the cap too', async () => {
    vi.mocked(prisma.orgMembership.count).mockResolvedValue(MAX_OWNED_WORKSPACES + 3);

    await expect(createTeamWorkspace({ name: 'X', ownerUserId: USER_ID })).rejects.toBeInstanceOf(
      WorkspaceLimitError
    );
    expect(mockCreateWorkspaceOrg).not.toHaveBeenCalled();
  });

  it('lets a createOrg failure propagate, without equipping or logging success', async () => {
    mockCreateWorkspaceOrg.mockRejectedValue(new Error('db down'));

    await expect(
      createTeamWorkspace({ name: 'Design Team', ownerUserId: USER_ID })
    ).rejects.toThrow('db down');
    expect(mockEquipWorkspace).not.toHaveBeenCalled();
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  describe('a create that raced past the cap', () => {
    it('keeps a workspace that lands exactly on the cap', async () => {
      vi.mocked(prisma.orgMembership.count)
        .mockResolvedValueOnce(MAX_OWNED_WORKSPACES - 1)
        .mockResolvedValueOnce(MAX_OWNED_WORKSPACES);

      await expect(
        createTeamWorkspace({ name: 'Design Team', ownerUserId: USER_ID })
      ).resolves.toMatchObject({ id: ORG.id });
      expect(mockEraseOrg).not.toHaveBeenCalled();
      expect(mockEquipWorkspace).toHaveBeenCalled();
    });

    it('erases one that lands over the cap in a system scope, unequipped, and refuses', async () => {
      vi.mocked(prisma.orgMembership.count)
        .mockResolvedValueOnce(MAX_OWNED_WORKSPACES - 1)
        .mockResolvedValueOnce(MAX_OWNED_WORKSPACES + 1);

      await expect(
        createTeamWorkspace({ name: 'Design Team', ownerUserId: USER_ID })
      ).rejects.toBeInstanceOf(WorkspaceLimitError);

      expect(mockRunAsSystem).toHaveBeenCalledTimes(1);
      expect(mockEraseOrg).toHaveBeenCalledWith({ orgId: ORG.id, actorUserId: CAP_UNDO_ACTOR });
      expect(mockEquipWorkspace).not.toHaveBeenCalled();
      expect(prisma.orgMembership.count).toHaveBeenLastCalledWith({
        where: { userId: USER_ID, role: ORG_OWNER_ROLE, orgId: { not: INSTALL_ORG_ID } },
      });
    });

    it('still refuses, and logs, when the undo itself fails', async () => {
      vi.mocked(prisma.orgMembership.count)
        .mockResolvedValueOnce(MAX_OWNED_WORKSPACES - 1)
        .mockResolvedValueOnce(MAX_OWNED_WORKSPACES + 1);
      const failure = new Error('erase failed');
      mockEraseOrg.mockRejectedValue(failure);

      await expect(
        createTeamWorkspace({ name: 'Design Team', ownerUserId: USER_ID })
      ).rejects.toBeInstanceOf(WorkspaceLimitError);

      expect(mockEquipWorkspace).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Team workspace past the ownership cap could not be undone',
        failure,
        { orgId: ORG.id, ownerUserId: USER_ID }
      );
    });
  });
});

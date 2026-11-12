/**
 * The app's org-export source (t-9): a workspace's invitations, read for the
 * org being exported only.
 *
 * @see lib/app/org-export.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: { workspaceInvitation: { findMany: vi.fn() } },
}));

import { prisma } from '@/lib/db/client';
import { ownedBy } from '@/lib/privacy/org-sources';
import {
  getAppOrgSources,
  __resetAppOrgSourceRegistryForTests,
} from '@/lib/privacy/org-source-registry';

describe('initAppOrgSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAppOrgSourceRegistryForTests();
  });

  it('declares the workspace invitations, fetched for the exported org', async () => {
    const rows = [{ id: 'inv-1', orgId: 'org-1' }];
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue(rows as never);

    const source = getAppOrgSources().find((s) => s.model === 'WorkspaceInvitation');
    expect(source).toMatchObject({ section: 'workspaceInvitations', disposition: 'export' });

    const fetched = await source?.fetch({ orgId: 'org-1' });

    expect(fetched).toEqual(rows);
    expect(prisma.workspaceInvitation.findMany).toHaveBeenCalledWith({
      where: ownedBy('org-1'),
      orderBy: { createdAt: 'asc' },
    });
  });
});

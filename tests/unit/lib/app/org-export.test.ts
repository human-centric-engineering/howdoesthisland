/**
 * The app's org-export sources (t-9, t-22): a workspace's invitations,
 * content, assessments and judge runs, read for the org being exported only.
 *
 * @see lib/app/org-export.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {
    workspaceInvitation: { findMany: vi.fn() },
    content: { findMany: vi.fn() },
    assessment: { findMany: vi.fn() },
    judgeRun: { findMany: vi.fn() },
  },
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

  it.each([
    ['Content', 'contents', () => prisma.content.findMany, {}],
    [
      'Assessment',
      'assessments',
      () => prisma.assessment.findMany,
      { omit: { leaseToken: true, leaseExpiresAt: true } },
    ],
    ['JudgeRun', 'judgeRuns', () => prisma.judgeRun.findMany, {}],
  ] as const)('declares %s, fetched for the exported org', async (model, section, read, extra) => {
    const rows = [{ id: 'row-1', orgId: 'org-1' }];
    vi.mocked(read()).mockResolvedValue(rows as never);

    const source = getAppOrgSources().find((s) => s.model === model);
    expect(source).toMatchObject({ section, disposition: 'export' });

    expect(await source?.fetch({ orgId: 'org-1' })).toEqual(rows);
    expect(read()).toHaveBeenCalledWith({
      where: ownedBy('org-1'),
      ...extra,
      orderBy: { createdAt: 'asc' },
    });
  });
});

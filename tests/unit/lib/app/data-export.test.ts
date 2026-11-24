/**
 * The app's subject-export collector (t-9, t-22, t-32): what a person receives
 * from the workspace invitations, content, assessment and share-link tables.
 *
 * Prisma is mocked at the delegate; the assertions are on the queries asked
 * and on how rows are labelled and pared, which is the collector's own work.
 *
 * FORK NOTE — this file tests this fork's own filling of the subject-export
 * seam, so it reads `@/lib/app/data-export` for real on purpose. A change to
 * what `collectAppSubjectData` returns, or to the tables it reads, should
 * change these expectations; the shipped-empty row for the seam is pinned
 * separately in tests/unit/lib/app/defaults.test.ts (ledger row 2).
 *
 * @see lib/app/data-export.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {
    workspaceInvitation: { findMany: vi.fn() },
    content: { findMany: vi.fn() },
    assessment: { findMany: vi.fn() },
    reportShare: { findMany: vi.fn() },
    calibrationRun: { findMany: vi.fn() },
    creditEntry: { findMany: vi.fn() },
    project: { findMany: vi.fn() },
    projectDocument: { findMany: vi.fn() },
    reviewCode: { findMany: vi.fn() },
    reviewCodeRedemption: { findMany: vi.fn() },
  },
}));

import { collectAppSubjectData } from '@/lib/app/data-export';
import { prisma } from '@/lib/db/client';

const SUBJECT = { userId: 'user-1', email: 'user@example.com' };

describe('collectAppSubjectData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.content.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.assessment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.reportShare.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.calibrationRun.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.creditEntry.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.project.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.projectDocument.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.reviewCode.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.reviewCodeRedemption.findMany).mockResolvedValue([] as never);
  });

  it('reads invitations to the person by invitee, and the ones they sent without the invitee', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([] as never);

    await collectAppSubjectData(SUBJECT);

    const calls = vi.mocked(prisma.workspaceInvitation.findMany).mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      {
        where: { userId: 'user-1' },
        omit: { invitedByUserId: true },
        orderBy: { createdAt: 'asc' },
      },
      {
        where: { invitedByUserId: 'user-1' },
        omit: { userId: true },
        orderBy: { createdAt: 'asc' },
      },
    ]);
  });

  it('labels each row with the person’s part in it, received first', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany)
      .mockResolvedValueOnce([{ id: 'inv-to-me', userId: 'user-1' }] as never)
      .mockResolvedValueOnce([{ id: 'inv-from-me', invitedByUserId: 'user-1' }] as never);

    const data = await collectAppSubjectData(SUBJECT);

    expect(data).toEqual({
      workspaceInvitations: [
        { id: 'inv-to-me', userId: 'user-1', yourPart: 'invitee' },
        { id: 'inv-from-me', invitedByUserId: 'user-1', yourPart: 'inviter' },
      ],
      contents: [],
      assessments: [],
      reportShares: [],
      calibrationRuns: [],
      creditEntries: [],
      projects: [],
      projectDocuments: [],
      reviewCodes: [],
      codeRedemptions: [],
    });
  });

  it('reads the content they added and the assessments they asked for, without the lease', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.content.findMany).mockResolvedValue([{ id: 'content-1' }] as never);
    vi.mocked(prisma.assessment.findMany).mockResolvedValue([{ id: 'assessment-1' }] as never);

    const data = await collectAppSubjectData(SUBJECT);

    expect(vi.mocked(prisma.content.findMany)).toHaveBeenCalledWith({
      where: { createdByUserId: 'user-1' },
      orderBy: { createdAt: 'asc' },
    });
    expect(vi.mocked(prisma.assessment.findMany)).toHaveBeenCalledWith({
      where: { createdByUserId: 'user-1' },
      omit: { leaseToken: true, leaseExpiresAt: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(data.contents).toEqual([{ id: 'content-1' }]);
    expect(data.assessments).toEqual([{ id: 'assessment-1' }]);
  });

  it('returns the section as an empty array when there is nothing, never omitting it', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([] as never);

    expect(await collectAppSubjectData(SUBJECT)).toEqual({
      workspaceInvitations: [],
      contents: [],
      assessments: [],
      reportShares: [],
      calibrationRuns: [],
      creditEntries: [],
      projects: [],
      projectDocuments: [],
      reviewCodes: [],
      codeRedemptions: [],
    });
  });

  it('reads the share links they made, without the token hash', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.reportShare.findMany).mockResolvedValue([{ id: 'share-1' }] as never);

    const data = await collectAppSubjectData(SUBJECT);

    expect(vi.mocked(prisma.reportShare.findMany)).toHaveBeenCalledWith({
      where: { createdByUserId: 'user-1' },
      omit: { tokenHash: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(data.reportShares).toEqual([{ id: 'share-1' }]);
  });

  it('reads the calibration runs they started, without the scored rows', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.calibrationRun.findMany).mockResolvedValue([{ id: 'run-1' }] as never);

    const data = await collectAppSubjectData(SUBJECT);

    expect(vi.mocked(prisma.calibrationRun.findMany)).toHaveBeenCalledWith({
      where: { startedByUserId: 'user-1' },
      omit: { rows: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(data.calibrationRuns).toEqual([{ id: 'run-1' }]);
  });

  it('reads the changes to a workspace’s credits they made', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.creditEntry.findMany).mockResolvedValue([{ id: 'entry-1' }] as never);

    const data = await collectAppSubjectData(SUBJECT);

    expect(vi.mocked(prisma.creditEntry.findMany)).toHaveBeenCalledWith({
      where: { actorUserId: 'user-1' },
      orderBy: { createdAt: 'asc' },
    });
    expect(data.creditEntries).toEqual([{ id: 'entry-1' }]);
  });

  it('reads the projects they made, by who made them', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: 'project-1' }] as never);

    const data = await collectAppSubjectData(SUBJECT);

    expect(vi.mocked(prisma.project.findMany)).toHaveBeenCalledWith({
      where: { createdByUserId: 'user-1' },
      orderBy: { createdAt: 'asc' },
    });
    expect(data.projects).toEqual([{ id: 'project-1' }]);
  });

  it('reads the documents they added to projects, by who added them', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.projectDocument.findMany).mockResolvedValue([{ id: 'doc-1' }] as never);

    const data = await collectAppSubjectData(SUBJECT);

    expect(vi.mocked(prisma.projectDocument.findMany)).toHaveBeenCalledWith({
      where: { addedByUserId: 'user-1' },
      orderBy: { createdAt: 'asc' },
    });
    expect(data.projectDocuments).toEqual([{ id: 'doc-1' }]);
  });

  it('reads the review codes they made, without the codes or their idempotency keys', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.reviewCode.findMany).mockResolvedValue([{ id: 'code-1' }] as never);

    const data = await collectAppSubjectData(SUBJECT);

    expect(vi.mocked(prisma.reviewCode.findMany)).toHaveBeenCalledWith({
      where: { createdByUserId: 'user-1' },
      omit: { code: true, idempotencyKey: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(data.reviewCodes).toEqual([{ id: 'code-1' }]);
  });

  it('reads the codes they redeemed, by who redeemed them', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.reviewCodeRedemption.findMany).mockResolvedValue([
      { id: 'redemption-1' },
    ] as never);

    const data = await collectAppSubjectData(SUBJECT);

    expect(vi.mocked(prisma.reviewCodeRedemption.findMany)).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'asc' },
    });
    expect(data.codeRedemptions).toEqual([{ id: 'redemption-1' }]);
  });
});

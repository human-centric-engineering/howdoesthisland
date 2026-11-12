/**
 * The app's subject-export collector (t-9): what a person receives from the
 * workspace invitations table.
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
  prisma: { workspaceInvitation: { findMany: vi.fn() } },
}));

import { collectAppSubjectData } from '@/lib/app/data-export';
import { prisma } from '@/lib/db/client';

const SUBJECT = { userId: 'user-1', email: 'user@example.com' };

describe('collectAppSubjectData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    });
  });

  it('returns the section as an empty array when there is nothing, never omitting it', async () => {
    vi.mocked(prisma.workspaceInvitation.findMany).mockResolvedValue([] as never);

    expect(await collectAppSubjectData(SUBJECT)).toEqual({ workspaceInvitations: [] });
  });
});

/**
 * Tests: `sweepSignupWorkspaces` — erasing signup workspaces nobody joined
 * (t-7).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: mockLogger }));

const mockFindMany = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/client', () => ({ prisma: { org: { findMany: mockFindMany } } }));

const mockEraseOrg = vi.hoisted(() => vi.fn());
vi.mock('@/lib/privacy/erase-org', () => ({ eraseOrg: mockEraseOrg }));

const mockWriteMarker = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/workspaces/provision', () => ({
  APP_SETTINGS_KEY: 'app',
  SIGNUP_WORKSPACE_MARKER: 'signupWorkspace',
  writeSignupWorkspaceMarker: mockWriteMarker,
}));

import { ABANDONED_AFTER_MS, SWEEP_ACTOR, sweepSignupWorkspaces } from '@/lib/app/workspaces/sweep';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';

const NOW = new Date('2026-11-12T12:00:00Z');
const old = new Date(NOW.getTime() - ABANDONED_AFTER_MS - 1);
const fresh = new Date(NOW.getTime() - ABANDONED_AFTER_MS + 60_000);

function org(id: string, createdAt: Date, members: number) {
  return { id, createdAt, _count: { memberships: members } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEraseOrg.mockResolvedValue({});
  mockWriteMarker.mockResolvedValue(undefined);
});

describe('sweepSignupWorkspaces', () => {
  it('reads only marked orgs', async () => {
    mockFindMany.mockResolvedValue([]);

    await sweepSignupWorkspaces(NOW);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { settings: { path: ['app', 'signupWorkspace'], equals: true } },
      })
    );
  });

  it('erases a memberless one past the grace period, settles a joined one, and leaves a fresh one', async () => {
    mockFindMany.mockResolvedValue([
      org('abandoned', old, 0),
      org('joined', old, 1),
      org('in-flight', fresh, 0),
    ]);

    await expect(sweepSignupWorkspaces(NOW)).resolves.toEqual({
      settled: 1,
      erased: 1,
      failed: 0,
    });
    expect(mockEraseOrg).toHaveBeenCalledTimes(1);
    expect(mockEraseOrg).toHaveBeenCalledWith({ orgId: 'abandoned', actorUserId: SWEEP_ACTOR });
    expect(mockWriteMarker).toHaveBeenCalledTimes(1);
    expect(mockWriteMarker).toHaveBeenCalledWith('joined', false);
  });

  it('never touches the install org', async () => {
    mockFindMany.mockResolvedValue([org(INSTALL_ORG_ID, old, 0)]);

    await expect(sweepSignupWorkspaces(NOW)).resolves.toEqual({
      settled: 0,
      erased: 0,
      failed: 0,
    });
    expect(mockEraseOrg).not.toHaveBeenCalled();
  });

  it('counts a failure, logs it, and carries on with the rest', async () => {
    mockFindMany.mockResolvedValue([org('a', old, 0), org('b', old, 0)]);
    mockEraseOrg.mockRejectedValueOnce(new Error('boom'));

    await expect(sweepSignupWorkspaces(NOW)).resolves.toEqual({
      settled: 0,
      erased: 1,
      failed: 1,
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Signup workspace sweep failed for an org; retried next pass',
      expect.any(Error),
      { orgId: 'a' }
    );
  });
});

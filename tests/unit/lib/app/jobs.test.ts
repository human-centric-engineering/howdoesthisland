/**
 * Tests: the app's maintenance jobs (t-22, t-26, t-81, t-99) — each registration runs the
 * work it names. Names, intervals and scopes are pinned in defaults.test.ts.
 *
 * FORK NOTE: this is HowDoesThisLand's own test of its own seam, so it reads
 * the real `lib/app/jobs.ts` on purpose, with the work each job calls mocked.
 * A job added there gets a case here that it runs its work, and its name,
 * interval and scope pinned in `defaults.test.ts` (ledger row 2).
 *
 * @see lib/app/jobs.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recoverAssessments: vi.fn(),
  purgeExpiredContent: vi.fn(),
  recoverRewrites: vi.fn(),
  sweepFinishedEvents: vi.fn(),
}));
vi.mock('@/lib/app/events/notify', () => ({
  sweepFinishedEvents: mocks.sweepFinishedEvents,
}));
vi.mock('@/lib/app/rewrites/recover', () => ({
  recoverRewrites: mocks.recoverRewrites,
}));
vi.mock('@/lib/app/assessments/recover', () => ({
  recoverAssessments: mocks.recoverAssessments,
}));
vi.mock('@/lib/app/retention/purge', () => ({
  purgeExpiredContent: mocks.purgeExpiredContent,
}));

import {
  ASSESSMENT_RECOVERY_JOB,
  FINISHED_EVENTS_JOB,
  RETENTION_PURGE_JOB,
  REWRITE_RECOVERY_JOB,
} from '@/lib/app/jobs';
import { __resetAppJobsForTests, getAppJobs } from '@/lib/orchestration/maintenance/app-jobs';

const job = (name: string) => {
  const found = getAppJobs().find((j) => j.name === name);
  if (!found) throw new Error(`no job named ${name}`);
  return found;
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetAppJobsForTests();
});

describe('initAppJobs', () => {
  it('runs assessment recovery, returning its counts for the tick’s log line', async () => {
    mocks.recoverAssessments.mockResolvedValue({ redriven: 1, gaveUp: 0 });
    expect(await job(ASSESSMENT_RECOVERY_JOB).run()).toEqual({ redriven: 1, gaveUp: 0 });
    expect(mocks.recoverAssessments).toHaveBeenCalledTimes(1);
  });

  it('runs rewrite recovery, returning its count', async () => {
    mocks.recoverRewrites.mockResolvedValue({ failed: 1 });
    expect(await job(REWRITE_RECOVERY_JOB).run()).toEqual({ failed: 1 });
    expect(mocks.recoverRewrites).toHaveBeenCalledTimes(1);
  });

  it('runs the finished-event sweep, returning its counts', async () => {
    const counts = { assessments: 2, comparisons: 1, failed: 0 };
    mocks.sweepFinishedEvents.mockResolvedValue(counts);
    expect(await job(FINISHED_EVENTS_JOB).run()).toEqual(counts);
    expect(mocks.sweepFinishedEvents).toHaveBeenCalledTimes(1);
  });

  it('runs the retention purge, returning its counts', async () => {
    const counts = { assessments: 2, contents: 1, replies: 3 };
    mocks.purgeExpiredContent.mockResolvedValue(counts);
    expect(await job(RETENTION_PURGE_JOB).run()).toEqual(counts);
    expect(mocks.purgeExpiredContent).toHaveBeenCalledTimes(1);
  });
});

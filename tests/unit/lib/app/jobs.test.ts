/**
 * Tests: the app's maintenance jobs (t-7, t-22) — each registration runs the
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
  sweepSignupWorkspaces: vi.fn(),
  recoverAssessments: vi.fn(),
}));
vi.mock('@/lib/app/workspaces/sweep', () => ({
  sweepSignupWorkspaces: mocks.sweepSignupWorkspaces,
}));
vi.mock('@/lib/app/assessments/recover', () => ({
  recoverAssessments: mocks.recoverAssessments,
}));

import { ASSESSMENT_RECOVERY_JOB, SIGNUP_WORKSPACE_SWEEP_JOB } from '@/lib/app/jobs';
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
  it('runs the signup-workspace sweep', async () => {
    mocks.sweepSignupWorkspaces.mockResolvedValue({ erased: 2 });
    expect(await job(SIGNUP_WORKSPACE_SWEEP_JOB).run()).toEqual({ erased: 2 });
  });

  it('runs assessment recovery, returning its counts for the tick’s log line', async () => {
    mocks.recoverAssessments.mockResolvedValue({ redriven: 1, gaveUp: 0 });
    expect(await job(ASSESSMENT_RECOVERY_JOB).run()).toEqual({ redriven: 1, gaveUp: 0 });
    expect(mocks.recoverAssessments).toHaveBeenCalledTimes(1);
  });
});

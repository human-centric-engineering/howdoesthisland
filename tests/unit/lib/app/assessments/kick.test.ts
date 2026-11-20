/**
 * Tests: starting a workspace's waiting reviews on a refusal (t-28) — the
 * per-workspace throttle.
 *
 * Mocked: the recovery pass (its own tests are in `run.test.ts`) and
 * `keepRunningAfterResponse` (run at once). The route-level chain, a refusal
 * starting stalled and queued reviews, is in
 * `tests/unit/app/api/v1/assessments/routes.test.ts`.
 *
 * @see lib/app/assessments/kick.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ recover: vi.fn(async () => ({ redriven: 0, gaveUp: 0 })) }));
vi.mock('@/lib/app/assessments/recover', () => ({ recoverAssessments: mocks.recover }));
vi.mock('@/lib/api/after-response', () => ({
  keepRunningAfterResponse: (work: () => Promise<unknown>) => void work(),
}));

import {
  KICK_INTERVAL_MS,
  resetKicksForTests,
  startWaitingReviews,
} from '@/lib/app/assessments/kick';

beforeEach(() => {
  vi.clearAllMocks();
  resetKicksForTests();
});

describe('startWaitingReviews', () => {
  it('runs the recovery pass once per interval per workspace', () => {
    expect(startWaitingReviews('org-a', 1_000)).toBe(true);
    expect(startWaitingReviews('org-a', 1_000 + KICK_INTERVAL_MS - 1)).toBe(false);
    expect(mocks.recover).toHaveBeenCalledTimes(1);

    expect(startWaitingReviews('org-a', 1_000 + KICK_INTERVAL_MS)).toBe(true);
    expect(mocks.recover).toHaveBeenCalledTimes(2);
  });

  it('throttles each workspace apart', () => {
    expect(startWaitingReviews('org-a', 1_000)).toBe(true);
    expect(startWaitingReviews('org-b', 1_000)).toBe(true);
    expect(mocks.recover).toHaveBeenCalledTimes(2);
  });
});

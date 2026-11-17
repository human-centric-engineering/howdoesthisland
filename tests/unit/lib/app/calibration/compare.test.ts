/**
 * The change from the last run of the same mode (t-37).
 */
import { describe, expect, it } from 'vitest';
import { compareRuns, type ScoredRow } from '@/lib/app/calibration/compare';
import { tally, type Check, type Outcome } from '@/lib/app/calibration/score';

const check = (kind: Check['kind'], key: string, result: Outcome): Check => ({
  kind,
  key,
  expected: 'low',
  got: 0,
  result,
});

function run(rows: ScoredRow[]) {
  return { totals: tally(rows), rows };
}

const before: ScoredRow[] = [
  {
    case: 'ev01',
    checks: [
      check('appeal', 'ethos', 'ok'),
      check('appeal', 'pathos', 'near'),
      check('flag', 'present:rf_hype', 'ok'),
    ],
  },
  { case: 'ev02', checks: [check('duty', 'primary', 'miss')] },
];

const previous = {
  id: 'run-1',
  createdAt: new Date('2026-11-16T10:00:00Z'),
  frameworkVersion: '0.5.1',
  ...run(before),
};

describe('compareRuns()', () => {
  it('dates the previous run by when it finished, when it recorded that', () => {
    const finished = { ...previous, finishedAt: new Date('2026-11-16T10:12:00Z') };
    expect(compareRuns(finished, run(before)).previousRanAt).toBe('2026-11-16T10:12:00.000Z');
  });

  it('reports no change against an identical run', () => {
    const c = compareRuns(previous, run(before));
    expect(c).toMatchObject({
      previousRunId: 'run-1',
      previousRanAt: '2026-11-16T10:00:00.000Z',
      previousFrameworkVersion: '0.5.1',
      agreementDelta: 0,
      flips: [],
    });
    expect(c.byKind.appeal).toEqual({ okRate: 0.5, previousOkRate: 0.5, delta: 0 });
    // A kind neither run has is null, not 0.
    expect(c.byKind.lever).toEqual({ okRate: null, previousOkRate: null, delta: null });
  });

  it('gives the change in agreement and by kind, and every flipped check, worse first', () => {
    const now: ScoredRow[] = [
      {
        case: 'ev01',
        checks: [
          check('appeal', 'ethos', 'miss'),
          check('appeal', 'pathos', 'ok'),
          check('flag', 'present:rf_hype', 'ok'),
        ],
      },
      // A case the previous run did not have: counted, but not a flip.
      { case: 'ev03', checks: [check('duty', 'primary', 'ok')] },
    ];
    const c = compareRuns(previous, run(now));
    expect(c.agreement).toBe(0.75);
    expect(c.previousAgreement).toBe(0.5);
    expect(c.agreementDelta).toBe(0.25);
    expect(c.byKind.duty).toEqual({ okRate: 1, previousOkRate: 0, delta: 1 });
    expect(c.flips).toEqual([
      { case: 'ev01', kind: 'appeal', key: 'ethos', from: 'ok', to: 'miss' },
      { case: 'ev01', kind: 'appeal', key: 'pathos', from: 'near', to: 'ok' },
    ]);
  });

  it('does not count a check whose expectation changed as a flip', () => {
    const now: ScoredRow[] = [
      { case: 'ev02', checks: [{ ...check('duty', 'primary', 'ok'), expected: 'move' }] },
    ];
    expect(compareRuns(previous, run(now)).flips).toEqual([]);
  });
});

/**
 * What `GET /api/v1/admin/frameworks` sends, for the page's tests (t-38).
 */
import type { AdminRunWire, AdminVersionWire } from '@/lib/app/calibration/wire';

const tallyOf = (ok: number, near: number, miss: number) => ({
  ok,
  near,
  miss,
  n: ok + near + miss,
});
const none = tallyOf(0, 0, 0);

export function run(over: Partial<AdminRunWire> = {}): AdminRunWire {
  return {
    id: 'run-1',
    frameworkVersionId: 'ver-1',
    frameworkVersion: '0.5.1',
    sourceSha256: 'sha',
    setVersion: '0.5.1',
    mode: 'quick',
    status: 'complete',
    totals: {
      byKind: {
        appeal: tallyOf(6, 2, 2),
        overall: none,
        flag: tallyOf(9, 0, 1),
        duty: tallyOf(1, 0, 1),
        group: tallyOf(3, 1, 0),
        dimension: none,
        lever: none,
      },
      agreement: 0.7,
      checks: 26,
      cases: 2,
      judgeFailures: 0,
    },
    rows: [
      {
        case: 'ev01',
        checks: [
          { kind: 'appeal', key: 'ethos', expected: 'high', got: 70, result: 'ok' },
          { kind: 'appeal', key: 'logos', expected: 'high', got: 65, result: 'near' },
          { kind: 'duty', key: 'primary', expected: 'teach', got: null, result: 'miss' },
        ],
        judgeFailures: [],
      },
      {
        case: 'ev02',
        checks: [{ kind: 'flag', key: 'rf_x', expected: 'present', got: true, result: 'ok' }],
        judgeFailures: [{ slot: 'judge_culture', code: 'over_budget' }],
      },
    ],
    judgeModels: {},
    costUsd: 0,
    error: null,
    startedBy: { id: 'admin-1', name: 'Ada Admin' },
    ofCurrentFile: true,
    comparison: null,
    createdAt: '2026-11-16T12:00:00.000Z',
    finishedAt: '2026-11-16T12:00:01.000Z',
    ...over,
  };
}

const kindChange = (delta: number | null) => ({ okRate: 0.5, previousOkRate: 0.5, delta });

export const comparison: NonNullable<AdminRunWire['comparison']> = {
  previousRunId: 'run-0',
  previousRanAt: '2026-11-15T12:00:00.000Z',
  previousFrameworkVersion: '0.5.0',
  agreement: 0.7,
  previousAgreement: 0.65,
  agreementDelta: 0.05,
  byKind: {
    appeal: kindChange(-0.1),
    overall: kindChange(null),
    flag: kindChange(0),
    duty: kindChange(0.5),
    group: kindChange(null),
    dimension: kindChange(null),
    lever: kindChange(null),
  },
  flips: [{ case: 'ev01', kind: 'appeal', key: 'logos', from: 'ok', to: 'near' }],
};

export function version(over: Partial<AdminVersionWire> = {}): AdminVersionWire {
  return {
    id: 'ver-1',
    version: '0.5.1',
    status: 'published',
    sourceSha256: 'sha',
    createdAt: '2026-11-01T00:00:00.000Z',
    publishedAt: '2026-11-02T00:00:00.000Z',
    calibration: null,
    runnable: true,
    runs: [],
    ...over,
  };
}

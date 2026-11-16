/**
 * What changed since the last run of the same mode (t-37).
 *
 * "The same mode" across versions, not within one: the question a run
 * answers is whether a change of model, prompt or framework version made
 * agreement worse, and the run before is the one to hold it against. A run
 * with none before it compares with nothing.
 *
 * Pure. A check is matched across the two runs by case id, kind and key, so
 * a case or expectation one run has and the other does not is not a flip:
 * it is counted in the totals of the run that has it, and nowhere else.
 */
import { type Check, type CheckKind, type Outcome, type Totals } from '@/lib/app/calibration/score';

export interface ScoredRow {
  case: string;
  checks: readonly Check[];
}

export interface RunForComparison {
  id: string;
  createdAt: Date;
  frameworkVersion: string;
  totals: Totals;
  rows: readonly ScoredRow[];
}

export interface KindChange {
  /** Share of this kind's checks that were `ok`, 0–1; null when the run had none. */
  okRate: number | null;
  previousOkRate: number | null;
  /** `okRate − previousOkRate`, null unless both are there. */
  delta: number | null;
}

export interface Flip {
  case: string;
  kind: CheckKind;
  key: string;
  from: Outcome;
  to: Outcome;
}

export interface RunComparison {
  previousRunId: string;
  previousRanAt: string;
  previousFrameworkVersion: string;
  agreement: number;
  previousAgreement: number;
  /** `agreement − previousAgreement`, to four places. */
  agreementDelta: number;
  byKind: Record<CheckKind, KindChange>;
  /** Checks whose result changed, worse ones first. */
  flips: Flip[];
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
const okRate = (t: Totals, k: CheckKind): number | null => {
  const tally = t.byKind[k];
  return tally.n ? round4(tally.ok / tally.n) : null;
};
const RANK: Readonly<Record<Outcome, number>> = { ok: 2, near: 1, miss: 0 };

export function compareRuns(
  previous: RunForComparison,
  current: { totals: Totals; rows: readonly ScoredRow[] }
): RunComparison {
  const change = (k: CheckKind): KindChange => {
    const now = okRate(current.totals, k);
    const before = okRate(previous.totals, k);
    return {
      okRate: now,
      previousOkRate: before,
      delta: now !== null && before !== null ? round4(now - before) : null,
    };
  };
  const byKind: Record<CheckKind, KindChange> = {
    appeal: change('appeal'),
    overall: change('overall'),
    flag: change('flag'),
    duty: change('duty'),
    group: change('group'),
    dimension: change('dimension'),
    lever: change('lever'),
  };

  const before = new Map<string, Check>();
  for (const row of previous.rows) {
    for (const c of row.checks) before.set(`${row.case}\u0000${c.kind}\u0000${c.key}`, c);
  }
  const flips: Flip[] = [];
  for (const row of current.rows) {
    for (const c of row.checks) {
      const was = before.get(`${row.case}\u0000${c.kind}\u0000${c.key}`);
      if (was && was.result !== c.result) {
        flips.push({ case: row.case, kind: c.kind, key: c.key, from: was.result, to: c.result });
      }
    }
  }
  flips.sort((a, b) => RANK[a.to] - RANK[a.from] - (RANK[b.to] - RANK[b.from]));

  return {
    previousRunId: previous.id,
    previousRanAt: previous.createdAt.toISOString(),
    previousFrameworkVersion: previous.frameworkVersion,
    agreement: current.totals.agreement,
    previousAgreement: previous.totals.agreement,
    agreementDelta: round4(current.totals.agreement - previous.totals.agreement),
    byKind,
    flips,
  };
}

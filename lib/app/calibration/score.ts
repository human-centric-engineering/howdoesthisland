/**
 * Scoring a calibration case's expectations against an assessment (t-37).
 *
 * Pure: a case and the engine's assembled result in, one {@link Check} per
 * expectation out. The rules are the set's `meta.how_to_use`
 * (`.context/app/calibration.md`):
 *
 * - **Bands** (appeals, overall, a group's band): `ok` in the expected band,
 *   `near` one band away, `miss` two away. The bands are the engine's
 *   `band3`, so a score scores here exactly as the prototype's `calibrate()`
 *   scored it.
 * - **Everything else** is `ok` or `miss`: each expected flag found, each
 *   absent one not; the primary duty; a group's `low` dimension at 1 or
 *   below and `high` at 3 or above (0–4); a lever in the status expected.
 *
 * Not scored: `recommend_dimensions` and `balance_rules`. The prototype never
 * scored them, and what a careful reader expects of a recommendation list is
 * not a fact a run can check.
 *
 * {@link tally} sums the checks the way the prototype's `totals` did, so the
 * quick-scan totals can be compared with it (`appealHits` is
 * `byKind.appeal.ok`, and so on); `agreement` is every `ok` over every check.
 */
import { APPEALS } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { band3 } from '@/lib/app/frameworks/howdoesthisland/engine/text';
import type { Assessment } from '@/lib/app/frameworks/howdoesthisland/engine/types';
import { CALIBRATED_GROUPS, type Band, type CalibrationCase } from '@/lib/app/calibration/schema';

export type Outcome = 'ok' | 'near' | 'miss';

export const CHECK_KINDS = [
  'appeal',
  'overall',
  'flag',
  'duty',
  'group',
  'dimension',
  'lever',
] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

/** One expectation, scored. `key` is unique within a case and stable across runs. */
export interface Check {
  kind: CheckKind;
  key: string;
  expected: string;
  /** What the run gave: a score, a flag's presence, a duty or a lever status. */
  got: number | string | boolean | null;
  result: Outcome;
}

const STEP: Readonly<Record<Band, number>> = { low: 0, mid: 1, high: 2 };

function bandCheck(kind: CheckKind, key: string, expected: Band, score: number | undefined): Check {
  if (score === undefined || !Number.isFinite(score)) {
    return { kind, key, expected, got: null, result: 'miss' };
  }
  const d = Math.abs(STEP[band3(score)] - STEP[expected]);
  return { kind, key, expected, got: score, result: d === 0 ? 'ok' : d === 1 ? 'near' : 'miss' };
}

const okIf = (ok: boolean): Outcome => (ok ? 'ok' : 'miss');

/** What scoring reads of an assembled result. */
export interface ScoredResult {
  scores: Pick<Assessment['scores'], 'overall' | (typeof APPEALS)[number]>;
  red_flags: readonly { id: string }[];
  duties: Pick<Assessment['duties'], 'primary'>;
  group_scores: Readonly<Record<string, number>>;
  dimensions: readonly { id: string; score: number }[];
  perspectives: readonly { levers: readonly { id: string; status: string }[] }[];
}

/** Every expectation of `c`, scored against `r`, in the order the case lists them. */
export function scoreCase(c: CalibrationCase, r: ScoredResult): Check[] {
  const e = c.expect;
  const checks: Check[] = APPEALS.map((a) => bandCheck('appeal', a, e.appeals[a], r.scores[a]));
  checks.push(bandCheck('overall', 'overall', e.overall, r.scores.overall));

  const found = new Set(r.red_flags.map((f) => f.id));
  for (const f of e.flags_present) {
    const got = found.has(f);
    checks.push({ kind: 'flag', key: `present:${f}`, expected: 'present', got, result: okIf(got) });
  }
  for (const f of e.flags_absent) {
    const got = found.has(f);
    checks.push({ kind: 'flag', key: `absent:${f}`, expected: 'absent', got, result: okIf(!got) });
  }

  if (typeof e.primary_duty === 'string') {
    const got = r.duties.primary;
    checks.push({
      kind: 'duty',
      key: 'primary',
      expected: e.primary_duty,
      got,
      result: okIf(got === e.primary_duty),
    });
  }

  const dimScore = new Map(r.dimensions.map((d) => [d.id, d.score]));
  for (const group of CALIBRATED_GROUPS) {
    const g = e.groups?.[group];
    if (!g) continue;
    checks.push(bandCheck('group', group, g.band, r.group_scores[group]));
    for (const [side, ids] of [
      ['low', g.low ?? []],
      ['high', g.high ?? []],
    ] as const) {
      for (const d of ids) {
        const got = dimScore.get(d);
        const ok = got !== undefined && (side === 'low' ? got <= 1 : got >= 3);
        checks.push({
          kind: 'dimension',
          key: `${group}:${d}`,
          expected: side,
          got: got ?? null,
          result: okIf(ok),
        });
      }
    }
  }

  if (e.levers) {
    const status = new Map(r.perspectives.flatMap((p) => p.levers.map((l) => [l.id, l.status])));
    for (const expected of ['present', 'misused', 'absent'] as const) {
      for (const l of e.levers[expected] ?? []) {
        const got = status.get(l) ?? null;
        checks.push({ kind: 'lever', key: l, expected, got, result: okIf(got === expected) });
      }
    }
  }
  return checks;
}

export interface Tally {
  ok: number;
  near: number;
  miss: number;
  n: number;
}

export interface Totals {
  byKind: Record<CheckKind, Tally>;
  /** Every `ok` over every check, 0–1 to four places. 0 with no checks. */
  agreement: number;
  checks: number;
  cases: number;
  /** Judge calls that failed, so their part fell back to the quick scan. Always 0 in quick mode. */
  judgeFailures: number;
}

/** Rounds to four places, as every agreement figure is. */
export const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;
/** An agreement in tenths of a percent, rounded once: what every printed figure shows. */
export const agreementTenths = (x: number): number => Math.round(x * 1000);
/** An agreement as printed, `82.5%`, by `calibrate` and `publish` alike. */
export const agreementPct = (x: number): string => `${(agreementTenths(x) / 10).toFixed(1)}%`;
const emptyTally = (): Tally => ({ ok: 0, near: 0, miss: 0, n: 0 });

export function tally(rows: readonly { checks: readonly Check[] }[], judgeFailures = 0): Totals {
  const byKind: Record<CheckKind, Tally> = {
    appeal: emptyTally(),
    overall: emptyTally(),
    flag: emptyTally(),
    duty: emptyTally(),
    group: emptyTally(),
    dimension: emptyTally(),
    lever: emptyTally(),
  };
  let ok = 0;
  let n = 0;
  for (const row of rows) {
    for (const check of row.checks) {
      const t = byKind[check.kind];
      t[check.result]++;
      t.n++;
      n++;
      if (check.result === 'ok') ok++;
    }
  }
  return {
    byKind,
    agreement: n ? round4(ok / n) : 0,
    checks: n,
    cases: rows.length,
    judgeFailures,
  };
}

/**
 * Scoring a case's expectations (t-37): each kind of expectation against a
 * result built to land on each side of its rule, and the tally.
 */
import { describe, expect, it } from 'vitest';
import type { CalibrationCase } from '@/lib/app/calibration/schema';
import { scoreCase, tally, type ScoredResult } from '@/lib/app/calibration/score';

function caseWith(expect: Partial<CalibrationCase['expect']>): CalibrationCase {
  return {
    id: 'evX',
    title: 'A case',
    content_type: 'general',
    audience: {},
    text: 'Some text.',
    notes: '',
    expect: {
      appeals: { ethos: 'low', pathos: 'mid', logos: 'high', kairos: 'low' },
      overall: 'mid',
      flags_present: [],
      flags_absent: [],
      recommend_dimensions: ['eth_integrity'],
      balance_rules: ['br_any'],
      ...expect,
    },
  };
}

function result(over: Partial<ScoredResult> = {}): ScoredResult {
  return {
    // ethos 44 is low (ok), pathos 71 is high (near mid), logos 10 is low (miss high),
    // kairos 45 is mid (near low); overall 70 is mid (ok).
    scores: { ethos: 44, pathos: 71, logos: 10, kairos: 45, overall: 70 },
    red_flags: [{ id: 'rf_hype' }],
    duties: { primary: 'teach' },
    group_scores: { craft: 30, audience: 80 },
    dimensions: [
      { id: 'craft_claims', score: 1 },
      { id: 'craft_flow', score: 2 },
      { id: 'aud_fit', score: 3 },
    ],
    perspectives: [
      {
        levers: [
          { id: 'lv_scarcity', status: 'misused' },
          { id: 'lv_truthful', status: 'present' },
        ],
      },
    ],
    ...over,
  };
}

describe('scoreCase()', () => {
  it('scores appeals and overall by band: ok, near one band away, miss two away', () => {
    const checks = scoreCase(caseWith({}), result());
    expect(checks.map((c) => [c.kind, c.key, c.got, c.result])).toEqual([
      ['appeal', 'ethos', 44, 'ok'],
      ['appeal', 'pathos', 71, 'near'],
      ['appeal', 'logos', 10, 'miss'],
      ['appeal', 'kairos', 45, 'near'],
      ['overall', 'overall', 70, 'ok'],
    ]);
  });

  it('passes an expected flag that is found and an absent one that is not', () => {
    const checks = scoreCase(
      caseWith({ flags_present: ['rf_hype', 'rf_fear'], flags_absent: ['rf_hype', 'rf_weasel'] }),
      result()
    ).filter((c) => c.kind === 'flag');
    expect(checks.map((c) => [c.key, c.got, c.result])).toEqual([
      ['present:rf_hype', true, 'ok'],
      ['present:rf_fear', false, 'miss'],
      ['absent:rf_hype', true, 'miss'],
      ['absent:rf_weasel', false, 'ok'],
    ]);
  });

  it('checks the primary duty only when one is expected', () => {
    expect(
      scoreCase(caseWith({ primary_duty: null }), result()).some((c) => c.kind === 'duty')
    ).toBe(false);
    const [hit] = scoreCase(caseWith({ primary_duty: 'teach' }), result()).filter(
      (c) => c.kind === 'duty'
    );
    const [miss] = scoreCase(caseWith({ primary_duty: 'move' }), result()).filter(
      (c) => c.kind === 'duty'
    );
    expect(hit).toMatchObject({ got: 'teach', result: 'ok' });
    expect(miss).toMatchObject({ expected: 'move', got: 'teach', result: 'miss' });
  });

  it('scores a group’s band and its key dimensions: low at 1 or below, high at 3 or above', () => {
    const checks = scoreCase(
      caseWith({
        groups: {
          craft: { band: 'low', low: ['craft_claims', 'craft_flow'] },
          audience: { band: 'low', high: ['aud_fit'] },
          culture: { band: 'mid' },
        },
      }),
      result()
    ).filter((c) => c.kind === 'group' || c.kind === 'dimension');
    expect(checks.map((c) => [c.kind, c.key, c.got, c.result])).toEqual([
      ['group', 'craft', 30, 'ok'],
      ['dimension', 'craft:craft_claims', 1, 'ok'],
      ['dimension', 'craft:craft_flow', 2, 'miss'],
      ['group', 'audience', 80, 'miss'],
      ['dimension', 'audience:aud_fit', 3, 'ok'],
      // No culture score (the switch was off): nothing to read, so a miss.
      ['group', 'culture', null, 'miss'],
    ]);
  });

  it('scores each named lever against the status the result gives it', () => {
    const checks = scoreCase(
      caseWith({
        levers: { misused: ['lv_scarcity'], absent: ['lv_truthful'], present: ['lv_unknown'] },
      }),
      result()
    ).filter((c) => c.kind === 'lever');
    expect(checks.map((c) => [c.key, c.expected, c.got, c.result])).toEqual([
      ['lv_unknown', 'present', null, 'miss'],
      ['lv_scarcity', 'misused', 'misused', 'ok'],
      ['lv_truthful', 'absent', 'present', 'miss'],
    ]);
  });

  it('does not score recommend_dimensions or balance_rules', () => {
    const kinds = new Set(scoreCase(caseWith({}), result()).map((c) => c.kind));
    expect([...kinds]).toEqual(['appeal', 'overall']);
  });
});

describe('tally()', () => {
  it('counts each kind, and agreement as every ok over every check', () => {
    const rows = [
      { checks: scoreCase(caseWith({ flags_present: ['rf_hype'] }), result()) },
      { checks: scoreCase(caseWith({ primary_duty: 'move' }), result()) },
    ];
    const t = tally(rows, 2);
    expect(t.byKind.appeal).toEqual({ ok: 2, near: 4, miss: 2, n: 8 });
    expect(t.byKind.overall).toEqual({ ok: 2, near: 0, miss: 0, n: 2 });
    expect(t.byKind.flag).toEqual({ ok: 1, near: 0, miss: 0, n: 1 });
    expect(t.byKind.duty).toEqual({ ok: 0, near: 0, miss: 1, n: 1 });
    expect(t.byKind.lever.n).toBe(0);
    expect(t).toMatchObject({ checks: 12, cases: 2, judgeFailures: 2, agreement: 0.4167 });
  });

  it('is zero agreement, not NaN, with no checks', () => {
    expect(tally([]).agreement).toBe(0);
  });
});

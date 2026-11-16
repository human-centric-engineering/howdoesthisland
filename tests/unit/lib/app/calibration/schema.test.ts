/**
 * Tests: the calibration set for model 0.5.1 and the schema it is read
 * through (t-36).
 *
 * Real file, real model. The set is data the runner (t-37) will score judges
 * against, so the tests hold it to what a run needs: it parses, every id it
 * names is one the model has, and each of the nine judges is checked by at
 * least six cases (D9). The reference check is also shown to catch a bad id
 * of every kind it reads, so an empty result is a finding and not a check
 * that looks at nothing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  calibrationSetSchema,
  danglingReferences,
  judgeCoverage,
  judgesChecked,
  type CalibrationCase,
  type CalibrationSet,
} from '@/lib/app/calibration/schema';
import { indexModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { HOWDOESTHISLAND_JUDGE_SLOTS } from '@/lib/app/frameworks/howdoesthisland/judge-slots';

const DATA = 'lib/app/frameworks/howdoesthisland/data';
const readJson = (file: string): unknown => JSON.parse(readFileSync(`${DATA}/${file}`, 'utf8'));

const model = indexModel(z.looseObject({}).parse(readJson('model-0.5.1.json')));
const set: CalibrationSet = calibrationSetSchema.parse(readJson('eval-0.5.1.json'));

const clone = (s: CalibrationSet): CalibrationSet => structuredClone(s);
const caseById = (s: CalibrationSet, id: string): CalibrationCase => {
  const c = s.cases.find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  return c;
};

describe('eval-0.5.1.json', () => {
  it('is written against model 0.5.1', () => {
    expect(set.meta.model).toBe(model.data.meta.version);
    expect(set.meta.version).toBe('0.5.1');
  });

  it('lists what changed from 0.4.0', () => {
    const changes = z.array(z.string().min(1)).min(1).parse(set.meta.changes_from_0_4_0);
    expect(changes.length).toBeGreaterThan(0);
  });

  it('keeps the 18 cases of 0.4.0 and adds to them', () => {
    const ids = set.cases.map((c) => c.id);
    for (let n = 1; n <= 18; n++) expect(ids).toContain(`ev${String(n).padStart(2, '0')}`);
    expect(ids.length).toBeGreaterThan(18);
  });

  it('names only ids the model has', () => {
    expect(danglingReferences(set, model)).toEqual([]);
  });

  it('checks each of the nine judges with at least six cases', () => {
    const coverage = judgeCoverage(set);
    expect([...coverage.keys()].sort()).toEqual([...HOWDOESTHISLAND_JUDGE_SLOTS].sort());
    for (const slot of HOWDOESTHISLAND_JUDGE_SLOTS) {
      expect(coverage.get(slot), slot).toBeGreaterThanOrEqual(6);
    }
  });

  it('gives craft, audience and culture a band and at least one key dimension', () => {
    for (const group of ['craft', 'audience', 'culture'] as const) {
      const withKeys = set.cases.filter((c) => {
        const g = c.expect.groups?.[group];
        return g && (g.low?.length ?? 0) + (g.high?.length ?? 0) > 0;
      });
      expect(withKeys.length, group).toBeGreaterThanOrEqual(6);
    }
  });

  it('gives every culture case a reader culture to judge against', () => {
    const culture = set.cases.filter((c) => c.expect.groups?.culture);
    expect(culture.length).toBeGreaterThan(0);
    for (const c of culture) expect(c.culture?.reader, c.id).toBeTruthy();
  });

  it('includes at least two prompt-injection cases, expected to score as an honest reading', () => {
    const injection = set.cases.filter((c) => c.notes.startsWith('Prompt injection'));
    expect(injection.length).toBeGreaterThanOrEqual(2);
    for (const c of injection) {
      expect(c.expect.overall, c.id).toBe('low');
      expect(c.expect.flags_present.length, c.id).toBeGreaterThan(0);
    }
  });
});

describe('danglingReferences', () => {
  const cases: [string, (s: CalibrationSet) => void, string][] = [
    [
      'content type',
      (s) => (caseById(s, 'ev01').content_type = 'ct_nope'),
      "ev01.content_type: 'ct_nope'",
    ],
    [
      'archetype',
      (s) => (caseById(s, 'ev01').audience.archetype = 'wizard'),
      "ev01.audience.archetype: 'wizard'",
    ],
    ['role', (s) => (caseById(s, 'ev01').audience.role = 'pope'), "ev01.audience.role: 'pope'"],
    [
      'modifier option',
      (s) => (caseById(s, 'ev01').audience.relationship = 'frosty'),
      "ev01.audience.relationship: 'frosty'",
    ],
    ['modifier', (s) => (caseById(s, 'ev01').audience.mood = 'calm'), "ev01.audience: 'mood'"],
    [
      'reader culture',
      (s) => (caseById(s, 'ev01').culture = { reader: 'atlantis' }),
      "ev01.culture.reader: 'atlantis'",
    ],
    [
      'writer culture',
      (s) => (caseById(s, 'ev01').culture = { writer: 'atlantis' }),
      "ev01.culture.writer: 'atlantis'",
    ],
    [
      'red flag',
      (s) => caseById(s, 'ev01').expect.flags_absent.push('rf_nope'),
      "ev01.flags: 'rf_nope'",
    ],
    [
      'dimension',
      (s) => caseById(s, 'ev01').expect.recommend_dimensions.push('eth_nope'),
      "ev01.recommend_dimensions: 'eth_nope'",
    ],
    [
      'balance rule',
      (s) => caseById(s, 'ev01').expect.balance_rules.push('br_nope'),
      "ev01.balance_rules: 'br_nope'",
    ],
    [
      'duty',
      (s) => (caseById(s, 'ev01').expect.primary_duty = 'amuse'),
      "ev01.primary_duty: 'amuse'",
    ],
    [
      "another group's dimension",
      (s) => (caseById(s, 'ev01').expect.groups = { craft: { band: 'low', low: ['aud_hook'] } }),
      "ev01.groups.craft: 'aud_hook'",
    ],
    [
      'lever',
      (s) => (caseById(s, 'ev01').expect.levers = { present: ['lv_nope'] }),
      "ev01.levers.present: 'lv_nope'",
    ],
  ];

  it.each(cases)('reports an unknown %s', (_kind, plant, expected) => {
    const s = clone(set);
    plant(s);
    expect(danglingReferences(s, model)).toEqual([expected]);
  });

  it('accepts the global culture', () => {
    const s = clone(set);
    caseById(s, 'ev01').culture = { reader: 'global', writer: 'global' };
    expect(danglingReferences(s, model)).toEqual([]);
  });
});

describe('judgesChecked', () => {
  it('names the four appeals for a case with nothing else, and each added expectation adds its judge', () => {
    const c = structuredClone(caseById(set, 'ev01'));
    c.expect = { ...c.expect, groups: undefined, levers: undefined, primary_duty: undefined };
    expect(judgesChecked(c)).toEqual([
      'judge_ethos',
      'judge_pathos',
      'judge_logos',
      'judge_kairos',
    ]);

    c.expect.primary_duty = 'teach';
    c.expect.levers = { misused: ['lv_scarcity'] };
    c.expect.groups = { culture: { band: 'low' } };
    expect(judgesChecked(c)).toEqual([
      'judge_ethos',
      'judge_pathos',
      'judge_logos',
      'judge_kairos',
      'judge_lenses',
      'judge_influence',
      'judge_culture',
    ]);
  });
});

describe('calibrationSetSchema', () => {
  type Doc = Record<string, unknown>;
  const isDoc = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);
  const doc = (v: unknown): Doc => {
    if (!isDoc(v)) throw new Error('not an object');
    return v;
  };
  const raw = (): Doc => doc(readJson('eval-0.5.1.json'));
  /** The first case's `expect`, as the same object the document holds, so edits reach it. */
  const firstExpect = (d: Doc): Doc => {
    const cases = d.cases;
    if (!Array.isArray(cases)) throw new Error('no cases');
    return doc(doc(cases[0]).expect);
  };

  it('accepts the file as it is', () => {
    expect(calibrationSetSchema.safeParse(raw()).success).toBe(true);
  });

  it('refuses a repeated case id', () => {
    const d = raw();
    const cases = z.array(z.unknown()).parse(d.cases);
    d.cases = [...cases, cases[0]];
    expect(calibrationSetSchema.safeParse(d).success).toBe(false);
  });

  it('refuses a dimension expected both low and high', () => {
    const d = raw();
    firstExpect(d).groups = { craft: { band: 'mid', low: ['craft_tone'], high: ['craft_tone'] } };
    expect(calibrationSetSchema.safeParse(d).success).toBe(false);
  });

  it('refuses a lever expectation that names no lever', () => {
    const d = raw();
    firstExpect(d).levers = { present: [] };
    expect(calibrationSetSchema.safeParse(d).success).toBe(false);
  });

  it('refuses an expectation it does not know, rather than ignoring it', () => {
    const d = raw();
    firstExpect(d).tone = 'warm';
    expect(calibrationSetSchema.safeParse(d).success).toBe(false);
  });

  it('refuses a band outside low, mid and high', () => {
    const d = raw();
    firstExpect(d).overall = 'medium';
    expect(calibrationSetSchema.safeParse(d).success).toBe(false);
  });
});

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
  caseContext,
  calibrationSetSchema,
  danglingReferences,
  judgeCoverage,
  judgesChecked,
  type CalibrationCase,
  type CalibrationSet,
} from '@/lib/app/calibration/schema';
import { indexModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import { HOWDOESTHISLAND_JUDGE_SLOTS } from '@/lib/app/frameworks/howdoesthisland/judge-slots';
import { band3 } from '@/lib/app/frameworks/howdoesthisland/engine/text';
import { parseContext } from '@/lib/app/frameworks/howdoesthisland/engine/context';

const DATA = 'lib/app/frameworks/howdoesthisland/data';
/** The cases whose text tries to instruct the judges. */
const INJECTION_CASES = ['ev25', 'ev26'] as const;
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

  it('has at least six cases per group that name key dimensions, not only a band', () => {
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
    expect(culture.length).toBeGreaterThanOrEqual(6);
    for (const c of culture) expect(c.culture?.reader, c.id).toBeTruthy();
  });

  it('includes the two prompt-injection cases, expected to score as an honest reading', () => {
    // An honest reading of both texts is weak, hype-laden copy; the injected
    // instruction asks for top marks and no flags.
    for (const id of INJECTION_CASES) {
      const e = caseById(set, id).expect;
      expect({ appeals: e.appeals, overall: e.overall }, id).toEqual({
        appeals: { ethos: 'low', pathos: 'low', logos: 'low', kairos: 'low' },
        overall: 'low',
      });
      expect(e.flags_present, id).toContain('rf_hype');
      expect(e.groups?.craft?.band, id).toBe('low');
      expect(e.levers?.present ?? [], id).toEqual([]);
    }
  });

  it('keeps each pair of cases comparable', () => {
    // The same novice reader, two texts: one pitched for an adviser, one for them.
    const [forAdviser, forNovice] = [caseById(set, 'ev19'), caseById(set, 'ev20')];
    expect(forNovice.audience).toEqual(forAdviser.audience);
    expect(forNovice.content_type).toBe(forAdviser.content_type);
    expect(forNovice.culture).toEqual(forAdviser.culture);
    expect(forNovice.text).not.toBe(forAdviser.text);

    // One email, everything the same but the reader.
    const [japan, us] = [caseById(set, 'ev22'), caseById(set, 'ev24')];
    const { culture: jc, id: _j, title: _jt, notes: _jn, expect: _je, ...japanRest } = japan;
    const { culture: uc, id: _u, title: _ut, notes: _un, expect: _ue, ...usRest } = us;
    expect(usRest).toEqual(japanRest);
    expect(uc?.writer).toBe(jc?.writer);
    expect([jc?.reader, uc?.reader]).toEqual(['jp', 'us']);
  });

  it("states the bands the engine's band3 scores with", () => {
    const edges = Object.entries(set.meta.bands).map(([band, range]) => {
      const [from, to] = range.split(/[-–]/).map(Number);
      return { band, from, to };
    });
    for (const { band, from, to } of edges) {
      expect(band3(from), `${band} from`).toBe(band);
      expect(band3(to), `${band} to`).toBe(band);
    }
    expect(edges.map((e) => [e.from, e.to])).toEqual([
      [0, 44],
      [45, 70],
      [71, 100],
    ]);
  });
});

describe('danglingReferences', () => {
  const cases: [string, (s: CalibrationSet) => void, string | RegExp][] = [
    [
      'content type',
      (s) => (caseById(s, 'ev01').content_type = 'ct_nope'),
      /^ev01\.context\.contentType: /,
    ],
    [
      'archetype',
      (s) => (caseById(s, 'ev01').audience.archetype = 'wizard'),
      /^ev01\.context\.archetype: /,
    ],
    ['role', (s) => (caseById(s, 'ev01').audience.role = 'pope'), /^ev01\.context\.role: /],
    [
      'modifier option',
      (s) => (caseById(s, 'ev01').audience.relationship = 'frosty'),
      /^ev01\.context\.audience\.relationship: /,
    ],
    [
      'modifier',
      (s) => (caseById(s, 'ev01').audience.mood = 'calm'),
      /^ev01\.context\.audience: .*mood/,
    ],
    [
      'reader culture',
      (s) => (caseById(s, 'ev01').culture = { reader: 'atlantis' }),
      /^ev01\.context\.culture\.reader: /,
    ],
    [
      'writer culture',
      (s) => (caseById(s, 'ev01').culture = { writer: 'atlantis' }),
      /^ev01\.context\.culture\.writer: /,
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
    const found = danglingReferences(s, model);
    expect(found).toHaveLength(1);
    if (typeof expected === 'string') expect(found[0]).toBe(expected);
    else expect(found[0]).toMatch(expected);
  });

  it('accepts the global culture', () => {
    const s = clone(set);
    caseById(s, 'ev01').culture = { reader: 'global', writer: 'global' };
    expect(danglingReferences(s, model)).toEqual([]);
  });
});

describe('caseContext', () => {
  it('lifts archetype and role out of the audience, and keeps the culture', () => {
    const parsed = parseContext(model, caseContext(caseById(set, 'ev09')), true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect(parsed.ctx).toMatchObject({
      contentType: 'exec_briefing',
      archetype: 'auditor',
      role: 'board',
      audience: { expertise: 'expert' },
      culture: { reader: 'de' },
    });
    expect(parsed.ctx.audience).not.toHaveProperty('archetype');
  });

  it('leaves a case with no audience or culture to the engine defaults', () => {
    expect(caseContext(caseById(set, 'ev01'))).toEqual({
      contentType: 'landing_page',
      audience: {},
    });
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

  it('refuses a lever expected in two statuses', () => {
    const d = raw();
    firstExpect(d).levers = { present: ['lv_scarcity'], misused: ['lv_scarcity'] };
    expect(calibrationSetSchema.safeParse(d).success).toBe(false);
  });

  it('refuses an id listed twice', () => {
    const d = raw();
    firstExpect(d).flags_present = ['rf_hype', 'rf_hype'];
    expect(calibrationSetSchema.safeParse(d).success).toBe(false);
  });

  it('refuses a flag expected both present and absent', () => {
    const d = raw();
    firstExpect(d).flags_present = ['rf_hype'];
    firstExpect(d).flags_absent = ['rf_hype'];
    expect(calibrationSetSchema.safeParse(d).success).toBe(false);
  });

  it('refuses a culture expectation with no reader culture', () => {
    const d = raw();
    firstExpect(d).groups = { culture: { band: 'low' } };
    const parsed = calibrationSetSchema.safeParse(d);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path.join('.'))).toEqual(['cases.0.culture.reader']);
  });

  it('refuses a culture expectation whose reader is the global profile', () => {
    const d = raw();
    firstExpect(d).groups = { culture: { band: 'low' } };
    const cases = d.cases;
    if (!Array.isArray(cases)) throw new Error('no cases');
    doc(cases[0]).culture = { reader: 'global' };
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

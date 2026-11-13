/**
 * Tests: scripts/app/baseline/{canonical,corpus,synthetic}.ts — the pure parts
 * of the engine-baseline recorder (t-12).
 *
 * What matters: canonical JSON does not depend on key order; the corpus covers
 * what the baseline promised against the real 0.5.1 model, and its coverage
 * check notices when it does not; and the synthetic judge outputs are
 * reproducible, reach every group `assemble()` reads, and carry the awkward
 * values (string score, unknown ids, every `locate()` path) the merge path
 * has to survive.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson, sortKeys } from '@/scripts/app/baseline/canonical';
import {
  CORPUS_TEXTS,
  buildCorpus,
  checkCoverage,
  corpusInputs,
} from '@/scripts/app/baseline/corpus';
import {
  MISSING,
  SYNTHETIC_GROUPS,
  hash,
  highlightQuotes,
  syntheticJudgeOutputs,
  syntheticModelSchema,
} from '@/scripts/app/baseline/synthetic';

// The app's copy, byte-identical to the prototype's (data-files.test.ts).
const MODEL: unknown = JSON.parse(
  readFileSync('lib/app/frameworks/howdoesthisland/data/model-0.5.1.json', 'utf8')
);
const model = syntheticModelSchema.parse(MODEL);

const { lists, lewis } = corpusInputs(MODEL);

describe('canonicalJson', () => {
  it('gives the same bytes whatever order the keys were built in', () => {
    const a = { b: 1, a: { d: [{ z: 1, y: 2 }], c: null } };
    const b = { a: { c: null, d: [{ y: 2, z: 1 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe(
      '{\n  "a": {\n    "c": null,\n    "d": [\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n'
    );
  });

  it('keeps array order, and follows JSON.stringify on undefined and non-finite values', () => {
    expect(sortKeys([3, 1, 2])).toEqual([3, 1, 2]);
    expect(canonicalJson({ gone: undefined, n: NaN, list: [undefined] })).toBe(
      '{\n  "list": [\n    null\n  ],\n  "n": null\n}\n'
    );
  });
});

describe('the corpus', () => {
  const pairs = buildCorpus(lists);

  it('covers everything the baseline promised, against the 0.5.1 model', () => {
    expect(checkCoverage(pairs, lists, lewis)).toEqual([]);
    expect(pairs).toHaveLength(CORPUS_TEXTS.length * 4);
    expect(pairs.length).toBeGreaterThanOrEqual(40);
  });

  it('gives every pair a unique id and only values the model has', () => {
    expect(new Set(pairs.map((p) => p.id)).size).toBe(pairs.length);
    for (const p of pairs) {
      expect(lists.contentTypes).toContain(p.ctx.contentType);
      expect(lists.archetypes).toContain(p.ctx.archetype);
      if (p.ctx.role) expect(lists.roles).toContain(p.ctx.role);
      for (const [m, v] of Object.entries(p.ctx.audience)) expect(lists.audience[m]).toContain(v);
    }
  });

  it('reads each text as its own content type in its first context', () => {
    for (const t of CORPUS_TEXTS) {
      expect(pairs.find((p) => p.id === `${t.id}-1`)?.ctx.contentType).toBe(t.contentType);
    }
  });

  it('reports each gap when the corpus is too thin', () => {
    const one = pairs.slice(0, 1).map((p) => ({
      ...p,
      text: 'No dotted capital here.',
      ctx: { ...p.ctx, culture: { reader: 'us', writer: 'us' } },
    }));
    const gaps = checkCoverage(one, lists, lewis);
    expect(gaps).toEqual(
      expect.arrayContaining([
        'only 1 pairs; at least 40 are needed',
        expect.stringMatching(/^content types not covered: /),
        expect.stringMatching(/^archetypes not covered: /),
        expect.stringMatching(/^exec roles not covered: /),
        'fewer than two readers are mostly linear',
        'fewer than two readers are mostly multi',
        'fewer than two readers are mostly reactive',
        'no reader is a balanced blend',
        'no reader falls back to global',
        'no pair without a writer culture',
        'no pair whose writer and reader are different known cultures',
        'no text has İ ahead of its last paragraph',
      ])
    );
    expect(gaps).not.toContain('no pair whose writer is the reader');
  });
});

describe('syntheticJudgeOutputs', () => {
  const sentences = [
    'İstanbul is where we start, with a long opening sentence of many words.',
    'The middle sentence.',
    'Shippers can book space today.',
  ];
  const out = syntheticJudgeOutputs(model, sentences, 'case-a');

  it('is the same every time, and differs by case id', () => {
    expect(syntheticJudgeOutputs(model, sentences, 'case-a')).toEqual(out);
    expect(syntheticJudgeOutputs(model, sentences, 'case-b')).not.toEqual(out);
    expect(hash('abc')).toBe(hash('abc'));
    expect(hash('abc')).not.toBe(hash('abd'));
  });

  it('has one output for every group assemble() reads', () => {
    expect(Object.keys(out).sort()).toEqual([...SYNTHETIC_GROUPS].sort());
  });

  it('scores every dimension of a group, one of them as a string and one out of range, plus one unknown id', () => {
    const scores = out.ethos.dimension_scores as { id: string; score: unknown }[];
    const ethos = model.dimensions.filter((d) => d.appeal === 'ethos').map((d) => d.id);
    expect(scores.map((s) => s.id)).toEqual([...ethos, MISSING.dimension]);
    expect(typeof scores[0].score).toBe('string');
    expect(scores[1].score).toBe(7);
    const lensIds = (out.lenses.dimension_scores as { id: string }[]).map((s) => s.id);
    expect(lensIds).toEqual([...model.lenses.map((l) => l.id), MISSING.dimension]);
    const craftIds = (out.craft.dimension_scores as { id: string }[]).map((s) => s.id);
    expect(craftIds.slice(0, -1).every((id) => id.startsWith('craft_'))).toBe(true);
  });

  it('quotes for every locate() path, the case-varied one being the last sentence', () => {
    const q = highlightQuotes(sentences);
    expect(q[0]).toBe(sentences[0]);
    expect(q[1]).toBe('SHIPPERS CAN BOOK SPACE TODAY.');
    expect(q[2]).toBe('İstanbul   is where we start, with a long opening sentence of many words.');
    expect(q[3]).toBe('İstanbul is where we start, with and then something the text never says');
    expect(q[4]).toMatch(/nowhere in the text/);
    // A first sentence of six words or fewer still gets a quote nobody wrote.
    expect(highlightQuotes(['Short one.'])[3]).toBe(
      'Short one. and then something the text never says'
    );
  });

  it('carries unknown ids through recommendations, flags, perspectives and levers', () => {
    const recs = out.logos.recommendations as { dimension: string; move: string }[];
    expect(recs.map((r) => r.dimension)).toContain(MISSING.dimension);
    expect(recs.map((r) => r.move)).toContain(MISSING.move);
    expect((out.pathos.red_flags as { id: string }[]).map((f) => f.id)).toContain(MISSING.flag);
    const pvs = out.influence.perspectives as {
      id: string;
      levers: { id: string; status: string }[];
    }[];
    expect(pvs.map((p) => p.id)).toEqual([
      ...model.perspectives.map((p) => p.id),
      MISSING.perspective,
    ]);
    const statuses = new Set(pvs.flatMap((p) => p.levers.map((l) => l.status)));
    expect([...statuses].sort()).toEqual([
      'absent',
      'bogus_status',
      'misused',
      'not_applicable',
      'present',
    ]);
    expect(pvs[0].levers.at(-1)?.id).toBe(MISSING.lever);
  });

  it('gives lenses duties and culture text positions, each with an awkward value', () => {
    const duties = out.lenses.duties as Record<string, unknown>;
    expect(Object.keys(duties)).toEqual(model.duties.map((d) => d.id));
    expect(typeof Object.values(duties)[0]).toBe('string');
    const positions = out.culture.text_positions as Record<string, unknown>;
    const values = Object.values(positions);
    expect(Object.keys(positions)).toEqual(model.culture.scales.map((s) => s.id));
    expect(values[0]).toBe('0.5');
    expect(values[1]).toBe(1.4);
  });

  it('leaves the summary off one group only', () => {
    const without = SYNTHETIC_GROUPS.filter((g) => !('summary' in out[g]));
    expect(without).toEqual(['kairos']);
  });

  it('copes with a text that has no sentences', () => {
    const empty = syntheticJudgeOutputs(model, [], 'empty');
    expect((empty.ethos.highlights as { quote: string }[])[0].quote).toBe('(empty)');
  });
});

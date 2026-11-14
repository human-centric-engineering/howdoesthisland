/**
 * Tests: engine/judge-schemas.ts (t-18).
 *
 * A green `z.toJSONSchema()` does not prove a schema is one OpenAI's strict
 * mode accepts (fp5). So every slot's schema is walked against the rules
 * strict mode states: an object root; every object closed, with every
 * property required; only the keywords the subset honours; no empty enum;
 * and the size limits (5,000 properties, 10 levels of nesting, 1,000 enum
 * values in all). Then the schemas are checked to carry the version's ids,
 * and to refuse one it does not have.
 */
import { describe, expect, it } from 'vitest';
import { indexModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import {
  judgeIds,
  judgeReplySchema,
  outputSchema,
  schemaName,
  shapeOf,
} from '@/lib/app/frameworks/howdoesthisland/engine/judge-schemas';
import { HOWDOESTHISLAND_JUDGE_SLOTS } from '@/lib/app/frameworks/howdoesthisland/judge-slots';
import { loadModel } from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

const m = indexModel(loadModel());

/** The keywords OpenAI's strict mode honours that these schemas may use. */
const ALLOWED = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'anyOf',
  'description',
  '$defs',
  '$ref',
]);
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

interface Tally {
  properties: number;
  enumValues: number;
  depth: number;
}

/** Every way `node` breaks strict mode, by path. */
function strictProblems(
  node: unknown,
  at: string,
  depth: number,
  tally: Tally,
  out: string[] = []
): string[] {
  if (!isRecord(node)) return [...out, `${at}: not a schema object`];
  tally.depth = Math.max(tally.depth, depth);
  for (const key of Object.keys(node)) {
    if (!ALLOWED.has(key)) out.push(`${at}: keyword "${key}" is not in the strict subset`);
  }
  const types = Array.isArray(node.type) ? node.type : [node.type];
  for (const t of types) if (!TYPES.has(String(t))) out.push(`${at}: type ${String(t)}`);
  if (node.enum !== undefined) {
    if (!Array.isArray(node.enum) || node.enum.length === 0) out.push(`${at}: empty enum`);
    else {
      tally.enumValues += node.enum.length;
      if (new Set(node.enum).size !== node.enum.length) out.push(`${at}: repeated enum value`);
    }
  }
  if (types.includes('object')) {
    const props = isRecord(node.properties) ? node.properties : {};
    const keys = Object.keys(props);
    tally.properties += keys.length;
    if (node.additionalProperties !== false) out.push(`${at}: object not closed`);
    const required = Array.isArray(node.required) ? node.required.map(String) : [];
    if ([...required].sort().join() !== [...keys].sort().join()) {
      out.push(`${at}: required is not every property`);
    }
    for (const k of keys) strictProblems(props[k], `${at}.${k}`, depth + 1, tally, out);
  }
  if (types.includes('array')) strictProblems(node.items, `${at}[]`, depth + 1, tally, out);
  return out;
}

describe('outputSchema()', () => {
  for (const slot of HOWDOESTHISLAND_JUDGE_SLOTS) {
    it(`gives ${slot} a schema strict mode accepts`, () => {
      const schema = outputSchema(m, slot);
      expect(schema.type).toBe('object');
      expect(schema).not.toHaveProperty('$schema');
      const tally: Tally = { properties: 0, enumValues: 0, depth: 0 };
      expect(strictProblems(schema, '$', 1, tally)).toEqual([]);
      expect(tally.properties).toBeLessThanOrEqual(5000);
      expect(tally.depth).toBeLessThanOrEqual(10);
      expect(tally.enumValues).toBeLessThanOrEqual(1000);
    });
  }

  it('finds a fault the walk looks for, so a clean walk means something', () => {
    const tally: Tally = { properties: 0, enumValues: 0, depth: 0 };
    const bad = {
      type: 'object',
      properties: { a: { type: 'string', minLength: 1 }, b: { type: 'string', enum: [] } },
      required: ['a'],
    };
    expect(strictProblems(bad, '$', 1, tally)).toEqual([
      '$: object not closed',
      '$: required is not every property',
      '$.a: keyword "minLength" is not in the strict subset',
      '$.b: empty enum',
    ]);
  });

  it('names a schema within every provider’s tool-name charset', () => {
    for (const slot of HOWDOESTHISLAND_JUDGE_SLOTS) {
      expect(`__structured_${schemaName(slot)}`).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
  });
});

describe('the schemas carry the version’s ids', () => {
  it('gives each slot the shape its prompt asks for', () => {
    expect(HOWDOESTHISLAND_JUDGE_SLOTS.map((s) => [s, shapeOf(m, s)])).toEqual([
      ['judge_ethos', 'appeal'],
      ['judge_pathos', 'appeal'],
      ['judge_logos', 'appeal'],
      ['judge_kairos', 'appeal'],
      ['judge_lenses', 'appeal'],
      ['judge_influence', 'influence'],
      ['judge_craft', 'extra'],
      ['judge_audience', 'extra'],
      ['judge_culture', 'extra'],
    ]);
  });

  it('enumerates exactly the dimensions an appeal judge scores', () => {
    const schema = outputSchema(m, 'judge_ethos');
    const ids = m.DIMS.filter((d) => d.appeal === 'ethos').map((d) => d.id);
    expect(schema).toMatchObject({
      properties: { dimension_scores: { items: { properties: { id: { enum: ids } } } } },
    });
  });

  it('refuses a reply naming a dimension, flag or lever the version does not have', () => {
    const ethos = judgeReplySchema(m, 'judge_ethos');
    const ok = {
      appeal: 'ethos',
      summary: 's',
      dimension_scores: [{ id: 'eth_competence', score: 3, rationale: 'r' }],
      highlights: [],
      recommendations: [],
      red_flags: [],
    };
    expect(ethos.safeParse(ok).success).toBe(true);
    expect(
      ethos.safeParse({ ...ok, dimension_scores: [{ id: 'eth_nope', score: 3, rationale: '' }] })
        .success
    ).toBe(false);
    expect(
      ethos.safeParse({ ...ok, red_flags: [{ id: 'rf_nope', quote: 'q', note: '' }] }).success
    ).toBe(false);
    const influence = judgeReplySchema(m, 'judge_influence');
    const lever = { id: 'lv_nope', status: 'present', quote: '', note: '' };
    expect(
      influence.safeParse({
        appeal: 'influence',
        summary: '',
        perspectives: [{ id: 'pv_cialdini', score: 2, summary: '', levers: [lever] }],
        recommendations: [],
      }).success
    ).toBe(false);
  });

  it('accepts the example reply each prompt shows, with the version’s ids', () => {
    // The influence prompt's own example names these; they must exist.
    const influence = judgeReplySchema(m, 'judge_influence');
    expect(
      influence.safeParse({
        appeal: 'influence',
        summary: 'two sentences',
        perspectives: [
          {
            id: 'pv_cialdini',
            score: 2,
            summary: 'one sentence',
            levers: [{ id: 'lv_social_proof', status: 'present', quote: 'q', note: 'n' }],
          },
        ],
        recommendations: [
          {
            dimension: 'eth_borrowed',
            move: 'mv_specific_testimonial',
            issue: 'i',
            original: '',
            rewrite: 'r',
            impact: 'high',
          },
        ],
      }).success
    ).toBe(true);
  });

  it('gives the lenses judge every duty and a primary, and the culture judge every scale', () => {
    expect(Object.keys(judgeReplySchema(m, 'judge_lenses').shape.duties.shape)).toEqual([
      ...m.FN.map((f) => f.id),
      'primary',
    ]);
    expect(Object.keys(judgeReplySchema(m, 'judge_culture').shape.text_positions.shape)).toEqual(
      m.SCALE_IDS
    );
  });

  it('leaves out red flags for a judge the version gives none, and moves for an extra group', () => {
    for (const slot of HOWDOESTHISLAND_JUDGE_SLOTS) {
      const ids = judgeIds(m, slot);
      expect('red_flags' in judgeReplySchema(m, slot).shape).toBe(ids.flags.length > 0);
    }
    expect(judgeIds(m, 'judge_craft').moves).toEqual([]);
    expect(outputSchema(m, 'judge_craft')).toMatchObject({
      properties: {
        recommendations: { items: { properties: { move: { enum: [''] } } } },
      },
    });
  });
});

/**
 * The framework codec against the real HowDoesThisLand model (t-10): the
 * round trip is exact for 0.5.1, every refusal the import promises is
 * reported, and 0.5.0 is refused with its 38 unresolved references.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compose, decompose } from '@/lib/app/frameworks/codec';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import type { JsonObject, NodeRecord } from '@/lib/app/frameworks/types';

const MODEL_0_5_1 = 'lib/app/frameworks/howdoesthisland/data/model-0.5.1.json';
const MODEL_0_5_0 = 'tests/unit/lib/app/frameworks/fixtures/model-0.5.0.json';

/** A fresh, mutable copy of 0.5.1 for each case. */
function model(): JsonObject {
  return JSON.parse(readFileSync(MODEL_0_5_1, 'utf8')) as JsonObject;
}

function list(doc: JsonObject, section: string): JsonObject[] {
  return doc[section] as JsonObject[];
}

describe('decompose() and compose() on model 0.5.1', () => {
  const original = model();
  const result = decompose(howDoesThisLand, original);

  it('finds no problems', () => {
    expect(result.problems).toEqual([]);
  });

  it('turns every record into a node and every reference into a link', () => {
    const kinds = new Set(result.nodes.map((n) => n.kind));
    // One kind per collection, plus levers and the singleton sections.
    expect(kinds).toContain('appeal');
    expect(kinds).toContain('lever');
    expect(kinds).toContain('knowledge_overlay');
    expect(kinds).toContain('section');
    expect(result.nodes.filter((n) => n.kind === 'dimension')).toHaveLength(23);
    expect(result.nodes.filter((n) => n.kind === 'lever')).toHaveLength(78);
    expect(result.links.length).toBeGreaterThan(1000);
  });

  it('links a reference to the record it names', () => {
    // eth_competence is grounded in fw_trust_equation (0.5.1, dimensions[0]).
    expect(result.links).toContainEqual({
      fromKind: 'dimension',
      fromKey: 'eth_competence',
      toKind: 'knowledge_framework',
      toKey: 'fw_trust_equation',
      relation: 'grounded_in',
    });
    // One of the references 0.5.1 added: an originator 0.5.0 left dangling.
    expect(result.links).toContainEqual({
      fromKind: 'knowledge_framework',
      fromKey: 'fw_challenger',
      toKind: 'knowledge_thinker',
      toKey: 'th_adamson',
      relation: 'originator',
    });
  });

  it('keeps a lever under its perspective, by parentKey and not by a link', () => {
    const lever = result.nodes.find((n) => n.kind === 'lever' && n.key === 'lv_tricolon');
    expect(lever?.parentKey).toBe('pv_rhetoric');
    const perspective = result.nodes.find(
      (n) => n.kind === 'perspective' && n.key === 'pv_rhetoric'
    );
    expect(perspective?.attributes).not.toHaveProperty('levers');
  });

  it('rebuilds the file exactly, array order included', () => {
    // Through JSON, as the database stores attributes, and in reverse, so the
    // order is proved to come from `position` and not from storage order.
    const stored = (JSON.parse(JSON.stringify(result.nodes)) as NodeRecord[]).reverse();
    const rebuilt = compose(howDoesThisLand, stored);
    expect(rebuilt).toStrictEqual(original);
    expect(list(rebuilt, 'moves').map((m) => m.id)).toEqual(
      list(original, 'moves').map((m) => m.id)
    );
  });

  it('would notice a change: a rebuilt model with one record moved is not equal', () => {
    const stored = JSON.parse(JSON.stringify(result.nodes)) as NodeRecord[];
    const first = stored.find((n) => n.kind === 'move' && n.position === 0) as NodeRecord;
    const second = stored.find((n) => n.kind === 'move' && n.position === 1) as NodeRecord;
    [first.position, second.position] = [1, 0];
    expect(compose(howDoesThisLand, stored)).not.toStrictEqual(original);
  });
});

describe('decompose() refuses', () => {
  it('model 0.5.0, listing its 38 unresolved references', () => {
    const old = JSON.parse(readFileSync(MODEL_0_5_0, 'utf8')) as JsonObject;
    const { problems } = decompose(howDoesThisLand, old);
    const unresolved = problems.filter((p) => p.startsWith('unresolved reference'));
    expect(unresolved).toHaveLength(38);
    expect(unresolved).toContain(
      'unresolved reference: perspectives[].levers[].refs on "lv_choice" → "st_choice_overload" (research or knowledge_study)'
    );
    expect(unresolved.filter((p) => p.includes('content_types[].overlay'))).toHaveLength(6);
    // Its only other problem: the overlays collection did not exist yet.
    expect(problems.filter((p) => !p.startsWith('unresolved reference'))).toEqual([
      'missing section "knowledge_refs.overlays"',
    ]);
  });

  it('a dangling reference', () => {
    const doc = model();
    list(doc, 'moves')[0].dimensions = ['no_such_dimension'];
    expect(decompose(howDoesThisLand, doc).problems).toEqual([
      expect.stringMatching(
        /^unresolved reference: moves\[\]\.dimensions on ".+" → "no_such_dimension"/
      ),
    ]);
  });

  it('a reference that is not a string id', () => {
    const doc = model();
    list(doc, 'archetypes')[1].primary = 7;
    expect(decompose(howDoesThisLand, doc).problems).toEqual([
      expect.stringMatching(/^archetypes\[.+\]: primary: /),
    ]);
  });

  it('an unknown section, and a missing one', () => {
    const doc = model();
    doc.surprise = {};
    delete doc.duties;
    const { problems } = decompose(howDoesThisLand, doc);
    expect(problems).toContain('unknown section "surprise"');
    expect(problems).toContain('missing section "duties"');
  });

  it('a record failing its kind’s schema', () => {
    const doc = model();
    delete list(doc, 'appeals')[0].name;
    expect(decompose(howDoesThisLand, doc).problems).toEqual([
      expect.stringMatching(/^appeals\[ethos\]: name: /),
    ]);
  });

  it('a singleton section failing its schema', () => {
    const doc = model();
    (doc.meta as JsonObject).version = 'five';
    expect(decompose(howDoesThisLand, doc).problems).toEqual([
      'meta: version: expected a version like 0.5.1',
    ]);
  });

  it('a duplicate key within a kind', () => {
    const doc = model();
    const appeals = list(doc, 'appeals');
    appeals.push({ ...appeals[0] });
    expect(decompose(howDoesThisLand, doc).problems).toEqual([
      'appeals[ethos]: duplicate key "ethos"',
    ]);
  });

  it('a record with no id', () => {
    const doc = model();
    delete list(doc, 'duties')[0].id;
    expect(decompose(howDoesThisLand, doc).problems).toContain(
      'duties[0]: a record with no string id'
    );
  });

  it('a collection that is not a list, and a nested one that is not', () => {
    const doc = model();
    (doc.knowledge_refs as JsonObject).concepts = {};
    const perspective = list(doc, 'perspectives')[0];
    perspective.levers = 'none';
    const { problems } = decompose(howDoesThisLand, doc);
    expect(problems).toContain('knowledge_refs.concepts: expected a list of records');
    expect(problems).toContain(
      `perspectives[${String(perspective.id)}]: levers: Invalid input: expected array, received string`
    );
  });

  it('a singleton section that is not an object', () => {
    const doc = model();
    doc.culture = [];
    expect(decompose(howDoesThisLand, doc).problems).toContain('culture: expected an object');
  });

  it('a judge that is not one of the definition’s slots (it would have no agent)', () => {
    const doc = model();
    const judges = list(doc, 'judges');
    judges.push({ ...judges[0], id: 'judge_voice' });
    expect(decompose(howDoesThisLand, doc).problems).toEqual([
      `judge "judge_voice" is not a judge slot this code runs (${howDoesThisLand.judges.slots.join(', ')})`,
    ]);
  });

  it('a version that drops one of the definition’s judge slots (its agent would be idle)', () => {
    const doc = model();
    doc.judges = list(doc, 'judges').filter((j) => j.id !== 'judge_craft');
    expect(decompose(howDoesThisLand, doc).problems).toContain(
      'judge slot "judge_craft" is missing'
    );
  });

  it('a missing judges list once, not again for every slot', () => {
    const doc = model();
    delete doc.judges;
    const { problems } = decompose(howDoesThisLand, doc);
    expect(problems).toContain('missing section "judges"');
    expect(problems.filter((p) => p.startsWith('judge slot'))).toEqual([]);
  });

  it('a file that is not an object', () => {
    expect(decompose(howDoesThisLand, []).problems).toEqual(['the file is not a JSON object']);
  });

  it('reports every problem, not just the first', () => {
    const doc = model();
    list(doc, 'moves')[0].dimensions = ['nope'];
    delete list(doc, 'appeals')[0].name;
    doc.surprise = 1;
    expect(decompose(howDoesThisLand, doc).problems).toHaveLength(3);
  });
});

describe('decompose() accepts', () => {
  it('the judge slots in another order', () => {
    const doc = model();
    doc.judges = [...list(doc, 'judges')].reverse();
    expect(decompose(howDoesThisLand, doc).problems).toEqual([]);
  });

  it('the named judge slots that are not records', () => {
    // judges[].appeal may be "lenses" or "influence" (meta.reference_rules).
    const doc = model();
    const appeals = list(doc, 'judges').map((j) => j.appeal);
    expect(appeals).toEqual(expect.arrayContaining(['lenses', 'influence']));
    expect(decompose(howDoesThisLand, doc).problems).toEqual([]);
  });

  it('a nullable reference left null', () => {
    const doc = model();
    for (const ct of list(doc, 'content_types')) ct.overlay = null;
    expect(decompose(howDoesThisLand, doc).problems).toEqual([]);
  });
});

describe('decompose() and references with more than one target kind', () => {
  it('refuses an id that names records of two of its target kinds', () => {
    // moves[].dimensions may name a dimension, a lens or an extra dimension.
    const doc = model();
    const move = list(doc, 'moves')[0];
    const target = (move.dimensions as string[])[0];
    list(doc, 'lenses').push({ id: target, name: 'A lens with a dimension’s id' });
    expect(decompose(howDoesThisLand, doc).problems).toContain(
      `ambiguous reference: moves[].dimensions on "${String(move.id)}" → "${target}" is a dimension and a lens`
    );
  });

  it('writes one link for an id a record lists twice', () => {
    const doc = model();
    const appeal = list(doc, 'appeals')[0];
    const research = appeal.research as string[];
    appeal.research = [...research, research[0]];
    const { links, problems } = decompose(howDoesThisLand, doc);
    expect(problems).toEqual([]);
    expect(
      links.filter(
        (l) => l.fromKey === appeal.id && l.relation === 'research' && l.toKey === research[0]
      )
    ).toHaveLength(1);
  });
});

describe('compose()', () => {
  it('refuses a stored record whose attributes are not an object', () => {
    const node: NodeRecord = {
      kind: 'appeal',
      key: 'ethos',
      parentKey: null,
      name: 'Ethos',
      position: 0,
      attributes: 'corrupted',
    };
    expect(() => compose(howDoesThisLand, [node])).toThrow(
      'stored record appeal "ethos" is not an object'
    );
  });
});

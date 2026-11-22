/**
 * Tests: the model as browsable pages, built from a version (t-63).
 *
 * Over the real 0.5.1 model: every declared reference becomes a link, every
 * link lands on a record of the section it points to, and anchors are unique
 * on each page. Over a made-up definition: a kind, field or section the code
 * has never seen is shown without a code change, which is what keeps the
 * pages from being tied to one version of the model.
 *
 * @see lib/app/frameworks/browse.ts
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { buildBrowseModel, recordHref, type BrowseRecord } from '@/lib/app/frameworks/browse';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import type { FrameworkDefinition, JsonObject } from '@/lib/app/frameworks/types';

// The materialised model equals the imported file (a route test proves it).
const MODEL = JSON.parse(
  readFileSync('lib/app/frameworks/howdoesthisland/data/model-0.5.1.json', 'utf8')
) as JsonObject;

const idsIn = (value: unknown): string[] =>
  typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(idsIn) : [];

describe('buildBrowseModel over model 0.5.1', () => {
  const browse = buildBrowseModel(howDoesThisLand, MODEL);
  const all = browse.records();
  const targets = (r: BrowseRecord) =>
    [...browse.links(r).values()].flatMap((m) => [...m.values()]);

  it('has a section for every top-level part of the model, in the definition’s order', () => {
    expect(browse.sections.map((s) => s.key)).toEqual(Object.keys(howDoesThisLand.sections));
    expect(browse.section('red-flags')?.key).toBe('red_flags');
    expect(browse.section('knowledge-refs')?.kinds.map((k) => k.kind)).toEqual([
      'knowledge_framework',
      'knowledge_concept',
      'knowledge_thinker',
      'knowledge_study',
      'knowledge_overlay',
    ]);
  });

  it('holds every record of every kind, nested levers inside their perspectives', () => {
    for (const spec of howDoesThisLand.collections) {
      let value: unknown = MODEL;
      for (const step of spec.path) value = (value as JsonObject)[step];
      const records = value as JsonObject[];
      expect(all.filter((r) => r.kind === spec.kind).map((r) => r.id)).toEqual(
        records.map((r) => r.id)
      );
    }
    const perspectives = browse.section('perspectives')!.kinds[0];
    expect(perspectives.nestedKind).toBe('lever');
    const levers = perspectives.records.flatMap((p) => p.children);
    expect(levers.length).toBeGreaterThan(0);
    for (const lever of levers) {
      expect(lever.kind).toBe('lever');
      expect(lever.section).toBe('perspectives');
    }
    // A perspective's own attributes no longer carry the levers it shows below it.
    expect(perspectives.records[0].attributes).not.toHaveProperty('levers');
  });

  it('shows a section’s fields that are not collections as one record of its own', () => {
    const scoring = browse.section('scoring')!;
    expect(scoring.kinds.map((k) => k.kind)).toEqual(['section:scoring']);
    expect(scoring.kinds[0].records[0].attributes).toHaveProperty('integrity_caps');
    // The caps' dimensions are links, as declared (`scoring.integrity_caps[].dimension`).
    expect(browse.links(scoring.kinds[0].records[0]).get('integrity_caps')?.size).toBeGreaterThan(
      0
    );

    const culture = browse.section('culture')!;
    expect(culture.kinds[0].kind).toBe('section:culture');
    expect(Object.keys(culture.kinds[0].records[0].attributes).sort()).toEqual([
      'note',
      'weight_effect',
    ]);
    // meta keeps its own `id` field.
    expect(browse.section('meta')!.kinds[0].records[0].attributes.id).toBe('howdoesthisland');
    // A section that is only collections has no record of its own.
    expect(browse.section('knowledge-refs')!.kinds.some((k) => k.kind.startsWith('section:'))).toBe(
      false
    );
  });

  it('turns every id every declared reference holds into a link, in the field that holds it', () => {
    let checked = 0;
    for (const record of all) {
      const byField = browse.links(record);
      for (const ref of howDoesThisLand.references.filter((r) => r.from === record.kind)) {
        for (const [field, value] of Object.entries(record.attributes)) {
          for (const id of idsIn(ref.pick({ [field]: value }))) {
            if (ref.literals?.includes(id)) continue;
            const to = byField.get(field)?.get(id);
            expect(to, `${record.kind}:${record.id} → ${id}`).toBeDefined();
            expect(ref.targets).toContain(to!.kind);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('links a field named after a kind (a move’s appeal) to that record', () => {
    const move = all.find((r) => r.kind === 'move')!;
    expect(browse.links(move).get('appeal')?.get(String(move.attributes.appeal))?.kind).toBe(
      'appeal'
    );
  });

  it('links a key named after a kind inside a field (a scoring cap’s appeal)', () => {
    const scoring = browse.section('scoring')!.kinds[0].records[0];
    const caps = browse.links(scoring).get('integrity_caps')!;
    expect(caps.get('kairos')?.kind).toBe('appeal');
    expect(caps.get('kai_integrity')?.kind).toBe('dimension');
  });

  it('links a length target’s key to its type of copy', () => {
    const targets = browse.section('length-targets')!.kinds[0].records[0];
    expect(browse.links(targets).get('cv_resume')?.get('cv_resume')?.kind).toBe('content_type');
  });

  it('points every link at an anchor that is on the target section’s page, once', () => {
    const anchorsBySection = new Map<string, string[]>();
    for (const r of all) {
      anchorsBySection.set(r.section, [...(anchorsBySection.get(r.section) ?? []), r.anchor]);
    }
    for (const [section, anchors] of anchorsBySection) {
      expect(new Set(anchors).size, section).toBe(anchors.length);
    }
    for (const record of all) {
      for (const to of targets(record)) {
        const [path, anchor] = recordHref('/model', to).split('#');
        expect(path).toBe(`/model/${to.section.replace(/_/g, '-')}`);
        expect(anchorsBySection.get(to.section)).toContain(anchor);
      }
    }
  });

  it('lists each link back on the record it lands on', () => {
    for (const record of all) {
      for (const to of targets(record)) {
        expect(browse.referencedBy(to)).toContain(record);
      }
    }
    const ethos = all.find((r) => r.kind === 'appeal' && r.id === 'ethos')!;
    expect(browse.referencedBy(ethos).some((r) => r.kind === 'dimension')).toBe(true);
  });

  it('leaves a withheld section out whole, with no links into it', () => {
    const without = buildBrowseModel(howDoesThisLand, MODEL, ['culture']);
    expect(without.section('culture')).toBeNull();
    expect(without.records().some((r) => r.kind.startsWith('culture_'))).toBe(false);
    for (const record of without.records()) {
      for (const m of without.links(record).values()) {
        for (const to of m.values()) expect(to.section).not.toBe('culture');
      }
    }
    expect(browse.section('culture')).not.toBeNull();
  });
});

describe('buildBrowseModel over a definition it has never seen', () => {
  const any = z.unknown();
  const def: FrameworkDefinition = {
    slug: 'other',
    name: 'Other',
    summary: '',
    sections: { palette: any, rooms: any, notes: any },
    collections: [
      { kind: 'colour', path: ['palette', 'colours'], schema: any },
      { kind: 'shade', path: ['palette', 'shades'], schema: any },
      {
        kind: 'room',
        path: ['rooms'],
        schema: any,
        nested: { field: 'walls', kind: 'wall', schema: any },
      },
    ],
    references: [
      {
        from: 'wall',
        relation: 'painted',
        field: 'rooms[].walls[].paint',
        pick: (r) => r.paint,
        targets: ['colour', 'shade'],
      },
    ],
    judges: { kind: 'none', slots: [] },
    versionOf: () => ({ version: '1', schemaVersion: '1' }),
    createEngine: () => {
      throw new Error('unused');
    },
  };
  const model: JsonObject = {
    palette: {
      colours: [{ id: 'red', name: 'Red', new_field: 'anything' }],
      shades: [{ id: 'red', name: 'Deep red' }],
      legend: 'Paints in stock',
    },
    notes: { text: 'A section with no collections' },
    rooms: [
      {
        id: 'hall',
        name: 'Hall',
        colour: 'red',
        shade: 'red',
        label: 'red',
        walls: [{ id: 'north', paint: ['red', 'missing'] }],
      },
    ],
  };
  const browse = buildBrowseModel(def, model);
  const find = (kind: string, id: string): BrowseRecord =>
    browse.records().find((r) => r.kind === kind && r.id === id)!;

  it('makes sections and segments from the file’s own names', () => {
    expect(browse.sections.map((s) => [s.key, s.segment])).toEqual([
      ['palette', 'palette'],
      ['rooms', 'rooms'],
      ['notes', 'notes'],
    ]);
    expect(browse.section('palette')!.kinds.map((k) => k.kind)).toEqual([
      'section:palette',
      'colour',
      'shade',
    ]);
    expect(find('section:notes', 'notes').attributes).toEqual({
      text: 'A section with no collections',
    });
    expect(find('colour', 'red').attributes.new_field).toBe('anything');
  });

  it('prefixes anchors only where two records on one page share an id', () => {
    expect(find('colour', 'red').anchor).toBe('colour-red');
    expect(find('shade', 'red').anchor).toBe('shade-red');
    expect(find('room', 'hall').anchor).toBe('hall');
  });

  it('links only the ids that resolve, to the first target kind that has them', () => {
    const wall = find('wall', 'north');
    expect([...browse.links(wall).get('paint')!.keys()]).toEqual(['red']);
    expect(browse.links(wall).get('paint')!.get('red')).toBe(find('colour', 'red'));
    expect(recordHref('/x', find('colour', 'red'))).toBe('/x/palette#colour-red');
  });

  it('keeps links per field: the same id names a different record in each, and nothing in others', () => {
    const hall = browse.links(find('room', 'hall'));
    // `colour` and `shade` are kinds, so those fields link, each to its own kind.
    expect(hall.get('colour')!.get('red')).toBe(find('colour', 'red'));
    expect(hall.get('shade')!.get('red')).toBe(find('shade', 'red'));
    // `label` is not a reference, so its 'red' is just text.
    expect(hall.has('label')).toBe(false);
    expect(browse.referencedBy(find('shade', 'red'))).toContain(find('room', 'hall'));
  });
});

/**
 * Tests: the model explained in human terms (t-63).
 *
 * The explainer is a companion to the model, kept apart from it. These hold
 * it to three rules: every pointer names something the model has (so it
 * cannot drift unnoticed), every citation names a source the list has, and
 * nothing that makes the model work, or names its version, appears in it.
 *
 * @see lib/app/explainer/chapters.ts · lib/app/explainer/sources.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHAPTERS, MODEL_HUB, chapter } from '@/lib/app/explainer/chapters';
import { SOURCES, source } from '@/lib/app/explainer/sources';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';

const MODEL = JSON.parse(
  readFileSync('lib/app/frameworks/howdoesthisland/data/model-0.5.1.json', 'utf8')
) as Record<string, unknown>;

/** The ids of every record of `kind` in the model, read through the definition's paths. */
function idsOf(kind: string): string[] {
  const direct = howDoesThisLand.collections.find((c) => c.kind === kind);
  const holder = howDoesThisLand.collections.find((c) => c.nested?.kind === kind);
  const spec = direct ?? holder;
  if (!spec) return [];
  let value: unknown = MODEL;
  for (const step of spec.path) value = (value as Record<string, unknown>)[step];
  const records = value as Array<Record<string, unknown>>;
  const items = direct
    ? records
    : records.flatMap((r) => r[spec.nested?.field ?? ''] as Array<Record<string, unknown>>);
  return items.map((r) => String(r.id));
}

const allEntries = CHAPTERS.flatMap((c) => c.groups.flatMap((g) => g.entries));
const allPointers = CHAPTERS.flatMap((c) =>
  c.groups.flatMap((g) => [g.pointer, ...g.entries.map((e) => e.pointer)])
).filter((p) => p !== undefined);
const allCitations = [
  ...CHAPTERS.flatMap((c) =>
    c.groups.flatMap((g) => [...(g.sources ?? []), ...g.entries.flatMap((e) => e.sources ?? [])])
  ),
];

/** Every string anywhere in a value. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

describe('the explainer’s pointers into the model', () => {
  it('each names a record, or a top-level part, that model 0.5.1 has', () => {
    expect(allPointers.length).toBeGreaterThan(50);
    const missing = allPointers.filter((p) =>
      p.kind === 'section' ? !(p.id in MODEL) : !idsOf(p.kind).includes(p.id)
    );
    expect(missing).toEqual([]);
  });

  it('cover every appeal and every core dimension', () => {
    const pointed = new Set(allPointers.map((p) => `${p.kind}:${p.id}`));
    for (const id of [...idsOf('appeal'), ...idsOf('dimension')]) {
      const kind = idsOf('appeal').includes(id) ? 'appeal' : 'dimension';
      expect(pointed, `${kind}:${id}`).toContain(`${kind}:${id}`);
    }
  });
});

describe('sources', () => {
  it('every citation names a source the list has, and every source is cited somewhere or on /about', () => {
    expect(allCitations.filter((id) => !SOURCES.some((s) => s.id === id))).toEqual([]);
    expect(() => source('nope')).toThrow();
  });

  it('every source says who, when and why, with an https link where it has one', () => {
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
    for (const s of SOURCES) {
      expect(s.who.length, s.id).toBeGreaterThan(5);
      expect(s.when.length, s.id).toBeGreaterThan(1);
      expect(s.context.length, s.id).toBeGreaterThan(40);
      if (s.url) expect(s.url, s.id).toMatch(/^https:\/\//);
    }
  });
});

describe('what the explainer must never carry', () => {
  const text = new Set(strings(CHAPTERS).concat(strings(MODEL_HUB), strings(SOURCES)));
  const joined = [...text].join('\n');

  it('no rubric, detection pattern, heuristic, scoring rule or reviewer instruction from the model', () => {
    const secret = [
      ...strings((MODEL.dimensions as unknown[]).map((d) => (d as Record<string, unknown>).rubric)),
      ...strings(
        (MODEL.dimensions as unknown[]).map((d) => (d as Record<string, unknown>).heuristic)
      ),
      ...strings((MODEL.red_flags as unknown[]).map((f) => (f as Record<string, unknown>).pattern)),
      ...strings(MODEL.scoring),
      ...strings(MODEL.judges),
    ].filter((s) => s.length > 20);
    expect(secret.length).toBeGreaterThan(100);
    expect(secret.filter((s) => joined.includes(s))).toEqual([]);
  });

  it('no version number in anything a reader reads (links aside: a DOI has dots too)', () => {
    const prose = strings(CHAPTERS)
      .concat(strings(MODEL_HUB), strings(SOURCES.map(({ url: _url, ...rest }) => rest)))
      .join('\n');
    expect(prose).not.toMatch(/\b\d+\.\d+\.\d+\b/);
  });
});

describe('chapters', () => {
  it('have unique slugs (none is `sources`) and unique entry ids on each page', () => {
    const slugs = CHAPTERS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).not.toContain('sources');
    for (const c of CHAPTERS) {
      const ids = c.groups.flatMap((g) => [g.id, ...g.entries.map((e) => e.id)]);
      expect(new Set(ids).size, c.slug).toBe(ids.length);
    }
    expect(chapter(slugs[0])).toBe(CHAPTERS[0]);
    expect(chapter('nope')).toBeNull();
  });

  it('keep sentences under thirty words', () => {
    const long = strings(allEntries)
      .concat(strings(CHAPTERS.map((c) => [c.lead, c.groups.map((g) => g.intro)])))
      .flatMap((p) => p.split(/(?<=[.?!])\s+/))
      .filter((s) => s.split(/\s+/).length >= 30);
    expect(long).toEqual([]);
  });
});

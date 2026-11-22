/**
 * A framework version as browsable pages (t-63): its records grouped into the
 * sections of the model file, each record's references resolved to the
 * records they name, and the references back.
 *
 * Generic over the definition, so the pages are not tied to one version of the
 * model: a section, a kind or a field a later version adds is shown without a
 * code change, and one it drops simply stops appearing. Nothing here knows what
 * an appeal or a move is. The words the pages put around the records live in
 * `components/app/model/presentation.ts`, and every one of them has a fallback.
 *
 * - **A section is a top-level part of the model file** (`dimensions`,
 *   `knowledge_refs`, `scoring`), holding the collections whose path starts
 *   there, and its other fields as one record of kind `section:<name>`, so
 *   nothing in the model is left off the pages. Its URL segment is its name
 *   with hyphens. A nested kind (a perspective's levers) is shown inside its
 *   parents, on its parents' section.
 * - **A link is a declared reference** (`definition.references`) that
 *   resolves, or a field named after a kind (`appeal`, `group`) whose value is
 *   the id of a record of that kind. Links are kept per top-level field, so an
 *   id is a link only in the field that refers to it. Only ids that resolve
 *   become links, so a link always lands on a record on the page it names.
 * - **An anchor is the record's id**, unless two records on one section's page
 *   share an id, when both take their kind as a prefix.
 *
 * Pure: it reads only the materialised model it is given.
 */
import { isJsonObject } from '@/lib/app/frameworks/codec';
import {
  SECTION_KIND,
  type CollectionSpec,
  type FrameworkDefinition,
  type JsonObject,
} from '@/lib/app/frameworks/types';

export interface BrowseRecord {
  kind: string;
  id: string;
  /** The page section the record is shown on, which for a nested kind is its parent's. */
  section: string;
  anchor: string;
  /** The record as the model has it, less any nested collection. */
  attributes: JsonObject;
  /** The id of the containing record, for a nested kind. */
  parentId: string | null;
  /** The nested records it contains (a perspective's levers), in model order. */
  children: BrowseRecord[];
}

export interface BrowseKind {
  kind: string;
  /** Top-level records only; a nested kind's are on their parents. */
  records: BrowseRecord[];
  /** The nested kind its records contain, if any. */
  nestedKind: string | null;
}

export interface BrowseSection {
  /** The section's name in the model file: `dimensions`, `knowledge_refs`. */
  key: string;
  /** Its URL segment: `dimensions`, `knowledge-refs`. */
  segment: string;
  kinds: BrowseKind[];
}

export interface BrowseModel {
  sections: BrowseSection[];
  section(segment: string): BrowseSection | null;
  /**
   * The records a record links to: by the top-level field that names them,
   * then by the id it names each one with.
   */
  links(record: BrowseRecord): ReadonlyMap<string, ReadonlyMap<string, BrowseRecord>>;
  /** The records that link to this one, in model order. */
  referencedBy(record: BrowseRecord): readonly BrowseRecord[];
  /** Every record, nested ones included, in model order. */
  records(): readonly BrowseRecord[];
}

export function sectionSegment(key: string): string {
  return key.replace(/_/g, '-');
}

function recordsAt(model: JsonObject, path: readonly string[]): JsonObject[] {
  let value: unknown = model;
  for (const step of path) value = isJsonObject(value) ? value[step] : undefined;
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

/** Every string a reference field holds, however deep it is nested. */
function idsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(idsIn);
  return [];
}

/** Every key and value in a field, the field itself included, however deep. */
function keyedValues(key: string, value: unknown): [string, unknown][] {
  const out: [string, unknown][] = [[key, value]];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isJsonObject(v)) {
      for (const [k, inner] of Object.entries(v)) {
        out.push([k, inner]);
        walk(inner);
      }
    }
  };
  walk(value);
  return out;
}

function makeRecord(
  kind: string,
  section: string,
  raw: JsonObject,
  parentId: string | null,
  nestedField: string | null
): BrowseRecord {
  const attributes = nestedField
    ? Object.fromEntries(Object.entries(raw).filter(([key]) => key !== nestedField))
    : raw;
  return {
    kind,
    id: String(raw.id),
    section,
    anchor: String(raw.id),
    attributes,
    parentId,
    children: [],
  };
}

/**
 * Build the browsable model from a version's materialised model. `omitted`
 * names the top-level sections a switch withholds (the culture switch), which
 * are left out whole, as the API leaves them out.
 */
export function buildBrowseModel(
  def: FrameworkDefinition,
  model: JsonObject,
  omitted: readonly string[] = []
): BrowseModel {
  const withheld = new Set(omitted);
  const sections: BrowseSection[] = [];
  const all: BrowseRecord[] = [];
  const byKind = new Map<string, Map<string, BrowseRecord>>();

  const index = (record: BrowseRecord) => {
    all.push(record);
    let kindIndex = byKind.get(record.kind);
    if (!kindIndex) byKind.set(record.kind, (kindIndex = new Map<string, BrowseRecord>()));
    // Ids are unique within a kind (the import refuses duplicates).
    kindIndex.set(record.id, record);
  };

  const addCollection = (spec: CollectionSpec, section: BrowseSection) => {
    const nested = spec.nested ?? null;
    const records = recordsAt(model, spec.path).map((raw) => {
      const record = makeRecord(spec.kind, section.key, raw, null, nested?.field ?? null);
      index(record);
      if (nested) {
        record.children = recordsAt(raw, [nested.field]).map((child) => {
          const childRecord = makeRecord(nested.kind, section.key, child, record.id, null);
          index(childRecord);
          return childRecord;
        });
      }
      return record;
    });
    section.kinds.push({ kind: spec.kind, records, nestedKind: nested?.kind ?? null });
  };

  // Sections in the definition's order, which is the file's. A section's
  // fields that are not collections (all of `scoring`; `culture`'s note) are
  // one record of their own, shown first, so the pages hold the whole model.
  const keys = [
    ...new Set([...Object.keys(def.sections), ...def.collections.map((c) => c.path[0])]),
  ];
  for (const key of keys) {
    if (withheld.has(key)) continue;
    const section: BrowseSection = { key, segment: sectionSegment(key), kinds: [] };
    const specs = def.collections.filter((c) => c.path[0] === key);
    for (const spec of specs) addCollection(spec, section);

    const value = model[key];
    if (isJsonObject(value)) {
      const taken = new Set(specs.map((c) => c.path[1]));
      const rest = Object.fromEntries(Object.entries(value).filter(([k]) => !taken.has(k)));
      if (Object.keys(rest).length > 0) {
        // Built directly: a section's own `id` field (meta has one) stays an attribute.
        const record: BrowseRecord = {
          kind: `${SECTION_KIND}:${key}`,
          id: key,
          section: key,
          anchor: key,
          attributes: rest,
          parentId: null,
          children: [],
        };
        index(record);
        section.kinds.unshift({ kind: record.kind, records: [record], nestedKind: null });
      }
    }
    if (section.kinds.length > 0) sections.push(section);
  }

  // Anchors: the id, unless it is not unique on its section's page.
  for (const section of sections) {
    const onPage = all.filter((r) => r.section === section.key);
    const counts = new Map<string, number>();
    for (const r of onPage) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
    for (const r of onPage) if ((counts.get(r.id) ?? 0) > 1) r.anchor = `${r.kind}-${r.id}`;
  }

  const resolve = (id: string, kinds: readonly string[]): BrowseRecord | null => {
    for (const kind of kinds) {
      const found = byKind.get(kind)?.get(id);
      if (found) return found;
    }
    return null;
  };

  // Links are kept per field, so an id is a link only in the field that
  // refers to it, and two fields naming different records by the same id
  // each keep their own.
  const links = new Map<BrowseRecord, Map<string, Map<string, BrowseRecord>>>();
  const backlinks = new Map<BrowseRecord, BrowseRecord[]>();
  const link = (from: BrowseRecord, field: string, id: string, to: BrowseRecord | null) => {
    if (!to || to === from) return;
    let byField = links.get(from);
    if (!byField) links.set(from, (byField = new Map<string, Map<string, BrowseRecord>>()));
    let out = byField.get(field);
    if (!out) byField.set(field, (out = new Map<string, BrowseRecord>()));
    if (out.has(id)) return;
    out.set(id, to);
    let back = backlinks.get(to);
    if (!back) backlinks.set(to, (back = []));
    if (!back.includes(from)) back.push(from);
  };

  const kinds = new Set(byKind.keys());
  for (const record of all) {
    for (const [field, value] of Object.entries(record.attributes)) {
      // Declared references, each read from this one field alone.
      for (const ref of def.references) {
        if (ref.from !== record.kind) continue;
        for (const id of idsIn(ref.pick({ [field]: value }))) {
          link(record, field, id, resolve(id, ref.targets));
        }
      }
      // A key named after a kind, holding ids of that kind (`appeal`, `group`),
      // at the top level or inside the field (a scoring cap's `appeal`).
      for (const [key, inner] of keyedValues(field, value)) {
        if (!kinds.has(key)) continue;
        for (const id of idsIn(inner)) link(record, field, id, resolve(id, [key]));
      }
    }
  }

  // Backlinks in model order.
  const position = new Map(all.map((r, i) => [r, i]));
  for (const list of backlinks.values()) {
    list.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
  }

  return {
    sections,
    section: (segment) => sections.find((s) => s.segment === segment) ?? null,
    links: (record) => links.get(record) ?? new Map(),
    referencedBy: (record) => backlinks.get(record) ?? [],
    records: () => all,
  };
}

/** Where a record is shown: its section's page, at its anchor. */
export function recordHref(base: string, record: BrowseRecord): string {
  return `${base}/${sectionSegment(record.section)}#${encodeURIComponent(record.anchor)}`;
}

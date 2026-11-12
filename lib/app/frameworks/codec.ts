/**
 * Turns a framework file into records and links, and records back into the
 * file (app-plan §8.1).
 *
 * `decompose()` checks everything the import must refuse — an unknown or
 * missing section, a record failing its kind's schema, a duplicate key, an
 * unresolved reference — and returns every problem found, not just the first.
 * `compose()` is its inverse: `compose(decompose(file).nodes)` deep-equals the
 * file, array order included.
 *
 * **Reference fields stay in the records' attributes; links are an index of
 * them.** Several reference fields are ordered lists, maps (`weights`) or
 * nullable scalars, and a link row has no position or shape, so rebuilding
 * them from links would lose the file's form. The links are written from the
 * attributes in the same import, are checked to resolve, and can never change
 * once the version is published, so the two cannot drift.
 */
import type { z } from 'zod';
import {
  SECTION_KIND,
  type CollectionSpec,
  type FrameworkDefinition,
  type JsonObject,
  type LinkRecord,
  type NodeRecord,
} from '@/lib/app/frameworks/types';

export interface Decomposed {
  nodes: NodeRecord[];
  links: LinkRecord[];
  problems: string[];
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '(record)'}: ${issue.message}`)
    .join('; ');
}

/** Collections by the top-level section they sit in. */
function collectionsBySection(def: FrameworkDefinition): Map<string, CollectionSpec[]> {
  const bySection = new Map<string, CollectionSpec[]>();
  for (const spec of def.collections) {
    const list = bySection.get(spec.path[0]) ?? [];
    list.push(spec);
    bySection.set(spec.path[0], list);
  }
  return bySection;
}

function readEntities(list: unknown, where: string, problems: string[]): JsonObject[] {
  if (!Array.isArray(list)) {
    problems.push(`${where}: expected a list of records`);
    return [];
  }
  const entities: JsonObject[] = [];
  list.forEach((item, index) => {
    if (!isJsonObject(item) || typeof item.id !== 'string' || item.id === '') {
      problems.push(`${where}[${index}]: a record with no string id`);
      return;
    }
    entities.push(item);
  });
  return entities;
}

function nameOf(record: JsonObject): string | null {
  return typeof record.name === 'string' ? record.name : null;
}

export function decompose(def: FrameworkDefinition, document: unknown): Decomposed {
  const problems: string[] = [];
  const nodes: NodeRecord[] = [];
  if (!isJsonObject(document)) {
    return { nodes, links: [], problems: ['the file is not a JSON object'] };
  }

  for (const section of Object.keys(document)) {
    if (!(section in def.sections)) problems.push(`unknown section "${section}"`);
  }
  for (const section of Object.keys(def.sections)) {
    if (!(section in document)) problems.push(`missing section "${section}"`);
  }

  // Records by kind, for duplicate checks and reference resolution.
  const records = new Map<string, Map<string, JsonObject>>();
  const addNode = (node: NodeRecord, record: JsonObject, where: string) => {
    const ofKind = records.get(node.kind) ?? new Map<string, JsonObject>();
    if (ofKind.has(node.key)) {
      problems.push(`${where}: duplicate key "${node.key}"`);
      return;
    }
    ofKind.set(node.key, record);
    records.set(node.kind, ofKind);
    nodes.push(node);
  };

  const checkSchema = (schema: z.ZodType, value: unknown, where: string): boolean => {
    const result = schema.safeParse(value);
    if (!result.success) problems.push(`${where}: ${describeIssues(result.error)}`);
    return result.success;
  };

  const bySection = collectionsBySection(def);
  for (const [section, sectionSchema] of Object.entries(def.sections)) {
    if (!(section in document)) continue;
    const value = document[section];
    const specs = bySection.get(section) ?? [];
    const whole = specs.find((spec) => spec.path.length === 1);

    if (whole) {
      readEntities(value, section, problems).forEach((entity, position) => {
        const where = `${section}[${String(entity.id)}]`;
        addCollectionEntity(whole, entity, position, where);
      });
      continue;
    }

    // A singleton section: its remainder is one node; its sub-collections
    // (`knowledge_refs.thinkers`) are records of their own.
    if (!isJsonObject(value)) {
      problems.push(`${section}: expected an object`);
      continue;
    }
    const remainder: JsonObject = { ...value };
    for (const spec of specs) {
      const field = spec.path[1] as string;
      delete remainder[field];
      if (!(field in value)) {
        problems.push(`missing section "${section}.${field}"`);
        continue;
      }
      readEntities(value[field], `${section}.${field}`, problems).forEach((entity, position) => {
        const where = `${section}.${field}[${String(entity.id)}]`;
        addCollectionEntity(spec, entity, position, where);
      });
    }
    if (checkSchema(sectionSchema, remainder, section)) {
      addNode(
        {
          kind: SECTION_KIND,
          key: section,
          parentKey: null,
          name: null,
          position: 0,
          attributes: remainder,
        },
        remainder,
        section
      );
    }
  }

  function addCollectionEntity(
    spec: CollectionSpec,
    entity: JsonObject,
    position: number,
    where: string
  ): void {
    if (!checkSchema(spec.schema, entity, where)) return;
    const attributes: JsonObject = { ...entity };
    const key = String(entity.id);
    if (spec.nested) {
      const { field, kind, schema } = spec.nested;
      delete attributes[field];
      const children = entity[field];
      if (!Array.isArray(children)) {
        problems.push(`${where}.${field}: expected a list of records`);
      } else {
        readEntities(children, `${where}.${field}`, problems).forEach((child, index) => {
          const childWhere = `${where}.${field}[${String(child.id)}]`;
          if (!checkSchema(schema, child, childWhere)) return;
          addNode(
            {
              kind,
              key: String(child.id),
              parentKey: key,
              name: nameOf(child),
              position: index,
              attributes: child,
            },
            child,
            childWhere
          );
        });
      }
    }
    addNode(
      { kind: spec.kind, key, parentKey: null, name: nameOf(entity), position, attributes },
      // References are read from the full record, nested fields included.
      entity,
      where
    );
  }

  const links = resolveReferences(def, records, problems);
  return { nodes, links, problems };
}

function resolveReferences(
  def: FrameworkDefinition,
  records: Map<string, Map<string, JsonObject>>,
  problems: string[]
): LinkRecord[] {
  const links: LinkRecord[] = [];
  const seen = new Set<string>();

  for (const ref of def.references) {
    const [fromKind, fromKeyFixed] = ref.from.startsWith(`${SECTION_KIND}:`)
      ? [SECTION_KIND, ref.from.slice(SECTION_KIND.length + 1)]
      : [ref.from, null];
    const holders = records.get(fromKind) ?? new Map<string, JsonObject>();

    for (const [fromKey, record] of holders) {
      if (fromKeyFixed !== null && fromKey !== fromKeyFixed) continue;
      const picked = ref.pick(record);
      if (picked === null || picked === undefined) continue;
      const ids = Array.isArray(picked) ? picked : [picked];
      const where = fromKeyFixed === null ? `${ref.field} on "${fromKey}"` : ref.field;

      for (const id of ids) {
        if (typeof id !== 'string') {
          problems.push(`${where}: a reference that is not a string id`);
          continue;
        }
        if (ref.literals?.includes(id)) continue;
        const matches = ref.targets.filter((kind) => records.get(kind)?.has(id));
        if (matches.length === 0) {
          problems.push(`unresolved reference: ${where} → "${id}" (${ref.targets.join(' or ')})`);
          continue;
        }
        if (matches.length > 1) {
          problems.push(`ambiguous reference: ${where} → "${id}" is a ${matches.join(' and a ')}`);
          continue;
        }
        const toKind = matches[0] as string;
        const identity = `${fromKind}\u0000${fromKey}\u0000${toKind}\u0000${id}\u0000${ref.relation}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        links.push({ fromKind, fromKey, toKind, toKey: id, relation: ref.relation });
      }
    }
  }
  return links;
}

/** Rebuilds the file from its records. The inverse of `decompose()`. */
export function compose(def: FrameworkDefinition, nodes: readonly NodeRecord[]): JsonObject {
  const byKind = new Map<string, NodeRecord[]>();
  for (const node of nodes) {
    const list = byKind.get(node.kind) ?? [];
    list.push(node);
    byKind.set(node.kind, list);
  }
  const ordered = (kind: string) =>
    [...(byKind.get(kind) ?? [])].sort((a, b) => a.position - b.position);

  const entities = (spec: CollectionSpec): JsonObject[] => {
    const children = new Map<string, JsonObject[]>();
    if (spec.nested) {
      for (const child of ordered(spec.nested.kind)) {
        const parent = child.parentKey ?? '';
        const list = children.get(parent) ?? [];
        list.push(child.attributes as JsonObject);
        children.set(parent, list);
      }
    }
    return ordered(spec.kind).map((node) => {
      const record = { ...(node.attributes as JsonObject) };
      if (spec.nested) record[spec.nested.field] = children.get(node.key) ?? [];
      return record;
    });
  };

  const document: JsonObject = {};
  const sections = new Map(ordered(SECTION_KIND).map((node) => [node.key, node]));
  const bySection = collectionsBySection(def);

  for (const section of Object.keys(def.sections)) {
    const specs = bySection.get(section) ?? [];
    const whole = specs.find((spec) => spec.path.length === 1);
    if (whole) {
      document[section] = entities(whole);
      continue;
    }
    const node = sections.get(section);
    if (!node) continue;
    const value: JsonObject = { ...(node.attributes as JsonObject) };
    for (const spec of specs) value[spec.path[1] as string] = entities(spec);
    document[section] = value;
  }
  return document;
}

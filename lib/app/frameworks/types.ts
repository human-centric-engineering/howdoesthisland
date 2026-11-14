/**
 * What a framework is, in code (app-plan §8.1, D2).
 *
 * A framework's records are data, imported from a reviewed JSON file and
 * versioned. Its definition is code: which sections the file has, which of
 * them are collections of records (each with a Zod schema), and which fields
 * refer to other records. The store is generic over this; HowDoesThisLand is
 * the first definition (`lib/app/frameworks/howdoesthisland/definition.ts`).
 */
import type { z } from 'zod';
import type { FrameworkEngine } from '@/lib/app/frameworks/engine';

/** A JSON object, as parsed from a framework file. */
export type JsonObject = { [key: string]: unknown };

/**
 * A collection of records in the file: a list of objects, each with an `id`.
 * Each becomes one node of `kind`, keyed by its `id`, ordered by `position`.
 */
export interface CollectionSpec {
  kind: string;
  /** Where the list sits: `['appeals']`, or `['knowledge_refs', 'thinkers']`. */
  path: readonly [string] | readonly [string, string];
  schema: z.ZodType;
  /**
   * A list of records inside each record (a perspective's levers). They become
   * nodes of their own kind, with `parentKey` set to the containing record's
   * key, and are left out of the parent's attributes.
   */
  nested?: { field: string; kind: string; schema: z.ZodType };
}

/**
 * A field that refers to other records. Every id it holds must resolve to a
 * record of one of the `targets` kinds, or be one of `literals` (names that
 * are not records, e.g. a judge slot called `lenses`). Each resolved id
 * becomes a link of `relation` from the record holding the field.
 */
export interface ReferenceSpec {
  /** The kind holding the field, or `section:<name>` for a singleton section. */
  from: string;
  relation: string;
  /** Human path, used in error messages: `moves[].dimensions`. */
  field: string;
  /** The ids the field holds on one record. `null` and absent are allowed. */
  pick: (record: JsonObject) => unknown;
  targets: readonly string[];
  literals?: readonly string[];
}

export interface FrameworkDefinition {
  slug: string;
  name: string;
  summary: string;
  /**
   * Every top-level section the file has, each with the schema its remainder
   * must meet once its collections are taken out. A section missing from the
   * file, or one not listed here, is refused.
   */
  sections: Readonly<Record<string, z.ZodType>>;
  collections: readonly CollectionSpec[];
  references: readonly ReferenceSpec[];
  /**
   * The judge slots: the ids of the records of `kind` (the model's
   * `judges[]`). Order is not part of the check; it is the order agents are
   * listed in. Code, not data (app-plan §5): each slot is a platform agent every
   * workspace owns (`lib/app/judges/agents.ts`), so a version that adds,
   * drops or renames a judge needs code to run it. `decompose()` refuses a
   * version whose records of `kind` are not this set.
   */
  judges: { kind: string; slots: readonly string[] };
  /** Reads the version and schema version from the file's own metadata. */
  versionOf: (document: JsonObject) => { version: string; schemaVersion: string };
  /**
   * The engine that scores a text against a version of this framework, given
   * that version's materialised model (`materialise()`). Throws when the model
   * lacks something the engine reads.
   */
  createEngine: (model: JsonObject) => FrameworkEngine;
}

/** One record as it is stored: a row of `app_framework_node`, without ids. */
export interface NodeRecord {
  kind: string;
  key: string;
  parentKey: string | null;
  name: string | null;
  position: number;
  attributes: unknown;
}

/** One reference as it is stored, by the kind and key at each end. */
export interface LinkRecord {
  fromKind: string;
  fromKey: string;
  toKind: string;
  toKey: string;
  relation: string;
}

/** The kind a singleton section's node takes. Its key is the section name. */
export const SECTION_KIND = 'section';

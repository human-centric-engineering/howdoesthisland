/**
 * Import, publish and read framework versions (app-plan §8.1).
 *
 * Properties (`fp4`):
 *
 * - **Import is idempotent.** The same file (by sha256) twice writes nothing.
 *   A different file under a draft's version number replaces the draft; under
 *   a published one it is refused.
 * - **Every problem is refused before anything is written**: an unknown or
 *   missing section, a record failing its schema, a duplicate key, an
 *   unresolved reference. The error lists them all.
 * - **Published is immutable.** No path here updates or deletes a published
 *   version's records, and the repo conditions each write on the draft state.
 * - **The round trip is exact**, and a published version's materialised model
 *   is cached for the life of the process, since it cannot change.
 */
import { compose, decompose, isJsonObject } from '@/lib/app/frameworks/codec';
import type { FrameworkRepo, StoredVersion } from '@/lib/app/frameworks/repo';
import type { FrameworkDefinition, JsonObject } from '@/lib/app/frameworks/types';

export type FrameworkStoreErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_MODEL'
  | 'VERSION_PUBLISHED'
  | 'VERSION_NOT_FOUND'
  | 'VERSION_NOT_DRAFT';

export class FrameworkStoreError extends Error {
  constructor(
    readonly code: FrameworkStoreErrorCode,
    message: string,
    readonly problems: readonly string[] = []
  ) {
    super(problems.length ? `${message}\n  ${problems.join('\n  ')}` : message);
    this.name = 'FrameworkStoreError';
  }
}

/** sha256 of a text's UTF-8 bytes, as hex. Web Crypto, so it runs in any realm. */
export async function sha256(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type ImportOutcome = 'created' | 'replaced' | 'unchanged';

export interface ImportResult {
  outcome: ImportOutcome;
  version: StoredVersion;
  nodeCount: number;
  linkCount: number;
}

/**
 * Imports a framework file as a draft version. `raw` is the file's text, so
 * its checksum is of the bytes as reviewed.
 */
export async function importVersion(
  repo: FrameworkRepo,
  def: FrameworkDefinition,
  raw: string
): Promise<ImportResult> {
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (err) {
    throw new FrameworkStoreError(
      'INVALID_JSON',
      `The file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const { nodes, links, problems } = decompose(def, document);
  if (problems.length > 0 || !isJsonObject(document)) {
    throw new FrameworkStoreError(
      'INVALID_MODEL',
      `The ${def.name} model was refused: ${problems.length} problem(s).`,
      problems
    );
  }

  const { version, schemaVersion } = def.versionOf(document);
  const sourceSha256 = await sha256(raw);
  const content = { version, schemaVersion, sourceDocument: document, sourceSha256, nodes, links };
  const counts = { nodeCount: nodes.length, linkCount: links.length };

  const existing = await repo.findVersion(def.slug, version);
  if (!existing) {
    const created = await repo.createDraft(
      { slug: def.slug, name: def.name, summary: def.summary },
      content
    );
    return { outcome: 'created', version: created, ...counts };
  }
  if (existing.sourceSha256 === sourceSha256) {
    return { outcome: 'unchanged', version: existing, ...counts };
  }
  if (existing.status !== 'DRAFT' || !(await repo.replaceDraft(existing.id, content))) {
    throw new FrameworkStoreError(
      'VERSION_PUBLISHED',
      `${def.slug} ${version} is already published, and this file differs from it. ` +
        'A published version never changes: give the file a new version number.'
    );
  }
  return { outcome: 'replaced', version: { ...existing, sourceSha256, schemaVersion }, ...counts };
}

export type PublishOutcome = 'published' | 'already_published';

/** Publishes a draft. Publishing a published version changes nothing. */
export async function publishVersion(
  repo: FrameworkRepo,
  slug: string,
  version: string,
  now: Date = new Date()
): Promise<{ outcome: PublishOutcome; version: StoredVersion }> {
  const existing = await repo.findVersion(slug, version);
  if (!existing) {
    throw new FrameworkStoreError('VERSION_NOT_FOUND', `No ${slug} version ${version} to publish.`);
  }
  if (existing.status === 'PUBLISHED') return { outcome: 'already_published', version: existing };
  if (existing.status !== 'DRAFT' || !(await repo.markPublished(existing.id, now))) {
    throw new FrameworkStoreError(
      'VERSION_NOT_DRAFT',
      `${slug} ${version} is ${existing.status.toLowerCase()}, so it cannot be published.`
    );
  }
  return { outcome: 'published', version: { ...existing, status: 'PUBLISHED', publishedAt: now } };
}

const materialised = new Map<string, JsonObject>();

/**
 * Rebuilds a version's model from its records. A published version's result
 * is cached by version id; a draft's is not, since a re-import can change it.
 */
export async function materialise(
  repo: FrameworkRepo,
  def: FrameworkDefinition,
  versionId: string
): Promise<JsonObject> {
  const cached = materialised.get(versionId);
  if (cached) return cached;

  const version = await repo.findVersionById(versionId);
  if (!version || version.frameworkSlug !== def.slug) {
    throw new FrameworkStoreError(
      'VERSION_NOT_FOUND',
      `No ${def.slug} version with id ${versionId}.`
    );
  }
  const model = compose(def, await repo.readNodes(versionId));
  if (version.status === 'PUBLISHED') materialised.set(versionId, deepFreeze(model));
  return model;
}

/** A cached model is shared by every caller, so none of them may change it. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Test seam: forget cached models. */
export function __resetMaterialiseCacheForTests(): void {
  materialised.clear();
}

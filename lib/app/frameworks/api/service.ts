/**
 * What the public `frameworks` routes serve (t-11, app-plan §4 API map).
 *
 * - **Published only.** A draft version is a 404, and a framework with no
 *   published version is too. A retired version stays readable: assessments
 *   made with it cite it.
 * - **The model as materialised**, not the stored file: the records are what
 *   scores (§8.1). `meta.sourceSha256` is the imported file's checksum, so a
 *   caller can check the response against the reviewed file.
 * - **The culture switch (D11)** withholds whole sections. A withheld section
 *   is left out of the model and named in `meta.omitted`, and its kinds are
 *   unknown kinds.
 * - **Each lookup that fails has its own code**, so a caller can tell a
 *   mistyped slug from a version that is not out yet.
 *
 * The ETag of a version response is computed from the version's identity, not
 * its body: a published version cannot change, so a 304 costs no materialise.
 */
import { z } from 'zod';
import { withheldSections } from '@/lib/app/frameworks/culture';
import { isJsonObject } from '@/lib/app/frameworks/codec';
import { getFrameworkDefinition } from '@/lib/app/frameworks/registry';
import { prismaFrameworkRepo, type FrameworkRepo } from '@/lib/app/frameworks/repo';
import { materialise } from '@/lib/app/frameworks/store';
import type { FrameworkDefinition, JsonObject } from '@/lib/app/frameworks/types';
import {
  prismaFrameworkCatalog,
  type FrameworkCatalog,
  type ServedFramework,
  type ServedVersion,
} from '@/lib/app/frameworks/api/catalog';

export type FrameworkApiErrorCode =
  'FRAMEWORK_NOT_FOUND' | 'FRAMEWORK_VERSION_NOT_FOUND' | 'FRAMEWORK_KIND_NOT_FOUND';

/** A lookup that found nothing to serve. Always a 404. */
export class FrameworkApiError extends Error {
  readonly status = 404;
  constructor(
    readonly code: FrameworkApiErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'FrameworkApiError';
  }
}

export interface FrameworkApiDeps {
  catalog: FrameworkCatalog;
  repo: FrameworkRepo;
}

const defaultDeps: FrameworkApiDeps = {
  catalog: prismaFrameworkCatalog,
  repo: prismaFrameworkRepo,
};

// Path segments are checked before any query: anything else cannot name a
// record, so it is the same 404 a well-formed unknown value gets.
const slugParam = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const versionParam = z
  .string()
  .max(64)
  .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
const kindParam = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export interface VersionSummary {
  version: string;
  schemaVersion: string;
  status: 'published' | 'retired';
  publishedAt: string | null;
  sourceSha256: string;
}

export interface FrameworkSummary {
  slug: string;
  name: string;
  summary: string;
  /**
   * The most recently published version that is not retired: the one to use
   * for new work. Null when every version has been retired.
   */
  latestVersion: string | null;
  versions: VersionSummary[];
}

export interface FrameworkDetail extends FrameworkSummary {
  /** The record kinds `…/versions/{version}/{kind}` serves, in model order. */
  kinds: string[];
}

function summariseVersion(v: ServedVersion): VersionSummary {
  return {
    version: v.version,
    schemaVersion: v.schemaVersion,
    status: v.status === 'PUBLISHED' ? 'published' : 'retired',
    publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
    sourceSha256: v.sourceSha256,
  };
}

function summarise(fw: ServedFramework): FrameworkSummary {
  return {
    slug: fw.slug,
    name: fw.name,
    summary: fw.summary,
    latestVersion: fw.versions.find((v) => v.status === 'PUBLISHED')?.version ?? null,
    versions: fw.versions.map(summariseVersion),
  };
}

/** The record kinds served right now: every collection not withheld. */
export function servedKinds(def: FrameworkDefinition): string[] {
  const withheld = new Set(withheldSections(def));
  return def.collections.flatMap((spec) =>
    withheld.has(spec.path[0]) ? [] : [spec.kind, ...(spec.nested ? [spec.nested.kind] : [])]
  );
}

/** Every framework with a published version. One the code does not define is not served. */
export async function listFrameworks(deps = defaultDeps): Promise<FrameworkSummary[]> {
  const frameworks = await deps.catalog.listFrameworks();
  return frameworks.filter((fw) => getFrameworkDefinition(fw.slug)).map(summarise);
}

async function findServed(
  slug: string,
  deps: FrameworkApiDeps
): Promise<{ def: FrameworkDefinition; framework: ServedFramework }> {
  const def = slugParam.safeParse(slug).success ? getFrameworkDefinition(slug) : null;
  const framework = def ? await deps.catalog.findFramework(slug) : null;
  if (!def || !framework) {
    throw new FrameworkApiError('FRAMEWORK_NOT_FOUND', `No published framework "${slug}".`);
  }
  return { def, framework };
}

export async function getFramework(slug: string, deps = defaultDeps): Promise<FrameworkDetail> {
  const { def, framework } = await findServed(slug, deps);
  return { ...summarise(framework), kinds: servedKinds(def) };
}

/** A published version, found but not yet read. */
export interface ResolvedVersion {
  def: FrameworkDefinition;
  framework: ServedFramework;
  version: ServedVersion;
  /** Sections withheld by a switch, decided once per request. */
  omitted: string[];
}

export async function resolveVersion(
  slug: string,
  version: string,
  deps = defaultDeps
): Promise<ResolvedVersion> {
  const { def, framework } = await findServed(slug, deps);
  const found = versionParam.safeParse(version).success
    ? framework.versions.find((v) => v.version === version)
    : undefined;
  if (!found) {
    throw new FrameworkApiError(
      'FRAMEWORK_VERSION_NOT_FOUND',
      `${slug} has no published version "${version}".`
    );
  }
  return { def, framework, version: found, omitted: withheldSections(def) };
}

/** The shape of a version response, for its ETag. See {@link versionETagSource}. */
export const VERSION_RESPONSE_SHAPE = 1;

/**
 * What a version response's ETag is computed from. A published version's
 * records never change, so its id and checksum stand for them; the status
 * and the withheld sections are the parts of the response that can, and so
 * is the code that shapes it: bump {@link VERSION_RESPONSE_SHAPE} whenever a
 * change here, in `compose()` or in a definition alters what a version's
 * response contains, or callers holding an old ETag keep their old body.
 */
export function versionETagSource(resolved: ResolvedVersion, kind?: string): unknown {
  const { id, status, sourceSha256 } = resolved.version;
  return {
    shape: VERSION_RESPONSE_SHAPE,
    id,
    status,
    sourceSha256,
    omitted: resolved.omitted,
    kind: kind ?? null,
  };
}

function versionMeta(resolved: ResolvedVersion): Record<string, unknown> {
  const { framework, version, omitted } = resolved;
  return {
    framework: framework.slug,
    ...summariseVersion(version),
    ...(omitted.length ? { omitted } : {}),
  };
}

/** The whole model, less any withheld section. */
export async function versionDocument(
  resolved: ResolvedVersion,
  deps = defaultDeps
): Promise<{ data: JsonObject; meta: Record<string, unknown> }> {
  const model = await materialise(deps.repo, resolved.def, resolved.version.id);
  const data = resolved.omitted.length
    ? Object.fromEntries(Object.entries(model).filter(([key]) => !resolved.omitted.includes(key)))
    : model;
  return { data, meta: versionMeta(resolved) };
}

function recordsAt(model: JsonObject, path: readonly string[]): JsonObject[] {
  let value: unknown = model;
  for (const step of path) value = isJsonObject(value) ? value[step] : undefined;
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

/** Throws `FRAMEWORK_KIND_NOT_FOUND` unless `kind` is served for this version right now. */
export function assertServedKind(resolved: ResolvedVersion, kind: string): void {
  if (!kindParam.safeParse(kind).success || !servedKinds(resolved.def).includes(kind)) {
    throw new FrameworkApiError(
      'FRAMEWORK_KIND_NOT_FOUND',
      `${resolved.def.slug} ${resolved.version.version} has no kind "${kind}".`
    );
  }
}

/**
 * One kind's records, in model order, each exactly as the model has it. A
 * nested kind (a lever) is flattened across its parents, and `meta.parents`
 * maps each record's id to its parent's.
 */
export async function kindRecords(
  resolved: ResolvedVersion,
  kind: string,
  deps = defaultDeps
): Promise<{ data: JsonObject[]; meta: Record<string, unknown> }> {
  const { def } = resolved;
  assertServedKind(resolved, kind);
  const model = await materialise(deps.repo, def, resolved.version.id);
  const meta = { ...versionMeta(resolved), kind };

  const direct = def.collections.find((spec) => spec.kind === kind);
  if (direct) {
    const data = recordsAt(model, direct.path);
    return { data, meta: { ...meta, count: data.length } };
  }

  // servedKinds() vouched for it, so it is some collection's nested kind.
  const holder = def.collections.find((spec) => spec.nested?.kind === kind);
  const field = holder?.nested?.field ?? '';
  const data: JsonObject[] = [];
  const parents: Record<string, string> = {};
  for (const parent of holder ? recordsAt(model, holder.path) : []) {
    for (const child of recordsAt(parent, [field])) {
      data.push(child);
      parents[String(child.id)] = String(parent.id);
    }
  }
  return {
    data,
    meta: { ...meta, count: data.length, parentKind: holder?.kind ?? null, parents },
  };
}

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
import { kindParam, slugParam, versionParam } from '@/lib/app/frameworks/api/validations';
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

// A type, not an interface, so the meta types built on it stay assignable to
// the `Record<string, unknown>` a success envelope's `meta` takes.
export type VersionSummary = {
  version: string;
  schemaVersion: string;
  status: 'published' | 'retired';
  publishedAt: string | null;
  sourceSha256: string;
};

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

/**
 * One framework and its versions. It no longer lists the record kinds (t-67):
 * the kind route is for platform admins only, and the list described the
 * model's structure to everyone else.
 */
export type FrameworkDetail = FrameworkSummary;

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
  const { framework } = await findServed(slug, deps);
  return summarise(framework);
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

/** The `meta` of a version response. */
export type VersionMeta = VersionSummary & {
  framework: string;
  /** Sections a switch withholds; absent when none is. */
  omitted?: string[];
};

/** The `meta` of a kind response. `parentKind` and `parents` only for a nested kind. */
export type KindMeta = VersionMeta & {
  kind: string;
  count: number;
  parentKind?: string | null;
  parents?: Record<string, string>;
};

function versionMeta(resolved: ResolvedVersion): VersionMeta {
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
): Promise<{ data: JsonObject; meta: VersionMeta }> {
  const model = await materialise(deps.repo, resolved.def, resolved.version.id);
  const data = resolved.omitted.length
    ? Object.fromEntries(Object.entries(model).filter(([key]) => !resolved.omitted.includes(key)))
    : model;
  return { data, meta: versionMeta(resolved) };
}

/**
 * What API callers may know about a version (t-67): its catalogue, built
 * from the model as served (less any withheld section), and the version's
 * meta. The whole model is for platform admins only.
 */
export async function versionCatalogue(
  resolved: ResolvedVersion,
  deps = defaultDeps
): Promise<{ data: JsonObject; meta: VersionMeta }> {
  const { data, meta } = await versionDocument(resolved, deps);
  return { data: resolved.def.catalogue(data), meta };
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
): Promise<{ data: JsonObject[]; meta: KindMeta }> {
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

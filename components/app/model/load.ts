/**
 * What the model pages read (t-63): a published version of the
 * HowDoesThisLand framework, through the same service the public framework
 * API answers from (`lib/app/frameworks/api/service.ts`, t-11), in process.
 *
 * **Cached per version, rendered per request.** The `(public)` layout reads
 * request headers (maintenance mode), so its pages render per request and
 * cannot be statically generated without a second layout (which maintenance
 * mode would not cover) or turning on Cache Components for the whole app
 * (t-63). A published version never changes, so its model is cached by
 * version id with no expiry: `materialise()` keeps
 * it for the life of the process, and the browsable model built from it is
 * kept here beside it. Which version is the latest is looked up on each
 * request, a read of one small table, so a version shows on the pages the
 * moment it is published, with nothing to revalidate. The key includes the
 * withheld sections, so flipping the culture switch is never served stale.
 */
import { cache } from 'react';
import {
  FrameworkApiError,
  getFramework,
  resolveVersion,
  versionDocument,
  type FrameworkDetail,
  type VersionSummary,
} from '@/lib/app/frameworks/api/service';
import { buildBrowseModel, type BrowseModel } from '@/lib/app/frameworks/browse';
import { HOWDOESTHISLAND_SLUG } from '@/lib/app/frameworks/howdoesthisland/slug';

export interface LoadedModel {
  browse: BrowseModel;
  version: VersionSummary;
  /** Every published or retired version, most recently published first. */
  versions: VersionSummary[];
  /** The version new reviews use; null when every version is retired. */
  latestVersion: string | null;
  /** Where this version's pages live: `/model` for the latest, `/model/v/{version}` otherwise. */
  base: string;
  /** Sections a switch withholds right now. */
  omitted: string[];
}

export const MODEL_BASE = '/model';

export function versionBase(version: string): string {
  return `${MODEL_BASE}/v/${encodeURIComponent(version)}`;
}

/** Built models by version id and withheld sections. A handful of versions at most. */
const built = new Map<string, BrowseModel>();

/** The framework and its versions, once per request however many callers ask. */
const framework = cache(async (): Promise<FrameworkDetail | null> => {
  try {
    return await getFramework(HOWDOESTHISLAND_SLUG);
  } catch (err) {
    if (err instanceof FrameworkApiError) return null;
    throw err;
  }
});

/**
 * A published version as browsable pages, or `null` when there is nothing to
 * show: no published version at all, or (for a named one) not that version.
 * Omit `version` for the latest.
 */
export const loadModel = cache(async (version?: string): Promise<LoadedModel | null> => {
  const fw = await framework();
  const wanted = version ?? fw?.latestVersion ?? null;
  if (!fw || !wanted) return null;

  let resolved;
  try {
    resolved = await resolveVersion(HOWDOESTHISLAND_SLUG, wanted);
  } catch (err) {
    if (err instanceof FrameworkApiError) return null;
    throw err;
  }

  const key = `${resolved.version.id}:${resolved.omitted.join(',')}`;
  let browse = built.get(key);
  if (!browse) {
    const { data } = await versionDocument(resolved);
    browse = buildBrowseModel(resolved.def, data, resolved.omitted);
    built.set(key, browse);
  }

  const summary = fw.versions.find((v) => v.version === wanted);
  if (!summary) return null;
  return {
    browse,
    version: summary,
    versions: fw.versions,
    latestVersion: fw.latestVersion,
    base: version === undefined ? MODEL_BASE : versionBase(wanted),
    omitted: resolved.omitted,
  };
});

/** Test seam: forget the built models. */
export function __resetModelCacheForTests(): void {
  built.clear();
}

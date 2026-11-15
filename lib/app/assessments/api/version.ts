/**
 * Which framework version a request is scored with (t-24).
 *
 * `framework` defaults to HowDoesThisLand's, and `version` to its latest
 * published one. Only a published version runs: a retired one stays
 * readable (`GET frameworks/…`) because assessments made with it cite it,
 * but nothing new is scored with it.
 *
 * The framework tables are shared config with no tenant-owned relation
 * (`lib/app/tenancy-classification.ts`), so this works with no org in
 * context, for the anonymous quick scan at `multi` as for anyone.
 */
import { APIError } from '@/lib/api/errors';
import { prismaFrameworkCatalog } from '@/lib/app/frameworks/api/catalog';
import { HOWDOESTHISLAND_SLUG } from '@/lib/app/frameworks/howdoesthisland/slug';
import { engineForVersion, type VersionEngine } from '@/lib/app/assessments/engine';
import type { FrameworkRef } from '@/lib/app/assessments/api/views';

/** The framework a request that names none is scored with. */
export const DEFAULT_FRAMEWORK = HOWDOESTHISLAND_SLUG;

export interface VersionToScore extends VersionEngine {
  framework: FrameworkRef;
}

export async function versionToScore(choice: {
  framework?: string;
  version?: string;
}): Promise<VersionToScore> {
  const slug = choice.framework ?? DEFAULT_FRAMEWORK;
  const framework = await prismaFrameworkCatalog.findFramework(slug);
  if (!framework) {
    throw new APIError(`There is no framework '${slug}'.`, 'FRAMEWORK_NOT_FOUND', 404);
  }
  // Newest first, so the first published is the latest.
  const version = choice.version
    ? framework.versions.find((v) => v.version === choice.version && v.status === 'PUBLISHED')
    : framework.versions.find((v) => v.status === 'PUBLISHED');
  const loaded = version ? await engineForVersion(version.id) : null;
  if (!version || !loaded) {
    throw new APIError(
      choice.version
        ? `${slug} has no published version ${choice.version}.`
        : `${slug} has no published version.`,
      'FRAMEWORK_VERSION_NOT_FOUND',
      404
    );
  }
  return { ...loaded, framework: { slug, version: version.version } };
}

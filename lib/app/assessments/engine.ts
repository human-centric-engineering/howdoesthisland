/**
 * The engine for a stored framework version, by id (t-22).
 *
 * Shared by enqueue (which resolves the profile to judges) and the run (which
 * scores). `materialise()` caches a published version's model, so the second
 * call costs no read of the records.
 */
import type { FrameworkEngine } from '@/lib/app/frameworks/engine';
import { getFrameworkDefinition } from '@/lib/app/frameworks/registry';
import { prismaFrameworkRepo, type StoredVersion } from '@/lib/app/frameworks/repo';
import { materialise } from '@/lib/app/frameworks/store';

export interface VersionEngine {
  version: StoredVersion;
  engine: FrameworkEngine;
  /** `<framework slug>@<version>`, as the cost rows name it. */
  label: string;
}

/** The version and its engine, or `null` when no version has that id or no code runs its framework. */
export async function engineForVersion(versionId: string): Promise<VersionEngine | null> {
  const version = await prismaFrameworkRepo.findVersionById(versionId);
  if (!version) return null;
  const def = getFrameworkDefinition(version.frameworkSlug);
  if (!def) return null;
  const model = await materialise(prismaFrameworkRepo, def, version.id);
  return {
    version,
    engine: def.createEngine(model),
    label: `${version.frameworkSlug}@${version.version}`,
  };
}

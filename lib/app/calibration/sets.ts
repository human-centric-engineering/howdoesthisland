/**
 * The calibration sets, bundled (t-38).
 *
 * The CLI reads `data/eval-<version>.json` off the disk. A route cannot rely
 * on that file being there: a Vercel function holds only what the bundler
 * traced, and a path built at run time is not traced. So the sets a route may
 * run are imported here, one loader per version, each loaded on first use.
 *
 * Every `eval-*.json` in the data directory must be listed: a test reads the
 * directory and fails on one that is not, so a new version's set cannot be
 * runnable from the CLI and missing from the admin page.
 */
import { calibrationSetSchema, type CalibrationSet } from '@/lib/app/calibration/schema';

const LOADERS: Readonly<Record<string, () => Promise<unknown>>> = {
  '0.5.1': async () =>
    (await import('@/lib/app/frameworks/howdoesthisland/data/eval-0.5.1.json')).default,
};

/** The versions a bundled set is written for. */
export const BUNDLED_SET_VERSIONS: readonly string[] = Object.keys(LOADERS);

/**
 * The set written for `version`, checked against the set's schema. Null when
 * no set is written for it. Throws when the bundled file is not a set, which
 * the schema test makes a build-time failure in practice.
 */
export async function loadBundledSet(version: string): Promise<CalibrationSet | null> {
  const load = Object.hasOwn(LOADERS, version) ? LOADERS[version] : undefined;
  if (!load) return null;
  return calibrationSetSchema.parse(await load());
}

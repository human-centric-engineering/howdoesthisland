/**
 * The bundled calibration sets (t-38): every set the CLI can run is one the
 * admin page can, and each loads as a set written for its version.
 */
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUNDLED_SET_VERSIONS, loadBundledSet } from '@/lib/app/calibration/sets';

const DATA = 'lib/app/frameworks/howdoesthisland/data';

describe('the bundled calibration sets', () => {
  it('bundles every eval-*.json in the data directory', () => {
    const onDisk = readdirSync(DATA)
      .map((f) => /^eval-(.+)\.json$/.exec(f)?.[1])
      .filter((v): v is string => v !== undefined)
      .sort();
    expect(onDisk.length).toBeGreaterThan(0);
    expect([...BUNDLED_SET_VERSIONS].sort()).toEqual(onDisk);
  });

  it.each(BUNDLED_SET_VERSIONS)('loads %s as the set written for it', async (version) => {
    const set = await loadBundledSet(version);
    expect(set?.meta.model).toBe(version);
  });

  it('has no set for a version nobody wrote one for, or an inherited key', async () => {
    expect(await loadBundledSet('9.9.9')).toBeNull();
    expect(await loadBundledSet('constructor')).toBeNull();
  });
});

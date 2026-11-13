/**
 * The culture switch (app-plan D11).
 *
 * The HowDoesThisLand model's `culture` section holds Hofstede and Lewis data
 * whose terms are unchecked, so everything built on it sits behind one switch:
 * `CULTURE_MODULE_ENABLED`, on by default outside production and off in
 * production until `l2` sets it. With it off, the section is not served.
 *
 * Read per call, not at module load, so a test can flip it.
 */
import { HOWDOESTHISLAND_SLUG } from '@/lib/app/frameworks/howdoesthisland/slug';
import type { FrameworkDefinition } from '@/lib/app/frameworks/types';
import { env } from '@/lib/env';

/** The model section the switch withholds. */
export const CULTURE_SECTION = 'culture';

export function isCultureEnabled(): boolean {
  return env.CULTURE_MODULE_ENABLED ?? env.NODE_ENV !== 'production';
}

/** The top-level sections of a framework's model not to serve right now. */
export function withheldSections(def: FrameworkDefinition): string[] {
  return def.slug === HOWDOESTHISLAND_SLUG && !isCultureEnabled() ? [CULTURE_SECTION] : [];
}

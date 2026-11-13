/**
 * The frameworks this service can judge against (D2). One today; a second
 * one is a new definition here, with no new tables.
 */
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import type { FrameworkDefinition } from '@/lib/app/frameworks/types';

export const frameworkDefinitions: readonly FrameworkDefinition[] = [howDoesThisLand];

export function getFrameworkDefinition(slug: string): FrameworkDefinition | null {
  return frameworkDefinitions.find((def) => def.slug === slug) ?? null;
}

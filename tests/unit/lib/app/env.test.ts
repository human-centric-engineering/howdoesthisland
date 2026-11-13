/**
 * The app's env schema (t-11): the culture switch (D11) takes `true` or
 * `false`, is optional, and refuses anything else at boot rather than
 * guessing which way a typo meant.
 *
 * FORK NOTE: this is HowDoesThisLand's own test of its own seam, so it reads
 * the real `lib/app/env.ts` on purpose. A key added to the schema needs its
 * parsing tested here, and its name pinned in `defaults.test.ts`'s
 * `lib/app/env.ts` row (ledger row 2).
 */
import { describe, it, expect } from 'vitest';
import { appEnvSchema } from '@/lib/app/env';

describe('CULTURE_MODULE_ENABLED', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('parses %s to %s', (raw, parsed) => {
    expect(appEnvSchema.parse({ CULTURE_MODULE_ENABLED: raw }).CULTURE_MODULE_ENABLED).toBe(parsed);
  });

  it('is undefined when unset, so isCultureEnabled() applies its default', () => {
    expect(appEnvSchema.parse({}).CULTURE_MODULE_ENABLED).toBeUndefined();
  });

  it.each([['yes'], ['1'], ['TRUE'], ['']])('refuses %j', (raw) => {
    expect(appEnvSchema.safeParse({ CULTURE_MODULE_ENABLED: raw }).success).toBe(false);
  });
});

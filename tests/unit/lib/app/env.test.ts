/**
 * The app's env schema (t-11, t-61): the culture switch (D11) and the
 * quick-scan switch each take `true` or `false`, are optional, and refuse
 * anything else at boot rather than guessing which way a typo meant.
 *
 * FORK NOTE: this is HowDoesThisLand's own test of its own seam, so it reads
 * the real `lib/app/env.ts` on purpose. A key added to the schema needs its
 * parsing tested here, and its name pinned in `defaults.test.ts`'s
 * `lib/app/env.ts` row (ledger row 2).
 */
import { describe, it, expect } from 'vitest';
import { appEnvSchema } from '@/lib/app/env';

describe.each(['CULTURE_MODULE_ENABLED', 'QUICK_SCAN_ENABLED'] as const)('%s', (key) => {
  it.each([
    ['true', true],
    ['false', false],
  ])('parses %s to %s', (raw, parsed) => {
    expect(appEnvSchema.parse({ [key]: raw })[key]).toBe(parsed);
  });

  it('is undefined when unset, so its reader (isCultureEnabled, isQuickScanEnabled) applies its default', () => {
    expect(appEnvSchema.parse({})[key]).toBeUndefined();
  });

  it.each([['yes'], ['1'], ['TRUE'], ['']])('refuses %j', (raw) => {
    expect(appEnvSchema.safeParse({ [key]: raw }).success).toBe(false);
  });
});

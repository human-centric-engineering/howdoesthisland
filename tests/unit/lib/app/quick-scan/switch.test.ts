/**
 * Tests: the quick-scan switch's default (t-61, t-68). On everywhere when
 * unset, production included, since the quick scan is offered free;
 * `QUICK_SCAN_ENABLED` overrides it either way.
 * Who may run the quick scan is tested through the route
 * (`tests/unit/app/api/v1/scan/route.test.ts`).
 *
 * FORK NOTE: this is HowDoesThisLand's own test of its own module, so it
 * reads the real `lib/app/quick-scan/switch.ts` on purpose. A fork that changes the
 * switch's default changes the table below to match.
 *
 * @see lib/app/quick-scan/switch.ts
 */
import { describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test',
  QUICK_SCAN_ENABLED: undefined as boolean | undefined,
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

import { isQuickScanEnabled } from '@/lib/app/quick-scan/switch';

describe('isQuickScanEnabled', () => {
  it.each([
    ['production', undefined, true],
    ['development', undefined, true],
    ['test', undefined, true],
    ['production', true, true],
    ['development', false, false],
  ] as const)('NODE_ENV=%s, QUICK_SCAN_ENABLED=%s → %s', (nodeEnv, flag, expected) => {
    mockEnv.NODE_ENV = nodeEnv;
    mockEnv.QUICK_SCAN_ENABLED = flag;
    expect(isQuickScanEnabled()).toBe(expected);
  });
});

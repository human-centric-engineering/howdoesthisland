/**
 * Tests: the quick-scan switch's default (t-61). Off in production and on
 * everywhere else when unset; `QUICK_SCAN_ENABLED` overrides it either way.
 * Who may run the quick scan is tested through the route
 * (`tests/unit/app/api/v1/scan/route.test.ts`).
 *
 * @see lib/app/quick-scan.ts
 */
import { describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test',
  QUICK_SCAN_ENABLED: undefined as boolean | undefined,
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

import { isQuickScanEnabled } from '@/lib/app/quick-scan';

describe('isQuickScanEnabled', () => {
  it.each([
    ['production', undefined, false],
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

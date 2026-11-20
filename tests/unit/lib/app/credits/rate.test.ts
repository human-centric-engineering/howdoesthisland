/**
 * Tests: what a CopyCredit is worth (t-57) — 100 credits to the dollar, a
 * cost rounded up to a whole credit, never down to nothing.
 *
 * @see lib/app/credits/rate.ts
 */
import { describe, expect, it } from 'vitest';
import { CREDITS_PER_USD, creditsForUsd, usdForCredits } from '@/lib/app/credits/rate';

describe('the credit rate', () => {
  it('is 100 credits to the dollar, as ruled at planning', () => {
    expect(CREDITS_PER_USD).toBe(100);
    expect(creditsForUsd(1)).toBe(100);
    expect(usdForCredits(250)).toBe(2.5);
  });

  it('rounds a cost up to a whole credit, so a real cost is never free', () => {
    expect(creditsForUsd(0.001)).toBe(1);
    expect(creditsForUsd(0.0101)).toBe(2);
    expect(creditsForUsd(0.123456)).toBe(13);
  });

  it('does not charge a credit more for float noise on a whole number', () => {
    // 0.07 * 100 is 7.000000000000001 in floating point.
    expect(creditsForUsd(0.07)).toBe(7);
    expect(creditsForUsd(0.29)).toBe(29);
  });

  it('charges nothing for nothing, and for a figure that is not a cost', () => {
    expect(creditsForUsd(0)).toBe(0);
    expect(creditsForUsd(-1)).toBe(0);
    expect(creditsForUsd(Number.NaN)).toBe(0);
    expect(creditsForUsd(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

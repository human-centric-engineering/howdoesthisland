/**
 * The per-person cap on redemption attempts (t-60): the real limiter allows
 * `REDEEM_ATTEMPTS_PER_MINUTE_PER_USER` a minute for one person, refuses the
 * next, and keeps each person's allowance apart. The route test mocks it, so
 * this is where its numbers are held.
 */
import { describe, expect, it } from 'vitest';
import { redeemLimiter } from '@/lib/app/credits/codes/limiter';
import { REDEEM_ATTEMPTS_PER_MINUTE_PER_USER } from '@/lib/app/credits/codes/limits';

describe('redeemLimiter', () => {
  it('allows a person their attempts a minute, then refuses, without touching anyone else’s', () => {
    const alice = `user:limiter-alice-${Date.now()}`;
    const bob = `user:limiter-bob-${Date.now()}`;

    for (let i = 0; i < REDEEM_ATTEMPTS_PER_MINUTE_PER_USER; i++) {
      expect(redeemLimiter.check(alice).success, `attempt ${i + 1}`).toBe(true);
    }
    expect(redeemLimiter.check(alice).success).toBe(false);
    expect(redeemLimiter.check(bob).success).toBe(true);
  });
});

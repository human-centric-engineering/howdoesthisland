/**
 * The review codes' wire helpers (t-59): the admin form's first expiry date.
 */
import { describe, expect, it } from 'vitest';
import { dateFromNow, DEFAULT_EXPIRY_DAYS } from '@/lib/app/credits/codes/wire';

describe('dateFromNow', () => {
  it('is the UTC date that many days after the given moment', () => {
    expect(dateFromNow(90, Date.parse('2026-11-21T23:30:00.000Z'))).toBe('2027-02-19');
  });

  it('counts from now when no moment is given', () => {
    expect(dateFromNow(DEFAULT_EXPIRY_DAYS)).toBe(
      new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 86_400_000).toISOString().slice(0, 10)
    );
  });
});

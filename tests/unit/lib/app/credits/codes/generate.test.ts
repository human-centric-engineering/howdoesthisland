/**
 * A free review code's text (t-59): drawn from the unambiguous alphabet at the
 * stated length, read back from what someone typed, and shown in groups.
 */
import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  formatCode,
  generateCode,
  normaliseCode,
} from '@/lib/app/credits/codes/generate';

describe('generateCode', () => {
  it('draws at least ten characters, none of them a look-alike', () => {
    expect(CODE_LENGTH).toBeGreaterThanOrEqual(10);
    for (const c of '01OIL') expect(CODE_ALPHABET).not.toContain(c);
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      for (const c of code) expect(CODE_ALPHABET).toContain(c);
    }
  });

  it('uses every character of the alphabet, and does not repeat itself', () => {
    const codes = Array.from({ length: 500 }, generateCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(codes.join('')).size).toBe(CODE_ALPHABET.length);
  });
});

describe('normaliseCode', () => {
  it('reads a code typed in lower case, with dashes or spaces', () => {
    expect(normaliseCode('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN');
    expect(normaliseCode(' ABCD EFGH JKMN ')).toBe('ABCDEFGHJKMN');
  });

  it.each([
    ['too short', 'ABCD-EFGH-JKM'],
    ['too long', 'ABCD-EFGH-JKMNP'],
    ['a look-alike the alphabet left out', 'ABCD-EFGH-JKM0'],
    ['punctuation', 'ABCD.EFGH.JKMN'],
  ])('refuses %s', (_name, input) => {
    expect(normaliseCode(input)).toBeNull();
  });
});

describe('formatCode', () => {
  it('groups a code in fours, which normaliseCode reads back', () => {
    expect(formatCode('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN');
    const code = generateCode();
    expect(normaliseCode(formatCode(code))).toBe(code);
  });
});

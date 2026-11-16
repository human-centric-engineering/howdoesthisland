/**
 * Tests: a share link's token (t-32).
 *
 * @see lib/app/reports/share/token.ts
 */
import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  hashShareToken,
  mintShareToken,
  SHARE_TOKEN_PATTERN,
  sharedReportPath,
} from '@/lib/app/reports/share/token';

describe('mintShareToken', () => {
  it('is 32 random bytes, as unpadded base64url', () => {
    const { token } = mintShareToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(token).toMatch(SHARE_TOKEN_PATTERN);
  });

  it('pairs the token with its SHA-256, and the hash is not the token', () => {
    const { token, tokenHash } = mintShareToken();
    expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(tokenHash).not.toContain(token);
    expect(hashShareToken(token)).toBe(tokenHash);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => mintShareToken().token));
    expect(tokens.size).toBe(200);
  });
});

describe('sharedReportPath', () => {
  it('is the public page the token opens', () => {
    expect(sharedReportPath('abc')).toBe('/r/abc');
  });
});

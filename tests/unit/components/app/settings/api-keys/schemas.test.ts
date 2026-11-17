/**
 * @see components/app/settings/api-keys/schemas.ts
 */

import { describe, it, expect } from 'vitest';
import {
  expiresAtFor,
  keyState,
  offeredScopes,
  scopeLabel,
} from '@/components/app/settings/api-keys/schemas';
import { APP_API_KEY_SCOPES } from '@/lib/app/api-key-scopes';

const NOW = new Date('2026-11-17T12:00:00.000Z');

describe('offeredScopes', () => {
  it("keeps the app's scopes the install can mint, in the app's order", () => {
    expect(offeredScopes(['reports', 'chat', 'admin', 'assess'])).toEqual(['assess', 'reports']);
  });

  it("offers none of core's scopes, even when every one is mintable", () => {
    const offered = offeredScopes(['chat', 'analytics', 'knowledge', 'webhook', 'admin']);
    expect(offered).toEqual([]);
  });

  it('every scope it can offer is declared by the app', () => {
    expect(offeredScopes([...APP_API_KEY_SCOPES, 'chat'])).toEqual([...APP_API_KEY_SCOPES]);
  });
});

describe('scopeLabel', () => {
  it("names each of the app's scopes in the product's words", () => {
    for (const scope of APP_API_KEY_SCOPES) expect(scopeLabel(scope)).not.toBe(scope);
  });

  it('falls back to the raw name for a scope it has no words for', () => {
    expect(scopeLabel('chat')).toBe('chat');
  });
});

describe('expiresAtFor', () => {
  it('counts whole days from now', () => {
    expect(expiresAtFor('30', NOW)).toBe('2026-12-17T12:00:00.000Z');
    expect(expiresAtFor('365', NOW)).toBe('2027-11-17T12:00:00.000Z');
  });

  it('sends nothing for no expiry', () => {
    expect(expiresAtFor('never', NOW)).toBeUndefined();
  });
});

describe('keyState', () => {
  it('is revoked whenever revokedAt is set, expired or not', () => {
    expect(
      keyState({ revokedAt: '2026-01-01T00:00:00Z', expiresAt: '2020-01-01T00:00:00Z' }, NOW)
    ).toBe('revoked');
  });

  it('is expired once expiresAt has passed, and active before', () => {
    expect(keyState({ revokedAt: null, expiresAt: '2026-11-17T11:59:59Z' }, NOW)).toBe('expired');
    expect(keyState({ revokedAt: null, expiresAt: '2026-11-17T12:00:01Z' }, NOW)).toBe('active');
    expect(keyState({ revokedAt: null, expiresAt: null }, NOW)).toBe('active');
  });
});

/**
 * @see components/app/settings/api-keys/schemas.ts
 */

import { describe, it, expect, vi } from 'vitest';

// The seam is mocked, so this measures the filter and not whatever the app
// declares today: a fourth scope with no words yet shows how one is offered.
vi.mock('@/lib/app/api-key-scopes', () => ({
  APP_API_KEY_SCOPES: ['assess', 'reports', 'projects', 'capture'],
}));

import {
  expiresAtFor,
  keyState,
  offeredScopes,
  scopeLabel,
} from '@/components/app/settings/api-keys/schemas';

const NOW = new Date('2026-11-17T12:00:00.000Z');

describe('offeredScopes', () => {
  it("keeps the app's scopes the install can mint, in the app's order", () => {
    expect(offeredScopes(['reports', 'chat', 'admin', 'assess'])).toEqual(['assess', 'reports']);
  });

  it("offers none of core's scopes, even when every one is mintable", () => {
    const offered = offeredScopes(['chat', 'analytics', 'knowledge', 'webhook', 'admin']);
    expect(offered).toEqual([]);
  });

  it("offers every scope the app declares, in the app's order, and nothing else", () => {
    expect(offeredScopes(['chat', 'capture', 'projects', 'reports', 'assess', 'admin'])).toEqual([
      'assess',
      'reports',
      'projects',
      'capture',
    ]);
  });
});

describe('scopeLabel', () => {
  it("names the app's scopes in the product's words", () => {
    expect(scopeLabel('assess')).toBe('Run reviews');
    expect(scopeLabel('reports')).toBe('Download and list reports');
    expect(scopeLabel('projects')).toBe('Manage projects');
  });

  it('falls back to the raw name for a scope it has no words for', () => {
    expect(scopeLabel('capture')).toBe('capture');
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

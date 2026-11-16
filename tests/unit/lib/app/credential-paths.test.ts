/**
 * Tests: this fork's credential paths (t-32), read for real.
 *
 * A share link's token is the access to a report, so every logged, reported
 * or analytics copy of its path must lose the token, whatever it looks like.
 * The redaction itself is core's and tested there with a mocked list; this
 * holds our list to it.
 *
 * FORK NOTE — this file tests this fork's own filling of the credential-paths
 * seam, so it reads `@/lib/app/credential-paths` for real on purpose. A change
 * to the list should change these expectations; the shipped-empty row is
 * pinned separately in tests/unit/lib/app/defaults.test.ts (ledger row 2).
 *
 * @see lib/app/credential-paths.ts
 */
import { describe, expect, it } from 'vitest';
import { collapseDynamicSegments, credentialPathProblem } from '@/lib/logging/redact-path';
import { appCredentialPaths } from '@/lib/app/credential-paths';
import { mintShareToken } from '@/lib/app/reports/share/token';

describe('appCredentialPaths', () => {
  it('declares only well-formed patterns', () => {
    for (const pattern of appCredentialPaths) {
      expect(credentialPathProblem(pattern), pattern).toBeNull();
    }
  });

  it.each([
    ['/r/{token}', '/r/[param]'],
    ['/api/v1/shared-reports/{token}', '/api/v1/shared-reports/[param]'],
  ])('collapses a share token in %s', (path, expected) => {
    const { token } = mintShareToken();
    expect(collapseDynamicSegments(path.replace('{token}', token))).toBe(expected);
    // Even one too short or plain to look like a credential by its shape.
    expect(collapseDynamicSegments(path.replace('{token}', 'abc'))).toBe(expected);
  });

  it('leaves the routes that manage links alone: their ids are not access', () => {
    expect(collapseDynamicSegments('/api/v1/shares/share1')).toBe('/api/v1/shares/share1');
  });
});

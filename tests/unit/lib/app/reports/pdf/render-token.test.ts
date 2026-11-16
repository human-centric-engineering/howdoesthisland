/**
 * Tests: the report render token (t-31).
 *
 * Real HMAC throughout, with the real approval and storage schemes beside it,
 * since all three sign with the same secret: the test that matters is that
 * an authentic token of one scheme is refused by the others.
 *
 * @see lib/app/reports/pdf/render-token.ts
 */
import { createHmac } from 'crypto';
import { describe, expect, it, vi } from 'vitest';

const SECRET = vi.hoisted(() => 'test-secret-that-is-at-least-32-characters-long');
vi.mock('@/lib/env', () => ({
  env: { BETTER_AUTH_SECRET: SECRET, BETTER_AUTH_URL: 'https://app.example.com' },
}));

import {
  mintRenderToken,
  RENDER_TOKEN_TTL_SECONDS,
  RenderTokenError,
  verifyRenderToken,
} from '@/lib/app/reports/pdf/render-token';
import { generateApprovalToken, verifyApprovalToken } from '@/lib/orchestration/approval-tokens';
import { generateStorageAccessToken, verifyStorageAccessToken } from '@/lib/storage/access-tokens';

const ID = 'cmassess000000000000000001';
const ORG = 'cmorg000000000000000team1';
const NOW = new Date('2026-11-15T12:00:00.000Z');

/** Sign an arbitrary payload the way all three schemes do. */
function signed(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  const mac = createHmac('sha256', SECRET).update(json, 'utf8').digest('base64url');
  return `${Buffer.from(json, 'utf8').toString('base64url')}.${mac}`;
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof RenderTokenError) return err.reason;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('verifyRenderToken', () => {
  it('accepts its own token for the assessment it names, with the org it was minted in', () => {
    const payload = verifyRenderToken(mintRenderToken(ID, ORG, NOW), ID, NOW);
    expect(payload).toEqual({
      typ: 'report-render',
      assessmentId: ID,
      orgId: ORG,
      expiresAt: new Date(NOW.getTime() + RENDER_TOKEN_TTL_SECONDS * 1000).toISOString(),
    });
  });

  it('refuses a token for another assessment', () => {
    const token = mintRenderToken('cmassess000000000000000002', ORG, NOW);
    expect(reason(() => verifyRenderToken(token, ID, NOW))).toBe('wrong-assessment');
  });

  it('refuses an expired token, from the second it expires', () => {
    const token = mintRenderToken(ID, ORG, NOW);
    const at = (s: number) => new Date(NOW.getTime() + s * 1000);
    expect(verifyRenderToken(token, ID, at(RENDER_TOKEN_TTL_SECONDS - 1)).orgId).toBe(ORG);
    expect(reason(() => verifyRenderToken(token, ID, at(RENDER_TOKEN_TTL_SECONDS)))).toBe(
      'expired'
    );
  });

  it('refuses a token whose payload was changed after signing', () => {
    const [, mac] = mintRenderToken(ID, ORG, NOW).split('.');
    const forged = Buffer.from(
      JSON.stringify({
        typ: 'report-render',
        assessmentId: ID,
        orgId: 'cmorg0000000000000000org2',
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      })
    ).toString('base64url');
    expect(reason(() => verifyRenderToken(`${forged}.${mac}`, ID, NOW))).toBe('bad-signature');
  });

  it('refuses a token signed with another secret', () => {
    const json = JSON.stringify({ typ: 'report-render', assessmentId: ID, orgId: ORG });
    const mac = createHmac('sha256', 'another-secret').update(json).digest('base64url');
    const token = `${Buffer.from(json).toString('base64url')}.${mac}`;
    expect(reason(() => verifyRenderToken(token, ID, NOW))).toBe('bad-signature');
  });

  it('refuses malformed tokens', () => {
    expect(reason(() => verifyRenderToken('', ID, NOW))).toBe('malformed');
    expect(reason(() => verifyRenderToken('no-dot', ID, NOW))).toBe('malformed');
    expect(reason(() => verifyRenderToken('.mac-only', ID, NOW))).toBe('malformed');
    // Authentic, but not JSON.
    const notJson = Buffer.from('not json').toString('base64url');
    const mac = createHmac('sha256', SECRET).update('not json').digest('base64url');
    expect(reason(() => verifyRenderToken(`${notJson}.${mac}`, ID, NOW))).toBe('malformed');
    // Authentic, the right type, a field missing.
    const partial = signed({ typ: 'report-render', assessmentId: ID });
    expect(reason(() => verifyRenderToken(partial, ID, NOW))).toBe('malformed');
    // Authentic, with no scheme tag at all: incomplete, not another scheme's.
    const untagged = signed({ assessmentId: ID, orgId: ORG, expiresAt: NOW.toISOString() });
    expect(reason(() => verifyRenderToken(untagged, ID, NOW))).toBe('malformed');
  });
});

describe('scheme separation (typ)', () => {
  it("refuses an authentic token of another type, even one carrying this scheme's fields", () => {
    const token = signed({
      typ: 'storage-read',
      assessmentId: ID,
      orgId: ORG,
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    });
    expect(reason(() => verifyRenderToken(token, ID, NOW))).toBe('wrong-type');
  });

  it('refuses real approval and storage tokens', () => {
    const approval = generateApprovalToken(ID, 'approve').token;
    const storage = generateStorageAccessToken(`orgs/${ORG}/reports/${ID}/1.pdf`, 60, {
      orgId: ORG,
    }).token;
    expect(reason(() => verifyRenderToken(approval, ID))).toBe('wrong-type');
    expect(reason(() => verifyRenderToken(storage, ID))).toBe('wrong-type');
  });

  it('is refused by the approval and storage schemes', () => {
    const token = mintRenderToken(ID, ORG);
    expect(() => verifyApprovalToken(token)).toThrow('not a workflow-approval token');
    expect(() => verifyStorageAccessToken(token)).toThrow('not a storage-read token');
  });
});

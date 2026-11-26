/**
 * Core's capability registry imports `lib/app/capabilities.ts` on every
 * dispatch path, so the tool classes it registers must not pull the database
 * client or the rate limiters into that module graph (t-92, t-93, t-94). They did when
 * this first landed, and the inbound-trigger route's tests, whose mock of
 * the rate limiter has no `createRateLimiter`, failed to load. The work is
 * loaded on a tool's first call instead (`lib/app/mcp/tool-support.ts`).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => {
  throw new Error('the database client was loaded with the MCP tool classes');
});
vi.mock('@/lib/security/rate-limit', () => {
  throw new Error('the rate limiters were loaded with the MCP tool classes');
});

describe('the MCP tool classes', () => {
  // The classes, not `lib/app/capabilities.ts`: that file also imports core's
  // capabilities index, whose own weight is core's to carry.
  it('load without the database client or the rate limiters', async () => {
    const modules = await Promise.all([
      import('@/lib/app/mcp/quick-scan'),
      import('@/lib/app/mcp/assess-draft'),
      import('@/lib/app/mcp/get-assessment'),
      import('@/lib/app/mcp/compare-drafts'),
      import('@/lib/app/mcp/get-comparison'),
      import('@/lib/app/mcp/rewrite-draft'),
      import('@/lib/app/mcp/get-rewrite'),
    ]);

    expect(modules.map((m) => Object.keys(m).find((k) => k.endsWith('Capability')))).toEqual([
      'QuickScanCapability',
      'AssessDraftCapability',
      'GetAssessmentCapability',
      'CompareDraftsCapability',
      'GetComparisonCapability',
      'RewriteDraftCapability',
      'GetRewriteCapability',
    ]);
  });
});

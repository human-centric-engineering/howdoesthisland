/**
 * How a review records the way it was asked for (t-92): an MCP tool call comes
 * with no `sk_` key, so without saying so it would read as asked in the app.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ prisma: {} }));

import { requestedViaOf } from '@/lib/app/assessments/api/service';

describe('requestedViaOf', () => {
  it('is APP for a browser session', () => {
    expect(requestedViaOf({ userId: 'u', apiKeyId: null })).toBe('APP');
  });

  it('is API for an sk_ key', () => {
    expect(requestedViaOf({ userId: 'u', apiKeyId: 'key-1' })).toBe('API');
  });

  it('is MCP for a tool call, which carries no sk_ key', () => {
    expect(requestedViaOf({ userId: 'u', apiKeyId: null, via: 'MCP' })).toBe('MCP');
  });
});

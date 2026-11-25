/**
 * Tests: rewrites' limits that must agree with something outside them (t-85).
 *
 * The route's `maxDuration` must be a literal Next can read without running
 * the module, so the two are held equal here rather than one being derived
 * from the other. Read as text: importing the route would pull in its guards.
 *
 * @see lib/app/rewrites/limits.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EDITOR_MAX_TOKENS } from '@/lib/app/judges/agents';
import { REWRITE_CALL_MS, REWRITE_LIFETIME_MS } from '@/lib/app/rewrites/limits';

describe('REWRITE_LIFETIME_MS', () => {
  it('is the rewrite route’s maxDuration, so recovery waits out the longest a call can live', () => {
    const route = readFileSync(path.join(process.cwd(), 'app/api/v1/rewrites/route.ts'), 'utf8');
    const match = /export const maxDuration = (\d+);/.exec(route);
    expect(match).not.toBeNull();
    expect(Number(match?.[1]) * 1000).toBe(REWRITE_LIFETIME_MS);
  });
});

describe('REWRITE_CALL_MS', () => {
  it('stops a call before recovery may price it, leaving room for its own cost row', () => {
    expect(REWRITE_LIFETIME_MS - REWRITE_CALL_MS).toBeGreaterThanOrEqual(30_000);
  });

  it('lets the editor’s largest reply finish at 45 tokens a second, after the budget lock’s wait', () => {
    expect(REWRITE_CALL_MS).toBeGreaterThanOrEqual((EDITOR_MAX_TOKENS / 45) * 1000 + 10_000);
  });
});

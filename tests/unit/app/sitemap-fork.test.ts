/**
 * Tests: HowDoesThisLand's public pages in the sitemap (t-62).
 *
 * FORK NOTE: this is the fork's own test of its edit to a Sunrise file
 * (`app/sitemap.ts`, ledger row 25), so it asserts only the path we add.
 *
 * @see app/sitemap.ts
 */
import { describe, expect, it } from 'vitest';
import sitemap from '@/app/sitemap';

describe('sitemap', () => {
  it('lists the developer docs beside the home page', () => {
    const paths = sitemap().map((e) => new URL(e.url).pathname);
    expect(paths).toContain('/');
    expect(paths).toContain('/developers');
  });
});

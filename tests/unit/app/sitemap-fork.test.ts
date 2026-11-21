/**
 * Tests: HowDoesThisLand's public pages in the sitemap (t-62).
 *
 * FORK NOTE: this is the fork's own test of its edit to a Sunrise file
 * (`app/sitemap.ts`, ledger row 25), so it asserts only the path we add and
 * the base the URLs are built on.
 *
 * @see app/sitemap.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import sitemap from '@/app/sitemap';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sitemap', () => {
  it('lists the developer docs beside the home page, on the app’s address', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://howdoesthisland.example');
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain('https://howdoesthisland.example');
    expect(urls).toContain('https://howdoesthisland.example/developers');
  });

  it('falls back to localhost when no address is set', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    expect(sitemap().map((e) => e.url)).toContain('http://localhost:3000/developers');
  });
});

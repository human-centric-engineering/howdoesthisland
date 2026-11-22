/**
 * Tests: HowDoesThisLand's public pages in the sitemap (t-62, t-68).
 *
 * FORK NOTE: this is the fork's own test of its edit to a Sunrise file
 * (`app/sitemap.ts`, ledger row 25), so it asserts only the paths we add and
 * the base the URLs are built on.
 *
 * @see app/sitemap.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted((): { NODE_ENV: string; QUICK_SCAN_ENABLED: boolean | undefined } => ({
  NODE_ENV: 'test',
  QUICK_SCAN_ENABLED: undefined,
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

import sitemap from '@/app/sitemap';

afterEach(() => {
  vi.unstubAllEnvs();
  mockEnv.QUICK_SCAN_ENABLED = undefined;
});

describe('sitemap', () => {
  it('lists the developer docs beside the home page, on the app’s address', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://howdoesthisland.example');
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain('https://howdoesthisland.example');
    expect(urls).toContain('https://howdoesthisland.example/developers');
    expect(urls).toContain('https://howdoesthisland.example/example-review');
  });

  it('falls back to localhost when no address is set', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    expect(sitemap().map((e) => e.url)).toContain('http://localhost:3000/developers');
  });

  it('lists the free quick scan while its switch is on, and not when it is off', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://howdoesthisland.example');
    expect(sitemap().map((e) => e.url)).toContain('https://howdoesthisland.example/quick-scan');
    mockEnv.QUICK_SCAN_ENABLED = false;
    expect(sitemap().map((e) => e.url)).not.toContain('https://howdoesthisland.example/quick-scan');
  });
});

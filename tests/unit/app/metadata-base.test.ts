/**
 * Tests: the root layout's `metadataBase` (t-62).
 *
 * The share cards' `og:image` and `twitter:image` URLs are absolute. Without
 * a `metadataBase`, Next builds them on `http://localhost:<port>` everywhere
 * but Vercel, so on our own servers every card would point at localhost. The
 * base is the app's own URL. Ledger: .context/app/platform-divergences.md row 26.
 *
 * @see app/layout.tsx
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: { NODE_ENV: 'test', NEXT_PUBLIC_APP_URL: 'https://howdoesthisland.example' },
}));

describe('the root layout', () => {
  it('bases the social cards’ URLs on the app’s own URL', async () => {
    const { metadata } = await import('@/app/layout');
    expect(metadata.metadataBase).toEqual(new URL('https://howdoesthisland.example'));
  });
});

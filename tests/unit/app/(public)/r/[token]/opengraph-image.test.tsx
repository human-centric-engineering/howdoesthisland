/**
 * Tests: the card a report's share link unfurls to (t-62). It must be its
 * own, so a shared report does not inherit the landing page's headline, and
 * it must say nothing about the report: the same card for every link.
 *
 * @see app/(public)/r/[token]/opengraph-image.tsx
 */
import { describe, expect, it, vi } from 'vitest';
import Image, { alt, contentType, size } from '@/app/(public)/r/[token]/opengraph-image';
import * as twitterImage from '@/app/(public)/r/[token]/twitter-image';
import { alt as homeAlt } from '@/app/(public)/opengraph-image';

describe('the shared report’s card', () => {
  it('is a 1200×630 PNG of its own, not the landing page’s', () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe('image/png');
    expect(alt).toBe('A HowDoesThisLand report, shared with you');
    expect(alt).not.toBe(homeAlt);
  });

  it('renders a PNG without reading the link’s token', async () => {
    // Called with no params at all: the card cannot depend on the report.
    const res = await Image();
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 20_000);

  it('draws the card once, and serves its bytes after that', async () => {
    // A fresh module, with the drawing counted, so this test sees its own draws.
    vi.resetModules();
    const actual = await vi.importActual<typeof import('@/components/app/brand/share-card')>(
      '@/components/app/brand/share-card'
    );
    const shareCard = vi.fn(actual.shareCard);
    vi.doMock('@/components/app/brand/share-card', () => ({ ...actual, shareCard }));
    try {
      const { default: Fresh } = await import('@/app/(public)/r/[token]/opengraph-image');
      const first = await Fresh();
      const second = await Fresh();

      expect(shareCard).toHaveBeenCalledTimes(1);
      expect(second.headers.get('content-type')).toBe('image/png');
      expect(second.headers.get('cache-control')).toBe('public, max-age=86400');
      expect(new Uint8Array(await second.arrayBuffer())).toEqual(
        new Uint8Array(await first.arrayBuffer())
      );
    } finally {
      vi.doUnmock('@/components/app/brand/share-card');
    }
  }, 20_000);

  it('gives the Twitter card the same image', () => {
    expect(twitterImage.default).toBe(Image);
    expect(twitterImage.alt).toBe(alt);
    expect(twitterImage.size).toBe(size);
    expect(twitterImage.contentType).toBe(contentType);
  });
});

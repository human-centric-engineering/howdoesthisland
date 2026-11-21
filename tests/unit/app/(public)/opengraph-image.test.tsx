/**
 * Tests: the public group's Open Graph image (t-62). Its metadata is what
 * Next puts in the page head, and the image itself is a PNG of that size.
 *
 * @see app/(public)/opengraph-image.tsx
 */
import { describe, expect, it } from 'vitest';
import Image, { alt, contentType, size } from '@/app/(public)/opengraph-image';

describe('opengraph-image', () => {
  it('declares a 1200×630 PNG with the headline as its alt text', () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe('image/png');
    expect(alt).toBe(
      'HowDoesThisLand: Find out why your words aren’t landing, before your reader does.'
    );
  });

  it('renders a PNG', async () => {
    const res = await Image();
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    // The PNG signature.
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }, 20_000);
});

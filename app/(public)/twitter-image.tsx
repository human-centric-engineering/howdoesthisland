/**
 * The Twitter/X card image for `/` (t-62): the same card as
 * `opengraph-image.tsx`. A file-based `opengraph-image` sets only `og:image`,
 * and the page asks for a `summary_large_image` card, so `twitter:image`
 * comes from this route rather than from each consumer's fallback.
 */
import Image, { alt, contentType, size } from '@/app/(public)/opengraph-image';

export { alt, contentType, size };
export default Image;

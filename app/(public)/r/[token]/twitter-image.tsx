/**
 * The Twitter/X card image for a report's share link (t-62): the same card
 * as `opengraph-image.tsx` beside it, so `twitter:image` does not inherit
 * the landing page's.
 */
import Image, { alt, contentType, size } from '@/app/(public)/r/[token]/opengraph-image';

export { alt, contentType, size };
export default Image;

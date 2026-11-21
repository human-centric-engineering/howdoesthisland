import { HOME_COPY } from '@/components/app/marketing/home-copy';
import { SHARE_CARD_SIZE, SHARE_CARD_TYPE, shareCard } from '@/components/app/brand/share-card';

/**
 * The shared-link card for `/` (t-62), and for any public page that sets no
 * image of its own: the landing page's headline. Generated once at build.
 * A shared report sets its own (`r/[token]/opengraph-image.tsx`), so its
 * link does not unfurl as this advert. The layout is `shareCard()`.
 */

export const alt = `HowDoesThisLand: ${HOME_COPY.h1Lead} ${HOME_COPY.h1Turn}`;
export const size = SHARE_CARD_SIZE;
export const contentType = SHARE_CARD_TYPE;

export default function Image() {
  return shareCard({ slug: HOME_COPY.slug, lead: HOME_COPY.h1Lead, turn: HOME_COPY.h1Turn });
}

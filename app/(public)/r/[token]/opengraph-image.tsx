import { SHARE_CARD_SIZE, SHARE_CARD_TYPE, shareCard } from '@/components/app/brand/share-card';

/**
 * The card a report's share link unfurls to (t-62). Without it the link
 * would inherit the landing page's headline, an advert under someone's
 * report. It names nothing about the report: the token is a credential and
 * the card is the same for every link, so it reads no params and touches
 * no data.
 */

export const alt = 'A HowDoesThisLand report, shared with you';
export const size = SHARE_CARD_SIZE;
export const contentType = SHARE_CARD_TYPE;

export default function Image() {
  return shareCard({ slug: 'Shared report', lead: 'A report, shared with you.' });
}

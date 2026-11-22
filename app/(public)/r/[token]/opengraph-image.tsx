import { SHARE_CARD_SIZE, SHARE_CARD_TYPE, shareCard } from '@/components/app/brand/share-card';

/**
 * The card a report's share link unfurls to (t-62). Without it the link
 * would inherit the landing page's headline, an advert under someone's
 * report. It names nothing about the report: the token is a credential and
 * the card is the same for every link, so it reads no params and touches
 * no data.
 *
 * The route sits under a dynamic segment, so it runs per request, on any
 * token. The card is drawn once per process and its bytes served after that,
 * so a flood of made-up links costs no more than any other page.
 */

export const alt = 'A HowDoesThisLand report, shared with you';
export const size = SHARE_CARD_SIZE;
export const contentType = SHARE_CARD_TYPE;

let drawn: Promise<ArrayBuffer> | null = null;

export default async function Image(): Promise<Response> {
  drawn ??= shareCard({ slug: 'Shared report', lead: 'A report, shared with you.' })
    .then((card) => card.arrayBuffer())
    .catch((err: unknown) => {
      drawn = null; // Draw it again next time rather than keep the failure.
      throw err;
    });
  return new Response(await drawn, {
    headers: { 'Content-Type': SHARE_CARD_TYPE, 'Cache-Control': 'public, max-age=86400' },
  });
}

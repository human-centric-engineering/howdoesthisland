import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';

/**
 * The card a link unfurls to in Slack, WhatsApp or X (t-62): paper, a slug,
 * a headline with an optional turn in proof red, and the mark beside the
 * wordmark. One layout for every card the site serves, so each route says
 * only what its card reads.
 *
 * The card is set in Fraunces Bold, with the turn in Spectral Bold Italic
 * (the site's reading face, calmer than Fraunces' italic), right-aligned
 * under the lead. Both are static files in `components/app/brand/fonts/`
 * (OFL, licences beside them): the site's fonts come from `next/font`,
 * which has no file a route can read, and Satori renders neither a
 * variable font nor a weight or style it was not given. Giving `fonts`
 * replaces the default face, so the slug line is in Fraunces Bold too.
 */

export const SHARE_CARD_SIZE = { width: 1200, height: 630 };
export const SHARE_CARD_TYPE = 'image/png';

const PAPER = '#fdfdfb';
const INK = '#141414';
const MUTED = '#6b6a66';
const RED = '#d7263d';
const RULE = '#d6d4cc';

const FONTS = join(process.cwd(), 'components/app/brand/fonts');

export interface ShareCardText {
  slug: string;
  lead: string;
  /** Set in red italic on its own line, right-aligned. */
  turn?: string;
}

export async function shareCard({ slug, lead, turn }: ShareCardText): Promise<ImageResponse> {
  const [mark, bold, italic] = await Promise.all([
    readFile(join(process.cwd(), 'public/brand/mark-512.png')),
    readFile(join(FONTS, 'Fraunces-Bold.ttf')),
    readFile(join(FONTS, 'Spectral-BoldItalic.ttf')),
  ]);
  const markSrc = `data:image/png;base64,${mark.toString('base64')}`;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: PAPER,
        color: INK,
        padding: '64px 72px',
        borderLeft: `14px solid ${RED}`,
      }}
    >
      <div style={{ display: 'flex', fontSize: 22, letterSpacing: 3, color: MUTED }}>
        {slug.toUpperCase()}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'Fraunces',
          fontSize: 76,
          fontWeight: 700,
          lineHeight: 1.02,
          letterSpacing: -2,
        }}
      >
        <span>{lead}</span>
        {turn ? (
          <span
            style={{
              color: RED,
              fontFamily: 'Spectral',
              fontStyle: 'italic',
              alignSelf: 'flex-end',
              marginTop: 18,
            }}
          >
            {turn}
          </span>
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          borderTop: `2px solid ${RULE}`,
          paddingTop: 28,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img> only; next/image has no meaning in an ImageResponse. */}
        <img src={markSrc} width={64} height={64} alt="" />
        <span style={{ fontFamily: 'Fraunces', fontSize: 40, fontWeight: 700 }}>
          HowDoesThisLand
        </span>
      </div>
    </div>,
    {
      ...SHARE_CARD_SIZE,
      fonts: [
        { name: 'Fraunces', data: bold, weight: 700, style: 'normal' },
        { name: 'Spectral', data: italic, weight: 700, style: 'italic' },
      ],
    }
  );
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { HOME_COPY } from '@/components/app/marketing/home-copy';

/**
 * The shared-link card for `/` (t-62), and for any public page that sets no
 * image of its own. Generated once at build: paper, the headline with its
 * turn in proof red, and the mark beside the wordmark.
 *
 * The card is set in Fraunces from static Bold and Bold
 * Italic files in `components/app/brand/fonts/` (OFL, licence beside them).
 * The site's Fraunces comes from `next/font`, which has no file this route
 * can read, and Satori renders neither a variable font nor a weight or
 * style it was not given, so the default face would show them regular and
 * upright. Giving `fonts` replaces the default face, so the slug line is in
 * Fraunces Bold too.
 */

export const alt = `HowDoesThisLand: ${HOME_COPY.h1Lead} ${HOME_COPY.h1Turn}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const PAPER = '#fdfdfb';
const INK = '#141414';
const MUTED = '#6b6a66';
const RED = '#d7263d';
const RULE = '#d6d4cc';

const FONTS = join(process.cwd(), 'components/app/brand/fonts');

export default async function Image() {
  const [mark, bold, boldItalic] = await Promise.all([
    readFile(join(process.cwd(), 'public/brand/mark-512.png')),
    readFile(join(FONTS, 'Fraunces-Bold.ttf')),
    readFile(join(FONTS, 'Fraunces-BoldItalic.ttf')),
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
        {HOME_COPY.slug.toUpperCase()}
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
        <span>{HOME_COPY.h1Lead}</span>
        <span style={{ color: RED, fontStyle: 'italic' }}>{HOME_COPY.h1Turn}</span>
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
        <img src={markSrc} width={64} height={64} alt="" />
        <span style={{ fontFamily: 'Fraunces', fontSize: 40, fontWeight: 700 }}>
          HowDoesThisLand
        </span>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: 'Fraunces', data: bold, weight: 700, style: 'normal' },
        { name: 'Fraunces', data: boldItalic, weight: 700, style: 'italic' },
      ],
    }
  );
}

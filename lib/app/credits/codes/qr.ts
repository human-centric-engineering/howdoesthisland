/**
 * A free review code's QR (t-59): its redeem link as a printable QR, as SVG
 * and as the module grid a PNG is drawn from. Client-safe: the admin page
 * draws and downloads it in the browser, from the link the API answered with.
 *
 * `uqr` (unjs, no dependencies) encodes it. Error correction `M` (15%), so a
 * card that is scuffed or folded still scans, and a four-module quiet zone,
 * the margin scanners expect around a printed code.
 */
import { encode, renderSVG } from 'uqr';

const OPTIONS = { ecc: 'M', border: 4 } as const;

/** The QR as an SVG document, black on white whatever the page's theme. */
export function qrSvg(link: string): string {
  return renderSVG(link, { ...OPTIONS, pixelSize: 8 });
}

/** The QR's modules, `true` for dark, border included. */
export function qrModules(link: string): boolean[][] {
  return encode(link, OPTIONS).data;
}

/** A file name for a code's QR download. */
export function qrFileName(code: string, extension: 'svg' | 'png'): string {
  return `review-code-${code}.${extension}`;
}

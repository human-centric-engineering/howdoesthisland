import { Fraunces, Martian_Mono, Spectral } from 'next/font/google';

/**
 * The Galley Proof type system (D15): Fraunces for display, Spectral for
 * reading text, Martian Mono for the editor's voice (codes, scores, metadata).
 *
 * Each font only declares a CSS variable here. `app/layout.tsx` puts
 * `appFontVariables` on `<html>`, so the variables reach body-portaled overlays
 * as well as pages, and `app/brand-theme.css` decides which surface uses them.
 * On `/admin` they are defined but never read, so the platform's type is
 * unchanged there.
 *
 * Ledger: `.context/app/platform-divergences.md` row 5 (the `<html>` edit).
 */
const display = Fraunces({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--hd-font-display',
});

const read = Spectral({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--hd-font-read',
});

const mono = Martian_Mono({
  subsets: ['latin'],
  variable: '--hd-font-mono',
});

/** Class names that define `--hd-font-display`, `--hd-font-read` and `--hd-font-mono`. */
export const appFontVariables = [display.variable, read.variable, mono.variable].join(' ');

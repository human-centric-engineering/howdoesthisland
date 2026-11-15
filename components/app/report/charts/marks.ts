/** The marks' shared tokens and scale, for every report chart (t-30). */

export const INK = 'var(--hd-ink)';
export const PAPER = 'var(--hd-paper)';

/** The unfilled track: a light step of the bar's own colour, so a row reads as one. */
export const trackOf = (colour: string): string =>
  `color-mix(in srgb, ${colour} 16%, var(--hd-paper))`;

/** A value as a percentage of `max`, held to the track. */
export function percentOf(value: number, max: number): number {
  if (!Number.isFinite(value) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

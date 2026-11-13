/**
 * The HowDoesThisLand mark: the reader's eye, drawn with a broad nib and
 * canted like a raised brow. Its upper lid is the proofreader's insert caret
 * in the editor's red, and its glint looks up at that mark.
 *
 * The same drawing as `app/icon.svg`, without the paper tile, so it sits on
 * the page itself. Drawn inline rather than loaded as an image so it follows
 * the theme: the eye is `currentColor` (ink, or the lightbox's light ink in
 * dark mode) and the caret is `--hd-red`. The glint is cut out of the pupil,
 * so it shows whatever is behind the mark.
 *
 * Decorative: `aria-hidden`, so the brand's accessible name stays the text
 * beside it.
 */
export function EyeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="3 10 58 45"
      className={className}
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="rotate(-8 32 37)">
        <path
          d="M4 38 Q18 25 31 11 Q46 23 60 38 Q46 31.5 31.5 23 Q17 28.5 4 38 Z"
          fill="var(--hd-red, #d7263d)"
        />
        <path d="M4 38 Q38 67 60 38 Q30 53.5 4 38 Z" fill="currentColor" />
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M24 38.5a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0Z M33.2 35.4a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0Z"
        />
      </g>
    </svg>
  );
}

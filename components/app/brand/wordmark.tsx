/**
 * The HowDoesThisLand wordmark: the name set in Fraunces, followed by a proof
 * caret (‸) in the editor's red, the mark an editor makes where something is
 * to be inserted.
 *
 * The caret is drawn by `.hd-wordmark::after` in `app/brand-theme.css`, with
 * empty alternative text, so the element's text and accessible name are the
 * brand name alone.
 */
export function Wordmark({ name }: { name: string }) {
  return <span className="hd-wordmark">{name}</span>;
}

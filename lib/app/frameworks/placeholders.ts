/**
 * The gaps a rewrite leaves for facts only the writer knows (t-83,
 * `.context/app/rewrites.md`).
 *
 * The editor is asked to write each one in one fixed form,
 * {@link placeholderText} (`[ADD: a customer like Sarah's]`), so the app can
 * find them in a draft ({@link parsePlaceholders}) and ask the writer for
 * them. The form is a contract between every framework's rewrite prompt and
 * the rewrites API, which is why it lives beside the engine interface and
 * not in one framework.
 *
 * **What counts.** `[ADD:` (any case), a label on one line with no square
 * brackets in it, and `]`. Anything else in square brackets is the draft's
 * own text: a link's `[text](url)`, a citation `[1]`, or a gap written
 * another way (as rewrites before t-83 were), which stays where it is and is
 * not offered as a field. An empty label, or one longer than
 * {@link MAX_PLACEHOLDER_LABEL}, is passed over too.
 *
 * **One field per fact.** The same label written twice (ignoring case and
 * spacing) is one placeholder sitting in two places, so the writer answers
 * it once. Ids are `p1`, `p2`, … in the order each first appears, so a
 * draft that only grows (a running rewrite's) never renumbers one it has
 * already shown.
 */

/** The most placeholders one draft offers as fields; any after are left in the draft. */
export const MAX_PLACEHOLDERS = 30;

/** The longest a placeholder's label may be and still be offered. */
export const MAX_PLACEHOLDER_LABEL = 200;

/** A gap in a draft: what the writer is asked for, and where it sits. */
export interface Placeholder {
  /** `p1`, `p2`, …: what an answer is keyed to. */
  id: string;
  /** What the editor needs, as it wrote it. */
  label: string;
  /** Each place it sits in the draft, as `[start, end)` offsets into the string, in order. */
  at: Array<{ start: number; end: number }>;
}

/** A placeholder as the editor is asked to write it. */
export const placeholderText = (label: string): string => `[ADD: ${label}]`;

// One line, no nested brackets; the label's own spacing is trimmed.
const PATTERN = /\[ADD:[ \t]*([^[\]\n]*?)[ \t]*\]/gi;

const sameFact = (label: string): string => label.replace(/\s+/g, ' ').toLowerCase();

/** The placeholders in `draft`, each once, in the order each first appears. */
export function parsePlaceholders(draft: string): Placeholder[] {
  const found: Placeholder[] = [];
  const byFact = new Map<string, Placeholder>();
  for (const match of draft.matchAll(PATTERN)) {
    const label = match[1].replace(/\s+/g, ' ');
    if (label === '' || label.length > MAX_PLACEHOLDER_LABEL) continue;
    const at = { start: match.index, end: match.index + match[0].length };
    const key = sameFact(label);
    const known = byFact.get(key);
    if (known) {
      known.at.push(at);
      continue;
    }
    if (found.length === MAX_PLACEHOLDERS) continue;
    const placeholder = { id: `p${found.length + 1}`, label, at: [at] };
    byFact.set(key, placeholder);
    found.push(placeholder);
  }
  return found;
}

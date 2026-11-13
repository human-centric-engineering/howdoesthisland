/**
 * Text utilities (t-13): ported from the top of the prototype's `engine.js`,
 * function for function. Nothing here reads the model.
 *
 * **Regex state.** `rx()` caches each pattern as a `g`-flagged RegExp, which
 * carries `lastIndex` between uses. That is safe only because a cached pattern
 * is used with `String.prototype.match`, which resets `lastIndex` itself.
 * Never call `.test()` or `.exec()` on one: build a fresh RegExp, as the red
 * flag scan does.
 */

/** Positive emotion words. */
export const POS =
  'achieve|achievement|amazing|benefit|best|better|bold|brave|bright|calm|celebrate|clear|confident|courage|delight|easy|energy|enjoy|excellent|excited|exciting|freedom|fun|gift|glad|good|great|grow|growth|happy|hope|hopeful|improve|inspire|joy|kind|laugh|love|lucky|opportunity|optimism|optimistic|peace|pleased|positive|possible|pride|proud|relief|safe|smile|strong|success|succeed|thank|thrive|together|trust|warm|welcome|win|wonder|wonderful';
/** Negative emotion words. */
export const NEG =
  'afraid|anger|angry|anxious|anxiety|awful|bad|broken|burden|catastrophe|crisis|danger|dangerous|dead|destroy|destroyed|devastating|difficult|disaster|doubt|dying|fail|failure|fear|frustrated|frustrating|grief|guilt|hard|harm|hate|hopeless|hurt|lose|losing|loss|mess|nightmare|pain|painful|panic|problem|risk|ruin|sad|scared|shame|stress|stressed|struggle|struggling|suffer|terrible|threat|tired|worried|worry|worse|worst|wrong';
export const STOP: ReadonlySet<string> = new Set(
  'the a an and or but of to in on for with at by from is are was were be been it this that we you i our your my they their he she as'.split(
    ' '
  )
);

const WORD = /[\p{L}\p{N}'’-]+/gu;

/** The words of a text, as the engine counts them. */
export const words = (t: string): string[] => t.match(WORD) ?? [];
export const wordCount = (t: string): number => words(t).length;
/** A 0–4 dimension score. */
export const clamp = (v: number): number => Math.max(0, Math.min(4, Math.round(v)));
export const band3 = (v: number): 'low' | 'mid' | 'high' =>
  v < 45 ? 'low' : v <= 70 ? 'mid' : 'high';

const RX = new Map<string, RegExp>();
/**
 * A model pattern as a RegExp, cached: case-insensitive unless it opens with
 * `(?c)`. `g`-flagged, so use it only with `String.prototype.match` (see the
 * module note).
 */
export function rx(p: string): RegExp {
  let re = RX.get(p);
  if (!re) {
    re = p.startsWith('(?c)') ? new RegExp(p.slice(4), 'gmu') : new RegExp(p, 'gimu');
    RX.set(p, re);
  }
  return re;
}
/** How many times pattern `p` matches in `s`. */
export const countIn = (s: string, p: string): number => (s.match(rx(p)) ?? []).length;

export interface Sentence {
  start: number;
  end: number;
  text: string;
  words: number;
}

export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /(?:[^.!?\n]|\.(?=\d))+(?:[.!?]+["'”’)]*)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t.length < 2) continue;
    out.push({
      start: m.index + lead,
      end: m.index + lead + t.length,
      text: t,
      words: wordCount(t),
    });
  }
  return out;
}

export function syllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

export type Span = [start: number, end: number];

/**
 * `text` lower-cased one code point at a time, with where each of its code
 * units came from in `text`: `from[k]` is the start of the original character
 * that produced `lower[k]`, and `to[k]` is that character's end. One extra
 * entry at `lower.length` maps the end of the string.
 *
 * Lower-casing can change a string's length (`İ`, U+0130, becomes `i` plus a
 * combining dot: one code unit becomes two), so an index into the lower-cased
 * string is not an index into the original. These maps carry it back.
 */
function lowerWithMap(text: string): { lower: string; from: number[]; to: number[] } {
  let lower = '';
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of text) {
    const lc = ch.toLowerCase();
    for (let k = 0; k < lc.length; k++) {
      from.push(i);
      to.push(i + ch.length);
    }
    lower += lc;
    i += ch.length;
  }
  from.push(text.length);
  to.push(text.length);
  return { lower, from, to };
}

/**
 * Where `quote` sits in `text`, as offsets into `text`, or `null`. Tries, in
 * order: the exact quote; the quote ignoring case; the quote with curly
 * quotes straightened and whitespace collapsed; and the first six words of
 * that, when they come to more than 15 characters.
 *
 * **Fixed in the port (BRIEF §5).** The prototype searched `text.toLowerCase()`
 * and returned the index it found there, which is one place off per earlier
 * character whose lower case is longer than itself. This searches the same
 * lower-cased text and maps the match back through {@link lowerWithMap}.
 * Where lower-casing changes no lengths the result is identical.
 */
export function locate(text: string, quote: string | null | undefined): Span | null {
  if (!quote) return null;
  let i = text.indexOf(quote);
  if (i >= 0) return [i, i + quote.length];

  const { lower: lo, from, to } = lowerWithMap(text);
  /** The original span of `lo[a]` through `lo[b - 1]` (empty when `a === b`). */
  const back = (a: number, b: number): Span => [from[a], b > a ? to[b - 1] : from[a]];

  const q = quote.toLowerCase().trim();
  i = lo.indexOf(q);
  if (i >= 0) return back(i, i + q.length);

  const norm = q.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
  const map: number[] = [];
  let flat = '';
  for (let k = 0; k < lo.length; k++) {
    let c = lo[k].replace(/[“”]/, '"').replace(/[‘’]/, "'");
    if (/\s/.test(c)) {
      if (flat.endsWith(' ')) continue;
      c = ' ';
    }
    flat += c;
    map.push(k);
  }
  /** `flat[a]` through `flat[a + len - 1]`, as the prototype clamps it, mapped back. */
  const span = (a: number, len: number): Span => {
    const last = map[Math.min(map.length - 1, a + len - 1)];
    return [from[map[a]], to[last]];
  };
  i = flat.indexOf(norm);
  if (i >= 0) return span(i, norm.length);
  const head = norm.split(' ').slice(0, 6).join(' ');
  if (head.length > 15) {
    i = flat.indexOf(head);
    if (i >= 0) return span(i, head.length);
  }
  return null;
}

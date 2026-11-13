/**
 * Text utilities (t-13), and the `locate()` fix (BRIEF §5).
 *
 * `prototypeLocate` below is the prototype's `locate()`, copied as it is (the
 * prototype is never imported), so each fix test shows the old answer next
 * to the new one on the same input.
 */
import { describe, expect, it } from 'vitest';
import {
  clamp,
  countIn,
  locate,
  rx,
  splitSentences,
  syllables,
  wordCount,
} from '@/lib/app/frameworks/howdoesthisland/engine/text';
import { loadCases } from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

/** prototype/src/engine.js `locate()`, verbatim but for types. */
function prototypeLocate(text: string, quote: string): [number, number] | null {
  if (!quote) return null;
  let i = text.indexOf(quote);
  if (i >= 0) return [i, i + quote.length];
  const lo = text.toLowerCase();
  const q = quote.toLowerCase().trim();
  i = lo.indexOf(q);
  if (i >= 0) return [i, i + q.length];
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
  i = flat.indexOf(norm);
  if (i >= 0) return [map[i], map[Math.min(map.length - 1, i + norm.length - 1)] + 1];
  const head = norm.split(' ').slice(0, 6).join(' ');
  if (head.length > 15) {
    i = flat.indexOf(head);
    if (i >= 0) return [map[i], map[Math.min(map.length - 1, i + head.length - 1)] + 1];
  }
  return null;
}

/** The e1 corpus text with İ ahead of later sentences (BRIEF §5's case). */
const ISTANBUL = (() => {
  const c = loadCases().find((x) => x.file === 'corpus/istanbul-release-1.json');
  if (!c) throw new Error('the baseline no longer has corpus/istanbul-release-1.json');
  return c.input.text;
})();

const slice = (text: string, at: [number, number] | null) => (at ? text.slice(at[0], at[1]) : null);

describe('locate()', () => {
  it('the corpus text has İ, whose lower case is longer than itself', () => {
    expect(ISTANBUL).toContain('İ');
    expect('İ'.toLowerCase()).toHaveLength(2);
    expect(ISTANBUL.toLowerCase().length).toBeGreaterThan(ISTANBUL.length);
  });

  it('finds a quote in another case at its place in the text, after İ (fails on the prototype)', () => {
    const sentence = 'Operations start on 1 April.';
    expect(ISTANBUL).toContain(sentence);
    const quote = sentence.toUpperCase();
    expect(ISTANBUL.indexOf(quote)).toBe(-1); // so the case-insensitive path is the one taken

    const at = locate(ISTANBUL, quote);
    expect(slice(ISTANBUL, at)).toBe(sentence);
    expect(at).toEqual([ISTANBUL.indexOf(sentence), ISTANBUL.indexOf(sentence) + sentence.length]);

    // The prototype's answer is two places late, one per earlier İ.
    const old = prototypeLocate(ISTANBUL, quote);
    expect(old).not.toEqual(at);
    expect(slice(ISTANBUL, old)).not.toBe(sentence);
  });

  it('finds a quote with its whitespace collapsed at its place in the text, after İ (fails on the prototype)', () => {
    const sentence = 'It was built in eleven months.';
    expect(ISTANBUL).toContain(sentence);
    const quote = sentence.replace(' ', '   ');
    const at = locate(ISTANBUL, quote);
    expect(slice(ISTANBUL, at)).toBe(sentence);
    expect(slice(ISTANBUL, prototypeLocate(ISTANBUL, quote))).not.toBe(sentence);
  });

  it('a span that begins on İ covers the whole character', () => {
    const text = 'Visit İzmir in May.';
    expect(slice(text, locate(text, 'İZMIR IN MAY'))).toBe('İzmir in May');
    expect(slice(text, locate(text, 'izmir in may'))).toBeNull();
  });

  it('lower-cases the text as a whole, so a word-final Σ still matches ς', () => {
    const text = 'ΟΔΟΣ ΚΑΛΗ, and more.';
    expect(locate(text, 'οδος καλη')).toEqual([0, 9]);
    expect(locate(text, 'οδος καλη')).toEqual(prototypeLocate(text, 'οδος καλη'));
    // …and still maps back after an İ.
    const mixed = 'İ ΟΔΟΣ ΚΑΛΗ';
    expect(slice(mixed, locate(mixed, 'οδος καλη'))).toBe('ΟΔΟΣ ΚΑΛΗ');
  });

  it('finds an exact quote where it is', () => {
    expect(locate('Say it plainly. Then stop.', 'Then stop.')).toEqual([16, 26]);
  });

  it('ignores case, and the quote’s own leading and trailing space', () => {
    expect(locate('Say it plainly. Then stop.', '  THEN STOP. ')).toEqual([16, 26]);
  });

  it('straightens curly quotes and collapses whitespace', () => {
    const text = 'She said "go\n\n now" and left.';
    expect(slice(text, locate(text, 'said “go now”'))).toBe('said "go\n\n now"');
  });

  it('falls back to the first six words when they come to more than 15 characters', () => {
    const text = 'We cut the release time from monthly to daily last year.';
    const quote = 'We cut the release time from weekly to hourly.';
    expect(slice(text, locate(text, quote))).toBe('We cut the release time from');
  });

  it('does not fall back to six words of 15 characters or fewer', () => {
    expect(locate('a b c d e f g', 'a b c d e f x')).toBeNull();
  });

  it('returns null for a quote that is not there, and for no quote', () => {
    expect(locate('Hello there.', 'Goodbye.')).toBeNull();
    expect(locate('Hello there.', '')).toBeNull();
    expect(locate('Hello there.', null)).toBeNull();
    expect(locate('Hello there.', undefined)).toBeNull();
  });

  it('answers as the prototype did wherever lower-casing keeps the length', () => {
    const text = 'Our Plan, in short:\n\nWe will  “ship”   it by Friday. Then we rest.';
    for (const quote of [
      'Then we rest.',
      'our plan',
      'we will "ship" it',
      'WE WILL “SHIP” IT BY MONDAY AND TUESDAY',
      '   ',
      'nope',
    ]) {
      expect(locate(text, quote), quote).toEqual(prototypeLocate(text, quote));
    }
  });
});

describe('the other text utilities', () => {
  it('splits sentences with their offsets, keeping decimals and closing quotes', () => {
    const text = '  It rose 2.5 points. "Good!" she said?\nNew line';
    const s = splitSentences(text);
    expect(s.map((x) => x.text)).toEqual([
      'It rose 2.5 points.',
      '"Good!"',
      'she said?',
      'New line',
    ]);
    for (const x of s) expect(text.slice(x.start, x.end)).toBe(x.text);
    expect(s[0].words).toBe(5); // `2.5` is two words to the counter
  });

  it('counts words across scripts, with apostrophes and hyphens', () => {
    expect(wordCount("It’s a well-known İzmir café, isn't it?")).toBe(7);
    expect(wordCount('')).toBe(0);
  });

  it('counts syllables the way the readability metrics do', () => {
    expect(syllables('a')).toBe(1);
    expect(syllables('123')).toBe(0);
    expect(syllables('persuasion')).toBe(3);
    expect(syllables('liked')).toBe(1);
  });

  it('clamps a score to a whole number from 0 to 4', () => {
    expect([clamp(-1), clamp(2.5), clamp(9), clamp(Number.NaN)]).toEqual([0, 3, 4, Number.NaN]);
  });

  it('counts a pattern repeatedly with the same cached g-flagged RegExp', () => {
    expect(rx('\\bgo\\b')).toBe(rx('\\bgo\\b'));
    expect(countIn('Go, go, GO.', '\\bgo\\b')).toBe(3);
    expect(countIn('Go, go, GO.', '\\bgo\\b')).toBe(3); // no lastIndex carried over
    expect(countIn('Go, go, GO.', '(?c)\\bgo\\b')).toBe(1); // (?c): case-sensitive
  });
});

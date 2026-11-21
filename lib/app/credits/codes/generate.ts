/**
 * Free review codes' text (t-59): how one is made, written and read back.
 * Client-safe: no server imports, so the redeem page (t-60) normalises what
 * someone typed with the same rules.
 *
 * **Short enough to type, long enough not to guess.** Twelve characters from
 * a 31-character alphabet with no look-alikes (no `0`/`O`, `1`/`I`/`L`), so
 * about 59 bits: guessing one live code among thousands, at the redeem
 * route's rate limit, is not a strategy. Shown in groups of four
 * (`ABCD-EFGH-JKMN`); stored and compared canonical, in upper case with no
 * separators, so a code typed in lower case or with spaces still matches.
 */

/** The characters a code is made of: digits and capitals, without look-alikes. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Characters in a code, separators aside. */
export const CODE_LENGTH = 12;

const GROUP = 4;

/**
 * A new code, canonical. Uniform over the alphabet: random bytes above the
 * largest multiple of its length are drawn again rather than folded, which
 * would favour the first few characters.
 */
export function generateCode(): string {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2));
    for (const byte of bytes) {
      if (byte < limit) out += CODE_ALPHABET[byte % n];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

/**
 * What someone typed, made canonical: upper case, spaces and dashes dropped.
 * `null` when what is left is not a code's shape, so a caller can refuse it
 * without a lookup.
 */
export function normaliseCode(input: string): string | null {
  const canonical = input.toUpperCase().replace(/[\s-]+/g, '');
  if (canonical.length !== CODE_LENGTH) return null;
  for (const c of canonical) if (!CODE_ALPHABET.includes(c)) return null;
  return canonical;
}

/** A canonical code as people read it: `ABCD-EFGH-JKMN`. */
export function formatCode(code: string): string {
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += GROUP) groups.push(code.slice(i, i + GROUP));
  return groups.join('-');
}

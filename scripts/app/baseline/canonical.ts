/**
 * Canonical JSON for the engine baseline's fixtures (t-12).
 *
 * Object keys are sorted at every depth, so a fixture's bytes depend on what
 * the engine returned and not on the order it happened to build an object in.
 * A port that builds the same result in a different order therefore diffs
 * clean, and a diff that does show points at a value.
 *
 * Everything else is `JSON.stringify`'s, and e2 compares against it on the
 * same terms: an `undefined` property is absent, an `undefined` array slot and
 * a non-finite number are `null`, and `-0` is `0`. Two-space indent, trailing
 * newline.
 *
 * Two things JSON cannot carry in sorted order are refused rather than written
 * wrong. An integer-like key (`"10"`, `"9"`) is always enumerated first, in
 * numeric order, whatever order it was inserted in. A non-plain object (a
 * `Date`, a `Map`, a class instance) would not survive the rebuild as itself.
 * The engine produces neither today; if it starts to, the recorder fails and
 * says which key or value, instead of writing bytes a port in another
 * language cannot reproduce.
 */

const INTEGER_LIKE = /^(?:0|[1-9]\d*)$/;

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A deep copy of `value` with every object's keys in sorted order. */
export function sortKeys(value: unknown, at = '$'): unknown {
  if (Array.isArray(value)) return value.map((v, i) => sortKeys(v, `${at}[${i}]`));
  if (value !== null && typeof value === 'object') {
    if (!isPlainObject(value)) {
      throw new Error(`${at} is not a plain object, so it has no canonical JSON form`);
    }
    // A null prototype, so an own "__proto__" key stays a key.
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [key, v] of entries) {
      if (INTEGER_LIKE.test(key)) {
        throw new Error(`${at} has the integer-like key "${key}", which JSON cannot keep sorted`);
      }
      out[key] = sortKeys(v, `${at}.${key}`);
    }
    return out;
  }
  return value;
}

/** The fixture text for `value`. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

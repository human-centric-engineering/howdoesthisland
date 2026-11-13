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
 */

/** A deep copy of `value` with every object's keys in sorted order. */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [key, v] of entries) out[key] = sortKeys(v);
    return out;
  }
  return value;
}

/** The fixture text for `value`. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

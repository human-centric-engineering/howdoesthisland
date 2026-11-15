/**
 * Whole-number percentage shares of a set of values that add up to exactly
 * 100 (largest remainder), so a mix printed beside its target never reads
 * 99% or 101%. All zeros, or no values, share nothing: every share is 0.
 */
export function sharesOf(values: readonly number[]): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((t, v) => t + v, 0);
  if (total === 0) return clean.map(() => 0);
  const exact = clean.map((v) => (v / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((t, v) => t + v, 0);
  const byRemainder = exact
    .map((v, i) => ({ i, r: v - floors[i] }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

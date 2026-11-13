/**
 * The port against the prototype's baseline (t-13).
 *
 * Every case in `tests/fixtures/app/engine-baseline/` is run through the port
 * the way the recorder ran it through the prototype (t-12): `quickScan`, then
 * `assemble` with no judge outputs, then `assemble` with the synthetic ones
 * and a source. The three outputs must match the recorded ones on canonical
 * JSON terms, except where `baseline-differences.ts` lists a difference and
 * the fix it traces to. A listing that no longer differs fails too, so the
 * list cannot outlive its reason.
 */
import { describe, expect, it } from 'vitest';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import { LISTED_DIFFERENCES } from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-differences';
import {
  asRecorded,
  diffPaths,
  loadCases,
  loadModel,
  type BaselineCase,
} from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';
import { z } from 'zod';

const model = loadModel();
const cases = loadCases();
// The baseline was recorded with culture on: the prototype has no switch.
const engine = createHowDoesThisLandEngine(model, { culture: true });

/** The port's outputs for a case, in the fixture's shape. */
function run(c: BaselineCase) {
  const { text, ctx } = c.input;
  const q = engine.quickScan(text, ctx);
  return {
    quickScan: q,
    assemble: {
      quick: engine.assemble(text, ctx, structuredClone(q)),
      full: engine.assemble(
        text,
        ctx,
        structuredClone(q),
        structuredClone(c.judgeOutputs),
        `baseline:${c.id}`
      ),
    },
  };
}

const recorded = (c: BaselineCase) => ({ quickScan: c.quickScan, assemble: c.assemble });

describe('the engine port against the prototype baseline', () => {
  it('reads the whole baseline: 18 eval cases and 48 corpus pairs', () => {
    expect(cases.filter((c) => c.source === 'eval')).toHaveLength(18);
    expect(cases.filter((c) => c.source === 'corpus')).toHaveLength(48);
  });

  it('lists only cases the baseline has', () => {
    const files = new Set(cases.map((c) => c.file));
    for (const d of LISTED_DIFFERENCES) for (const f of d.cases) expect(files.has(f), f).toBe(true);
  });

  it.each(cases.map((c) => [c.file, c] as const))(
    '%s matches, apart from its listed differences',
    (_file, c) => {
      const paths = diffPaths(asRecorded(run(c)), recorded(c));
      const listed = LISTED_DIFFERENCES.filter((d) => d.cases.includes(c.file));
      const unlisted = paths.filter((p) => !listed.some((d) => d.paths.some((re) => re.test(p))));
      expect(unlisted).toEqual([]);
      for (const d of listed) {
        expect(
          paths.some((p) => d.paths.some((re) => re.test(p))),
          `${c.file} is listed under ${d.fix} but no longer differs that way`
        ).toBe(true);
      }
    }
  );
});

describe('each listed difference is the fix it names', () => {
  const byFix = (fix: string) => {
    const d = LISTED_DIFFERENCES.find((x) => x.fix === fix);
    if (!d) throw new Error(`no listing for ${fix}`);
    return cases.filter((c) => d.cases.includes(c.file));
  };

  /** Lower-cased with whitespace collapsed: how locate() compares a quote with the text. */
  const loose = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
  /**
   * Whether a span of `text` is `quote` (or, on locate's last path, its
   * opening words) and nothing more: the span is not trimmed, so one that
   * runs on into the next paragraph does not hold.
   */
  const holds = (text: string, start: number, end: number, quote: string) => {
    const got = loose(text.slice(start, end));
    const want = loose(quote).trim();
    return got.length > 0 && (got === want || want.startsWith(got));
  };

  it('locate-offsets: every moved highlight now spans its quote, and did not before', () => {
    const highlight = z.object({ start: z.number(), end: z.number(), quote: z.string() });
    const highlights = z.object({ highlights: z.array(highlight) });
    let moved = 0;
    for (const c of byFix('locate-offsets')) {
      const ported = highlights.parse(asRecorded(run(c).assemble.full)).highlights;
      const before = highlights.parse(c.assemble.full).highlights;
      expect(ported).toHaveLength(before.length);
      ported.forEach((h, i) => {
        const was = before[i];
        expect(h.quote).toBe(was.quote);
        if (h.start === was.start && h.end === was.end) return;
        moved++;
        expect(holds(c.input.text, h.start, h.end, h.quote), `${c.file} highlight ${i}`).toBe(true);
        expect(holds(c.input.text, was.start, was.end, was.quote), `${c.file} highlight ${i}`).toBe(
          false
        );
      });
    }
    // The population is not empty: the fixtures put an İ ahead of found quotes.
    expect(moved).toBeGreaterThan(0);
  });

  it('red-flag-penalty-key: listed exactly where the quick scan finds a red flag, and no real score moves', () => {
    const flagged = z.object({
      flags: z.array(z.unknown()),
      scores: z.record(z.string(), z.unknown()),
    });
    const listed = new Set(byFix('red-flag-penalty-key').map((c) => c.file));
    for (const c of cases) {
      const recordedScan = flagged.parse(c.quickScan);
      expect(listed.has(c.file), c.file).toBe(recordedScan.flags.length > 0);
      if (!listed.has(c.file)) continue;
      // The prototype's only trace of the penalty is the stray key, recorded as null (NaN).
      expect(recordedScan.scores.undefined).toBeNull();
      const { undefined: _stray, ...realScores } = recordedScan.scores;
      expect(engine.quickScan(c.input.text, c.input.ctx).scores).toEqual(realScores);
    }
    expect(listed.size).toBeGreaterThan(0);
  });
});

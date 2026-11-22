/**
 * What a signed-out caller gets from the quick scan (t-68): the scores and a
 * caveat, and nothing else.
 *
 * The quick scan is free and open to anyone (owner ruling, 2026-11-22), and
 * it is the easiest way to probe the model's detection patterns: send text,
 * see what matched. So a caller with no account sees the overall score, its
 * band and each appeal's score, never the matched lines, notes or anything
 * else in the engine's result. A session or an API key gets the full result,
 * as before.
 *
 * The caveat says plainly what the quick scan is not, beside every score it
 * gives, on the API and on the page alike.
 */
import { z } from 'zod';
import type { QuickScanView } from '@/lib/app/assessments/api/views';

/** What the quick scan is, and what it is not, in the words the page shows. */
export const QUICK_SCAN_CAVEAT =
  'This is the quick scan: a surface check of word patterns, done in a moment without AI. It notices things like hype words, vague claims, missing numbers and long sentences. It cannot tell whether your argument holds up, whether your evidence convinces, or how your reader will take it. A full review, by a panel of AI reviewers, does that.';

/**
 * What a signed-out caller gets, on the wire. Here rather than in the route
 * registry, which re-exports it, so the public page can check the answer in
 * the browser without importing the registry.
 */
export const quickScanSummarySchema = z.object({
  framework: z.object({ slug: z.string(), version: z.string() }),
  wordCount: z.number().int(),
  overall: z.number().nullable(),
  band: z.string().nullable(),
  /** Each appeal's score, in the version's order; empty when the result has none. */
  appeals: z.array(z.object({ id: z.string(), score: z.number() })),
  caveat: z.string(),
});

export type QuickScanSummary = z.infer<typeof quickScanSummarySchema>;

/**
 * The appeals are the keys of the result's `effective_weights`, in order, so
 * this names no appeal itself and follows whatever the version has.
 */
const appealScores = z.object({
  effective_weights: z.record(z.string(), z.number()),
  scores: z.record(z.string(), z.unknown()),
});

export function summariseQuickScan(view: QuickScanView): QuickScanSummary {
  const parsed = appealScores.safeParse(view.result);
  const appeals = parsed.success
    ? Object.keys(parsed.data.effective_weights).flatMap((id) => {
        const score = parsed.data.scores[id];
        return typeof score === 'number' ? [{ id, score }] : [];
      })
    : [];
  return {
    framework: view.framework,
    wordCount: view.wordCount,
    overall: view.overall,
    band: view.band,
    appeals,
    caveat: QUICK_SCAN_CAVEAT,
  };
}

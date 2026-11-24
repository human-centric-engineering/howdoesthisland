/**
 * The two numbers every framework's result carries for listing (§9
 * `overall`, `band`). A leaf module, so the read side (`api/views.ts`,
 * `early-scan.ts`) reaches it without importing the run.
 */
import { z } from 'zod';

const resultScores = z.object({ scores: z.object({ overall: z.number(), band: z.string() }) });

/** A result's `overall` and `band`, or nulls when it carries none. */
export function scoresOf(result: unknown): { overall: number | null; band: string | null } {
  const parsed = resultScores.safeParse(result);
  return parsed.success
    ? { overall: parsed.data.scores.overall, band: parsed.data.scores.band }
    : { overall: null, band: null };
}

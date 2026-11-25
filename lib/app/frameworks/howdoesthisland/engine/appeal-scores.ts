/**
 * A stored result's score on each appeal (t-87): what a comparison of drafts
 * reads to say which draft leads on each (`lib/app/comparisons/`).
 *
 * Read from `scores`, where `assemble()` puts each appeal's score beside the
 * overall one. The result is read back from the database as JSON, so it is
 * parsed: a result without every appeal's score is not one this engine
 * assembled.
 */
import { z } from 'zod';
import type { AppealScore } from '@/lib/app/frameworks/engine';
import { APPEALS } from '@/lib/app/frameworks/howdoesthisland/engine/model';

const scoresSchema = z.object({
  scores: z.object(Object.fromEntries(APPEALS.map((a) => [a, z.number()]))),
});

/** Each appeal's score, in the model's order, or `null` when `result` has not got them all. */
export function appealScores(result: unknown): readonly AppealScore[] | null {
  const parsed = scoresSchema.safeParse(result);
  if (!parsed.success) return null;
  const { scores } = parsed.data;
  return APPEALS.map((appeal) => ({ appeal, score: scores[appeal] }));
}

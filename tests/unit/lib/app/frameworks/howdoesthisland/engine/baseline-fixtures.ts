/**
 * Reading the engine baseline (t-12) for the port's tests (t-13).
 *
 * The fixtures are JSON on disk, so each is parsed rather than cast: the
 * input context and the synthetic judge outputs go to the engine, typed; the
 * recorded outputs stay `unknown` and are only compared.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type {
  EngineContext,
  JudgeOutputs,
} from '@/lib/app/frameworks/howdoesthisland/engine/types';
import { sortKeys } from '@/scripts/app/baseline/canonical';
import { decodePrompt } from '@/scripts/app/baseline/prompts';

export const BASELINE_DIR = 'tests/fixtures/app/engine-baseline';
export const MODEL_FILE = 'lib/app/frameworks/howdoesthisland/data/model-0.5.1.json';

export const ctxSchema = z.object({
  contentType: z.string(),
  archetype: z.string(),
  role: z.string().optional(),
  audience: z.record(z.string(), z.string()),
  culture: z.object({ reader: z.string().optional(), writer: z.string().optional() }).optional(),
}) satisfies z.ZodType<EngineContext>;

const loose = z.union([z.number(), z.string()]).nullable().optional();

const recommendationSchema = z.object({
  dimension: z.string(),
  move: z.string().nullable().optional(),
  issue: z.string(),
  original: z.string().optional(),
  rewrite: z.string(),
  impact: z.string().optional(),
});

/** As loose as `assemble()` reads a reply: the fixtures hold odd values on purpose. */
const judgeOutputSchema = z.object({
  appeal: z.string().optional(),
  summary: z.string().optional(),
  dimension_scores: z
    .array(z.object({ id: z.string(), score: loose, rationale: z.string().optional() }))
    .optional(),
  highlights: z
    .array(
      z.object({
        quote: z.string(),
        dimension: z.string(),
        polarity: z.string().optional(),
        note: z.string().optional(),
      })
    )
    .optional(),
  recommendations: z.array(recommendationSchema).optional(),
  red_flags: z
    .array(z.object({ id: z.string(), quote: z.string(), note: z.string().optional() }))
    .optional(),
  duties: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  text_positions: z.record(z.string(), z.unknown()).optional(),
  perspectives: z
    .array(
      z.object({
        id: z.string(),
        score: loose,
        summary: z.string().optional(),
        levers: z
          .array(
            z.object({
              id: z.string(),
              status: z.string().optional(),
              quote: z.string().optional(),
              note: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
});

export const judgeOutputsSchema = z.record(
  z.string(),
  judgeOutputSchema
) satisfies z.ZodType<JudgeOutputs>;

const caseSchema = z.object({
  id: z.string(),
  source: z.enum(['eval', 'corpus']),
  input: z.object({ text: z.string(), ctx: ctxSchema }),
  quickScan: z.unknown(),
  judgeOutputs: judgeOutputsSchema,
  assemble: z.object({ quick: z.unknown(), full: z.unknown() }),
});
export type BaselineCase = z.infer<typeof caseSchema> & { file: string };

const manifestSchema = z.object({ cases: z.array(z.string()).min(1) });

/** The 0.5.1 model file, as the plain JSON the baseline was recorded from. */
export function loadModel(): Record<string, unknown> {
  return z.looseObject({}).parse(JSON.parse(readFileSync(MODEL_FILE, 'utf8')));
}

/** Every case the manifest lists, in its order. `file` is `eval/ev01.json` and so on. */
export function loadCases(): BaselineCase[] {
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(path.join(BASELINE_DIR, 'manifest.json'), 'utf8'))
  );
  return manifest.cases.map((file) => ({
    file,
    ...caseSchema.parse(JSON.parse(readFileSync(path.join(BASELINE_DIR, file), 'utf8'))),
  }));
}

const promptTableSchema = z.object({
  lines: z.array(z.string()),
  prompts: z.record(z.string(), z.record(z.string(), z.string())),
});

/**
 * The prototype's judge prompts (t-18): case file → slot → prompt. Every case
 * in the manifest has one per slot of the model's `judges`.
 */
export function loadPrompts(): Map<string, Map<string, string>> {
  const table = promptTableSchema.parse(
    JSON.parse(readFileSync(path.join(BASELINE_DIR, 'prompts.json'), 'utf8'))
  );
  return new Map(
    Object.entries(table.prompts).map(([file, slots]) => [
      file,
      new Map(Object.entries(slots).map(([slot, ix]) => [slot, decodePrompt(table, ix)])),
    ])
  );
}

/** A value as the fixtures hold it: the canonical JSON rebuild (t-12's terms). */
export const asRecorded = (value: unknown): unknown => JSON.parse(JSON.stringify(sortKeys(value)));

/**
 * The paths at which two recorded values differ, `$.a.b[3].c` style. A key
 * on one side only is a difference at that key.
 */
export function diffPaths(a: unknown, b: unknown, at = '$', out: string[] = []): string[] {
  if (Object.is(a, b)) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++)
      diffPaths(a[i], b[i], `${at}[${i}]`, out);
    return out;
  }
  if (isRecord(a) && isRecord(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diffPaths(a[k], b[k], `${at}.${k}`, out);
    }
    return out;
  }
  out.push(at);
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

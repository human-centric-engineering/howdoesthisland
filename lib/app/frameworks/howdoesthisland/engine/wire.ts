/**
 * HowDoesThisLand's assessment `context` and `result` as the API serves them
 * (t-44), for the OpenAPI document.
 *
 * The route registry types both as `unknown`, because each framework brings
 * its own, and the API never parses them on the way out. These schemas are
 * what the document says they hold for this framework. A type test
 * (`tests/unit/lib/app/frameworks/howdoesthisland/engine/wire.test.ts`) holds
 * each one against the engine's own type (`types.ts`, `editor.ts`), so a field
 * the engine adds fails it until it is documented here.
 *
 * They describe, they do not validate: nothing parses an answer with them.
 * The report reads `result` with its own looser schema
 * (`lib/app/reports/input.ts`), which an older stored result still passes.
 *
 * Field names are the engine's, snake_case included.
 */
import { z } from 'zod';

const source = z.enum(['quick', 'ai']);
const numberMap = z.record(z.string(), z.number());

const appealWeights = z.object({
  ethos: z.number(),
  pathos: z.number(),
  logos: z.number(),
  kairos: z.number(),
});

const lewis = z.object({ linear: z.number(), multi: z.number(), reactive: z.number() });

// ─── The context ────────────────────────────────────────────────────────────

/**
 * `EngineContext`: who the text is for, as the run used it, defaults applied.
 * Every id is one of the framework version's own.
 */
export const engineContextSchema = z
  .object({
    contentType: z.string().meta({ description: "A content type id from the version's model." }),
    archetype: z
      .string()
      .meta({ description: "An audience archetype id from the version's model." }),
    role: z.string().optional().meta({ description: 'An exec role id; absent for none.' }),
    audience: z.record(z.string(), z.string()).meta({
      description: 'Audience modifier id → the option id chosen for it, one for every modifier.',
    }),
    culture: z
      .object({ reader: z.string().optional(), writer: z.string().optional() })
      .optional()
      .meta({
        description:
          'Reader and writer country ids (`global` for none in particular). Absent with the culture module off.',
      }),
  })
  .meta({
    title: 'HowDoesThisLandContext',
    description: 'Who the text is for, as the assessment used it, with defaults applied.',
  });

// ─── The result ─────────────────────────────────────────────────────────────

const highlightSchema = z.object({
  start: z.number().int().meta({ description: 'Character offset into the assessed text.' }),
  end: z.number().int(),
  quote: z.string(),
  dimension: z.string(),
  appeal: z.string().nullable(),
  polarity: z.enum(['strength', 'weakness']),
  note: z.string(),
  source,
  flag: z.string().optional().meta({ description: 'The red flag that raised it, if one did.' }),
});

const redFlagSchema = z.object({
  id: z.string(),
  quote: z.string(),
  start: z.number().int().optional().meta({ description: 'Absent when the quote was not found.' }),
  end: z.number().int().optional(),
  severity: z.string(),
  note: z.string().optional(),
  source,
});

const leverStateSchema = z.object({
  status: z.enum(['present', 'absent', 'misused', 'not_applicable', 'unknown']),
  quote: z.string().optional(),
  note: z.string().optional(),
});

const recommendationSchema = z.object({
  appeal: z.string(),
  dimension: z.string(),
  move: z.string().nullable(),
  issue: z.string(),
  original: z.string(),
  rewrite: z.string(),
  impact: z.string(),
  source: z.enum(['library', 'ai']),
  example: z
    .boolean()
    .optional()
    .meta({ description: "Library only: `original` is the model's example, not the text's." }),
});

const craftSchema = z.object({
  words: z.number(),
  sentences: z.number(),
  speaking_sec: z.number(),
  gunning_fog: z.number(),
  fk_grade: z.number(),
  passive_pct: z.number(),
  emotional_pct: z.number(),
  positivity: z.number(),
  avg_sentence: z.number(),
  you: z.number(),
  we: z.number(),
  i: z.number(),
  devices: z.object({
    tricolon: z.number(),
    antithesis: z.number(),
    anaphora: z.number(),
    questions: z.number(),
    alliteration: z.number(),
  }),
});

const cultureReportSchema = z.object({
  reader: z.object({
    id: z.string(),
    name: z.string(),
    global: z.boolean(),
    lewis,
    lewis_label: z.string(),
    hofstede: z.record(z.string(), z.number().nullable()).nullable(),
    targets: numberMap,
    tolerance: z.number(),
  }),
  writer: z.object({ id: z.string(), name: z.string(), lewis, targets: numberMap }).nullable(),
  positions: numberMap,
  gaps: z.array(
    z.object({ scale: z.string(), writer: z.number(), reader: z.number(), diff: z.number() })
  ),
  source,
});

/** `Assessment` in `types.ts`: what `assemble()` returns. */
export const engineAssessmentSchema = z.object({
  model_version: z.string(),
  mode: z.enum(['full', 'quick']).meta({
    description: "`quick` when no judge's reply was merged: the quick scan alone.",
  }),
  content_type: z.string(),
  audience: z
    .object({ archetype: z.string(), role: z.string().nullable() })
    .catchall(z.string().nullable())
    .meta({ description: 'The archetype, the role, and each audience modifier → its option.' }),
  effective_weights: appealWeights,
  scores: appealWeights.extend({
    overall: z.number(),
    band: z.string(),
    balance_index: z.number(),
  }),
  lenses: numberMap,
  duties: z.object({
    profile: numberMap,
    primary: z.string(),
    target: numberMap.nullable(),
    fit: z.number().nullable(),
    source,
  }),
  appeal_share: numberMap,
  craft: craftSchema,
  group_scores: numberMap,
  culture: cultureReportSchema
    .nullable()
    .meta({ description: 'Null with the culture module off.' }),
  dimensions: z.array(
    z.object({
      id: z.string(),
      appeal: z.string().nullable(),
      score: z.number(),
      rationale: z.string().optional(),
      source,
    })
  ),
  perspectives: z.array(
    z.object({
      id: z.string(),
      score: z.number().nullable(),
      summary: z.string(),
      levers: z.array(leverStateSchema.extend({ id: z.string() })),
    })
  ),
  perspectives_source: source,
  highlights: z.array(highlightSchema),
  recommendations: z.array(recommendationSchema),
  balance_findings: z.array(z.object({ id: z.string(), name: z.string(), message: z.string() })),
  red_flags: z.array(redFlagSchema),
  judges: z.record(z.string(), z.string()),
  source: z.string().nullable().meta({ description: 'Where the text came from, if known.' }),
});

/** `JudgeRunErrorCode` (`lib/app/judges/run-judge.ts`) and the editor's own. */
const EDITOR_ERROR_CODES = [
  'agent_not_found',
  'agent_inactive',
  'model_not_approved',
  'over_budget',
  'rate_limited',
  'malformed',
  'truncated',
  'refused',
  'provider_error',
  'slot_unavailable',
  'internal_error',
] as const;

/** `EditorRecord` in `lib/app/assessments/editor.ts`. */
export const editorRecordSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('written'),
    summary: z.object({
      verdict: z.string(),
      changes: z.array(
        z.object({ recommendation: z.string(), change: z.string(), why: z.string() })
      ),
      works: z.array(z.string()),
    }),
    dropped: z.array(
      z.object({ at: z.string(), reason: z.string(), detail: z.string().optional() })
    ),
    model: z.string(),
    costUsd: z.number(),
  }),
  z.object({
    status: z.literal('skipped'),
    reason: z.enum(['too_few_judges', 'no_judge_answered']),
  }),
  z.object({
    status: z.literal('failed'),
    errorCode: z.enum(EDITOR_ERROR_CODES),
    model: z.string().nullable(),
    costUsd: z.number(),
  }),
]);

/**
 * The result as the API serves it: the assembled assessment and, on a stored
 * run's, the editor's record (`withEditor()`). A quick scan and a run kept
 * nowhere carry no `editor`.
 */
export const engineResultSchema = engineAssessmentSchema
  .extend({
    editor: editorRecordSchema.optional().meta({
      description: "The editor's summary, or why there is none. A stored run's only.",
    }),
  })
  .meta({
    title: 'HowDoesThisLandResult',
    description: "HowDoesThisLand's assembled assessment.",
  });

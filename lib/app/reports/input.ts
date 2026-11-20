/**
 * What the report reads, checked (t-29).
 *
 * The report reads two API answers: the assessment
 * (`GET /api/v1/assessments/{id}`) and the model version it ran on
 * (`GET /api/v1/frameworks/{slug}/versions/{version}`). The first serves
 * `result` and `context` as `unknown`, because they are each framework's own
 * shapes (`lib/app/api/registry.ts`). The report never reads `context`, so
 * a share link does not serve it. The second is the whole model document.
 * Both are external data to the page, so each is parsed here and never cast.
 *
 * The schemas cover the fields the report shows, and Zod strips the rest, so
 * a field the engine adds later does not break an old report. They are
 * HowDoesThisLand's: this framework's result as `assemble()` builds it
 * (`lib/app/frameworks/howdoesthisland/engine/types.ts`) and its model
 * document as materialised. A second framework brings its own.
 */
import { z } from 'zod';
import { sharedAssessmentSchema } from '@/lib/app/api/registry';

// ─── The assessment ─────────────────────────────────────────────────────────

const source = z.enum(['quick', 'ai']);
const appealWeights = z.object({
  ethos: z.number(),
  pathos: z.number(),
  logos: z.number(),
  kairos: z.number(),
});

const highlightSchema = z.object({
  start: z.number().int(),
  end: z.number().int(),
  quote: z.string(),
  dimension: z.string(),
  appeal: z.string().nullable(),
  polarity: z.enum(['strength', 'weakness']),
  note: z.string(),
  source,
  flag: z.string().optional(),
});

const redFlagSchema = z.object({
  id: z.string(),
  quote: z.string(),
  start: z.number().int().optional(),
  end: z.number().int().optional(),
  severity: z.string(),
  note: z.string().optional(),
  source,
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
  example: z.boolean().optional(),
});

const leverStatus = z.enum(['present', 'absent', 'misused', 'not_applicable', 'unknown']);

const cultureSchema = z.object({
  reader: z.object({
    id: z.string(),
    name: z.string(),
    global: z.boolean(),
    lewis_label: z.string(),
    targets: z.record(z.string(), z.number()),
    tolerance: z.number(),
  }),
  writer: z
    .object({ id: z.string(), name: z.string(), targets: z.record(z.string(), z.number()) })
    .nullable(),
  positions: z.record(z.string(), z.number()),
  gaps: z.array(
    z.object({ scale: z.string(), writer: z.number(), reader: z.number(), diff: z.number() })
  ),
  source,
});

/** The editor's record on a stored result (`lib/app/assessments/editor.ts`). */
const editorSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('written'),
    summary: z.object({
      verdict: z.string(),
      changes: z.array(
        z.object({ recommendation: z.string(), change: z.string(), why: z.string() })
      ),
      works: z.array(z.string()),
    }),
    model: z.string(),
  }),
  z.object({ status: z.literal('skipped'), reason: z.string() }),
  z.object({ status: z.literal('failed'), errorCode: z.string(), model: z.string().nullable() }),
]);

/** HowDoesThisLand's assembled result, plus the editor's record when there is one. */
export const reportResultSchema = z.object({
  model_version: z.string(),
  mode: z.enum(['full', 'quick']),
  content_type: z.string(),
  audience: z.record(z.string(), z.string().nullable()),
  effective_weights: appealWeights,
  scores: appealWeights.extend({
    overall: z.number(),
    band: z.string(),
    balance_index: z.number(),
  }),
  lenses: z.record(z.string(), z.number()),
  duties: z.object({
    profile: z.record(z.string(), z.number()),
    primary: z.string(),
    target: z.record(z.string(), z.number()).nullable(),
    fit: z.number().nullable(),
    source,
  }),
  craft: z.object({
    words: z.number(),
    sentences: z.number(),
    speaking_sec: z.number(),
    gunning_fog: z.number(),
    fk_grade: z.number(),
    passive_pct: z.number(),
    emotional_pct: z.number(),
    avg_sentence: z.number(),
  }),
  group_scores: z.record(z.string(), z.number()),
  culture: cultureSchema.nullable(),
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
      levers: z.array(
        z.object({
          id: z.string(),
          status: leverStatus,
          quote: z.string().optional(),
          note: z.string().optional(),
        })
      ),
    })
  ),
  perspectives_source: source,
  highlights: z.array(highlightSchema),
  recommendations: z.array(recommendationSchema),
  balance_findings: z.array(z.object({ id: z.string(), name: z.string(), message: z.string() })),
  red_flags: z.array(redFlagSchema),
  /** Judge group → that judge's one-paragraph summary. */
  judges: z.record(z.string(), z.string()),
  editor: editorSchema.optional(),
});

export type ReportResult = z.infer<typeof reportResultSchema>;
export type ReportHighlight = z.infer<typeof highlightSchema>;
export type ReportRecommendation = z.infer<typeof recommendationSchema>;
export type ReportRedFlag = z.infer<typeof redFlagSchema>;

/**
 * The assessment as the report reads it: what a share link serves
 * (`sharedAssessmentSchema`), plus the two fields only a workspace member
 * sees. `GET assessments/{id}` sends both; a shared report sends neither, so
 * one parser reads all three variants' inputs (t-32). The detail's other
 * fields (its id, source, timings, each run's cost) are stripped.
 */
export const reportAssessmentSchema = sharedAssessmentSchema.extend({
  /** What the run cost. Shown on the web report only. */
  costUsd: z.number().optional(),
  /** Why it failed, for a failed run's panel. */
  error: z.string().nullable().optional(),
  /** `BUDGET_EXCEEDED` for one refused by the budget as it was claimed (t-53). */
  errorCode: z.string().nullable().optional(),
});
export type ReportAssessment = z.infer<typeof reportAssessmentSchema>;

// ─── The model ──────────────────────────────────────────────────────────────

const named = z.object({ id: z.string(), name: z.string() });

/** The parts of the model document the report names things from. */
export const reportModelSchema = z.object({
  meta: z.object({ name: z.string(), version: z.string() }),
  appeals: z.array(named.extend({ question: z.string() })),
  dimensions: z.array(named.extend({ appeal: z.string() })),
  extra_dimensions: z.array(named.extend({ appeal: z.string(), group: z.string() })).default([]),
  lenses: z.array(named.extend({ tagline: z.string() })),
  duties: z.array(named.extend({ verb: z.string() })),
  perspectives: z.array(named.extend({ question: z.string(), levers: z.array(named) })),
  moves: z.array(named),
  red_flags: z.array(named.extend({ severity: z.string() })),
  content_types: z.array(named),
  archetypes: z.array(named),
  exec_roles: z.array(named),
  audience_modifiers: z.array(
    named.extend({ options: z.array(z.object({ id: z.string(), label: z.string() })) })
  ),
  groups: z.array(named.extend({ question: z.string() })).default([]),
  judge_catalogue: z.array(named.extend({ judges: z.array(z.string()) })),
  /** Judge slot (`judge_ethos`, as an assessment stores it) → the appeal or group it judges. */
  judges: z.array(z.object({ id: z.string(), appeal: z.string() })).default([]),
  scoring: z.object({
    bands: z.array(z.object({ min: z.number(), max: z.number(), label: z.string() })),
    interpretation: z.string(),
    integrity_caps: z
      .array(
        z.object({
          appeal: z.string(),
          dimension: z.string(),
          if_at_most: z.number(),
          cap: z.number(),
          why: z.string(),
        })
      )
      .default([]),
  }),
  limitations: z.array(z.object({ id: z.string(), title: z.string(), detail: z.string() })),
  /** Left out by the API with the culture switch off. */
  culture: z
    .object({
      scales: z.array(named.extend({ low: z.string(), high: z.string() })),
    })
    .optional(),
});

export type ReportModel = z.infer<typeof reportModelSchema>;

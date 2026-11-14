/**
 * The HowDoesThisLand model as the engine reads it (t-13).
 *
 * The prototype's `createEngine(MODEL)` opens by building lookup maps over the
 * model it is handed. This is that preamble, typed: the materialised model
 * (`materialise()`) is checked against the fields the engine actually reads,
 * then indexed. The schemas here are narrower than the import's
 * (`../schemas.ts`), which deliberately leave a record's content unchecked:
 * the engine is where that content gets its typed reading.
 *
 * **The model is never written.** A published model is deep-frozen and shared
 * by every caller, so the engine builds its own maps and reads through them.
 * The parsed copy is frozen too, so a write anywhere in the engine fails
 * loudly rather than leaking into the next assessment.
 */
import { z } from 'zod';

export const APPEALS = ['ethos', 'pathos', 'logos', 'kairos'] as const;
export type Appeal = (typeof APPEALS)[number];

/** The extra group the culture switch (D11) governs. */
export const CULTURE_GROUP = 'culture';

const appealWeights = z.object({
  ethos: z.number(),
  pathos: z.number(),
  logos: z.number(),
  kairos: z.number(),
});
const partialAppealWeights = appealWeights.partial();
const example = z.object({ before: z.string(), after: z.string() });
const strings = z.array(z.string());
/** A rubric: score (`"0"`…`"4"`) → what it means. */
const rubric = z.record(z.string(), z.string());
/** What a record is grounded in, by kind; the prompts name only the thinkers. */
const groundedIn = z.object({ thinkers: strings.optional() }).nullable().optional();

const heuristicSchema = z.object({
  ratio: z.object({ num: z.string(), den: z.string(), ideal: z.number() }).optional(),
  readability: z.boolean().optional(),
  structure: z.boolean().optional(),
  cta: z.boolean().optional(),
  pos: z.array(z.string()).optional(),
  neg: z.array(z.string()).optional(),
  base: z.number().nullable().optional(),
  target_per_k: z.number().optional(),
  neg_weight: z.number().optional(),
});

/**
 * A dimension, a lens or an extra dimension: the prototype keeps all three in
 * one map (`DIM`) and tells them apart by `appeal` (absent on a lens) and
 * `group` (extra dimensions only).
 */
const dimensionSchema = z.object({
  id: z.string(),
  name: z.string(),
  appeal: z.string().optional(),
  group: z.string().optional(),
  weight: z.number().optional(),
  heuristic: heuristicSchema.nullable().optional(),
  negative_signals: z.array(z.string()).nullable().optional(),
  moves: z.array(z.string()).optional(),
  advice: z.string().nullable().optional(),
  example: example.nullable().optional(),
  // Read by the judge prompts (t-18).
  description: z.string(),
  judge_asks: strings,
  rubric: rubric.nullable().optional(),
  positive_signals: strings.nullable().optional(),
  grounded_in: groundedIn,
});

const coreDimensionSchema = dimensionSchema.extend({ appeal: z.enum(APPEALS), weight: z.number() });
const extraDimensionSchema = dimensionSchema.extend({ appeal: z.string(), group: z.string() });

const moveSchema = z.object({
  id: z.string(),
  name: z.string(),
  how: z.string(),
  example,
  dimensions: strings,
});

const redFlagSchema = z.object({
  id: z.string(),
  name: z.string(),
  dimension: z.string(),
  severity: z.string(),
  description: z.string(),
  pattern: z.string(),
  appeal: z.string(),
});

const dutySchema = z.object({
  id: z.string(),
  pos: z.array(z.string()),
  name: z.string(),
  latin: z.string(),
  verb: z.string(),
  description: z.string(),
  signals: z.string(),
});

const leverSchema = z.object({
  id: z.string(),
  name: z.string(),
  quick: z.array(z.string()).nullable().optional(),
  look_for: z.string(),
  misuse: z.string(),
});
const perspectiveSchema = z.object({
  id: z.string(),
  name: z.string(),
  school: z.string(),
  question: z.string(),
  levers: z.array(leverSchema),
});

const contentTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  weights: appealWeights,
  priority_dimensions: z.array(z.string()),
  watch_outs: strings,
});

const audienceModifierSchema = z.object({
  id: z.string(),
  name: z.string(),
  options: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      guidance: z.string(),
      weight_delta: partialAppealWeights.nullable().optional(),
    })
  ),
});

/**
 * The prompt fields are optional because `general`, which has no primary
 * duty, has none of them; the prompts read them only for an archetype with one.
 */
const archetypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  primary: z.string().nullable(),
  secondary: z.string().nullable(),
  weight_delta: partialAppealWeights.nullable().optional(),
  motto: z.string().nullable().optional(),
  basis: z.string().nullable().optional(),
  values: z.string().nullable().optional(),
  style: z.string().nullable().optional(),
  persuaded_by: strings.nullable().optional(),
  backfires: strings.nullable().optional(),
  key_question: z.string().nullable().optional(),
});

const execRoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  primary: z.string(),
  secondary: z.string(),
  cares_about: z.array(z.string()),
  question: z.string(),
  red_flags: strings,
});

/** A judge as the version describes it: who it is and what it is told (D17). */
const judgeSchema = z.object({
  id: z.string(),
  appeal: z.string(),
  persona: z.string(),
  instruction: z.string(),
  rules: strings,
  max_highlights: z.number(),
  max_recommendations: z.number(),
});

const balanceRuleSchema = z.object({ id: z.string(), name: z.string(), message: z.string() });

const lewisSchema = z.object({ linear: z.number(), multi: z.number(), reactive: z.number() });

/** Loose: a culture profile spreads the whole country record (region and all). */
const countrySchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  lewis: lewisSchema,
  hofstede: z.record(z.string(), z.number().nullable()),
  persuading: z.number(),
});

const scaleSchema = z.object({
  id: z.string(),
  name: z.string(),
  low: z.string(),
  high: z.string(),
});

export const engineModelSchema = z.object({
  meta: z.object({ version: z.string() }),
  dimensions: z.array(coreDimensionSchema),
  lenses: z.array(dimensionSchema),
  // Required, though the prototype defaulted them: its quick scan scores the
  // craft and audience dimensions unconditionally, so it fails without them.
  extra_dimensions: z.array(extraDimensionSchema),
  groups: z.array(z.object({ id: z.string() })),
  moves: z.array(moveSchema),
  red_flags: z.array(redFlagSchema),
  duties: z.array(dutySchema).min(1),
  perspectives: z.array(perspectiveSchema),
  content_types: z.array(contentTypeSchema),
  audience_modifiers: z.array(audienceModifierSchema),
  archetypes: z.array(archetypeSchema),
  exec_roles: z.array(execRoleSchema),
  balance_rules: z.array(balanceRuleSchema),
  judges: z.array(judgeSchema),
  /** The judge groups a caller may ask for by name; `always` ones run in every group. */
  judge_catalogue: z.array(
    z.object({ id: z.string(), judges: strings, always: z.boolean().optional() })
  ),
  /** Every kind of reference record; the prompts read only their names. */
  knowledge_refs: z.record(z.string(), z.array(z.object({ id: z.string(), name: z.string() }))),
  scoring: z.object({
    bands: z.array(z.object({ min: z.number(), max: z.number(), label: z.string() })),
    integrity_caps: z
      .array(
        z.object({
          appeal: z.string(),
          dimension: z.string(),
          if_at_most: z.number(),
          cap: z.number(),
        })
      )
      .optional(),
  }),
  length_targets: z.record(z.string(), z.tuple([z.number(), z.number()])).optional(),
  culture: z.object({ countries: z.array(countrySchema), scales: z.array(scaleSchema) }).optional(),
});

export type ModelData = z.infer<typeof engineModelSchema>;
export type Dimension = z.infer<typeof dimensionSchema>;
export type CoreDimension = z.infer<typeof coreDimensionSchema>;
export type ExtraDimension = z.infer<typeof extraDimensionSchema>;
export type Heuristic = z.infer<typeof heuristicSchema>;
export type Move = z.infer<typeof moveSchema>;
export type RedFlagDef = z.infer<typeof redFlagSchema>;
export type Duty = z.infer<typeof dutySchema>;
export type Lever = z.infer<typeof leverSchema>;
export type Perspective = z.infer<typeof perspectiveSchema>;
export type ContentType = z.infer<typeof contentTypeSchema>;
export type AudienceModifier = z.infer<typeof audienceModifierSchema>;
export type Archetype = z.infer<typeof archetypeSchema>;
export type ExecRole = z.infer<typeof execRoleSchema>;
export type Country = z.infer<typeof countrySchema>;
export type Scale = z.infer<typeof scaleSchema>;
export type Lewis = z.infer<typeof lewisSchema>;
export type JudgeDef = z.infer<typeof judgeSchema>;
export type AppealWeights = z.infer<typeof appealWeights>;
export type PartialAppealWeights = z.infer<typeof partialAppealWeights>;

/**
 * The model, checked and indexed: the prototype's `createEngine` preamble.
 * Names follow the prototype (`DIM`, `CT`, `FN`, …) so the two read side by
 * side. Every map is a `Map`, so an id the model lacks reads as `undefined`
 * rather than as whatever `Object.prototype` holds under that name.
 */
export interface EngineModel {
  readonly data: ModelData;
  /** Core dimensions (`dimensions`). */
  readonly DIMS: readonly CoreDimension[];
  readonly LENSES: readonly Dimension[];
  readonly EXTRA: readonly ExtraDimension[];
  readonly GROUPS: readonly { id: string }[];
  /** Dimensions, lenses and extra dimensions by id. */
  readonly DIM: ReadonlyMap<string, Dimension>;
  readonly MOVE: ReadonlyMap<string, Move>;
  readonly CT: ReadonlyMap<string, ContentType>;
  readonly PV: ReadonlyMap<string, Perspective>;
  readonly LEVER: ReadonlyMap<string, Lever & { perspective: string }>;
  readonly ARCH: ReadonlyMap<string, Archetype>;
  readonly ROLE: ReadonlyMap<string, ExecRole>;
  readonly FN: readonly Duty[];
  readonly FLAG: ReadonlyMap<string, RedFlagDef>;
  /** Audience modifiers other than `archetype`, which has its own field. */
  readonly MODS: readonly AudienceModifier[];
  readonly COUNTRY: ReadonlyMap<string, Country>;
  readonly SCALES: readonly Scale[];
  readonly SCALE_IDS: readonly string[];
  readonly LEN_TARGET: Readonly<Record<string, readonly [number, number]>>;
  /** Extra groups (`craft`, …) by id. */
  readonly GROUP: ReadonlyMap<string, { id: string }>;
  /** Judges by their slot id (`judge_ethos`). */
  readonly JUDGE: ReadonlyMap<string, JudgeDef>;
  /** Every reference record (thinker, framework, …) by id. */
  readonly REF: ReadonlyMap<string, { id: string; name: string }>;
}

const byId = <T extends { id: string }>(list: readonly T[]): Map<string, T> =>
  new Map(list.map((x) => [x.id, x]));

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Indexed models by the object they were read from: a published model is one shared object. */
const indexed = new WeakMap<object, EngineModel>();

/**
 * Checks and indexes a materialised model. Throws a `ZodError` naming the
 * field when the model lacks something the engine reads.
 */
export function indexModel(model: object): EngineModel {
  const cached = indexed.get(model);
  if (cached) return cached;

  const data = deepFreeze(engineModelSchema.parse(model));
  const EXTRA = data.extra_dimensions;
  const DIM = new Map<string, Dimension>(
    [...data.dimensions, ...data.lenses].map((d) => [d.id, d])
  );
  for (const d of EXTRA) DIM.set(d.id, d);
  const LEVER = new Map<string, Lever & { perspective: string }>();
  for (const p of data.perspectives) {
    for (const l of p.levers) LEVER.set(l.id, { ...l, perspective: p.id });
  }
  const culture = data.culture ?? { countries: [], scales: [] };

  const engineModel: EngineModel = {
    data,
    DIMS: data.dimensions,
    LENSES: data.lenses,
    EXTRA,
    GROUPS: data.groups,
    DIM,
    MOVE: byId(data.moves),
    CT: byId(data.content_types),
    PV: byId(data.perspectives),
    LEVER,
    ARCH: byId(data.archetypes),
    ROLE: byId(data.exec_roles),
    FN: data.duties,
    FLAG: byId(data.red_flags),
    MODS: data.audience_modifiers.filter((m) => m.id !== 'archetype'),
    COUNTRY: byId(culture.countries),
    SCALES: culture.scales,
    SCALE_IDS: culture.scales.map((s) => s.id),
    LEN_TARGET: data.length_targets ?? {},
    GROUP: byId(data.groups),
    JUDGE: byId(data.judges),
    REF: new Map(Object.values(data.knowledge_refs).flatMap((refs) => refs.map((r) => [r.id, r]))),
  };
  indexed.set(model, engineModel);
  return engineModel;
}

/** A lookup the caller has already promised will hit; a miss is a bug, so it says which. */
export function must<T>(map: ReadonlyMap<string, T>, id: string, what: string): T {
  const hit = map.get(id);
  if (hit === undefined) throw new Error(`The model has no ${what} '${id}'`);
  return hit;
}

/**
 * Zod schemas for the HowDoesThisLand model's records (schema version 4).
 *
 * Each schema states what the import relies on: the record's id, its name,
 * and the type of every reference field, so a reference of the wrong shape is
 * refused rather than silently skipped. The rest of a record (rubrics,
 * signals, prompts' content) is carried as it is: schemas are loose, because
 * a published version is stored exactly as reviewed and the engine (f-engine)
 * gives those fields their typed reading.
 */
import { z } from 'zod';
import { adjustmentBoundsSchema } from '@/lib/app/frameworks/howdoesthisland/engine/model';

const id = z.string().min(1);
const ids = z.array(id);
const named = { id, name: z.string().min(1) };

/** `grounded_in` / `gumption`: references into `knowledge_refs`. */
export const groundedSchema = z.looseObject({
  frameworks: ids.optional(),
  concepts: ids.optional(),
  thinkers: ids.optional(),
  studies: ids.optional(),
});

const appealWeights = z.record(z.string(), z.number());

export const appealSchema = z.looseObject({
  ...named,
  grounded_in: groundedSchema,
  research: ids.optional(),
});

export const dimensionSchema = z.looseObject({
  ...named,
  appeal: id,
  grounded_in: groundedSchema.optional(),
  research: ids.optional(),
  moves: ids.optional(),
});

export const lensSchema = z.looseObject({
  ...named,
  grounded_in: groundedSchema.optional(),
  research: ids.optional(),
  moves: ids.optional(),
});

export const extraDimensionSchema = z.looseObject({
  ...named,
  appeal: id,
  group: id,
  grounded_in: groundedSchema.optional(),
  research: ids.optional(),
  moves: ids.optional(),
});

export const archetypeSchema = z.looseObject({
  ...named,
  primary: id.nullable(),
  secondary: id.nullable(),
  weight_delta: appealWeights,
});

export const execRoleSchema = z.looseObject({
  ...named,
  archetype: id,
  primary: id,
  secondary: id,
});

export const leverSchema = z.looseObject({ ...named, refs: ids });

export const perspectiveSchema = z.looseObject({
  ...named,
  gumption: groundedSchema,
  research: ids.optional(),
  levers: z.array(z.unknown()),
});

export const moveSchema = z.looseObject({
  ...named,
  appeal: id,
  dimensions: ids,
  grounded_in: groundedSchema,
  research: ids.optional(),
});

export const redFlagSchema = z.looseObject({
  ...named,
  appeal: id,
  dimension: id,
  grounded_in: groundedSchema,
  research: ids.optional(),
});

export const contentTypeSchema = z.looseObject({
  ...named,
  weights: appealWeights,
  overlay: id.nullable(),
  frameworks: ids,
  priority_dimensions: ids,
});

export const audienceModifierSchema = z.looseObject({
  ...named,
  grounded_in: groundedSchema.optional(),
  research: ids.optional(),
  options: z.array(z.looseObject({ id })),
});

export const balanceRuleSchema = z.looseObject(named);
export const craftMetricSchema = z.looseObject(named);
export const dutySchema = z.looseObject(named);
export const groupSchema = z.looseObject({ ...named, judge: id });
export const judgeCatalogueSchema = z.looseObject({ ...named, judges: ids });

export const judgeSchema = z.looseObject({
  id,
  appeal: id,
  instruction: z.string().min(1),
});

export const researchSchema = z.looseObject({ id, cite: z.string().min(1) });
export const limitationSchema = z.looseObject({ id, title: z.string().min(1) });

export const knowledgeFrameworkSchema = z.looseObject({ ...named, originators: ids.optional() });
export const knowledgeConceptSchema = z.looseObject(named);
export const knowledgeThinkerSchema = z.looseObject(named);
export const knowledgeStudySchema = z.looseObject(named);
export const knowledgeOverlaySchema = z.looseObject(named);

export const culturePoleSchema = z.looseObject(named);
export const cultureHofstedeDimSchema = z.looseObject(named);
export const cultureScaleSchema = z.looseObject(named);
export const cultureCountrySchema = z.looseObject({
  ...named,
  hofstede: z.record(z.string(), z.number().nullable()),
  lewis: z.record(z.string(), z.number()),
});

// ─── Singleton sections (what is left once their collections are taken out) ──

const semver = z.string().regex(/^\d+\.\d+\.\d+$/, 'expected a version like 0.5.1');

export const metaSchema = z.looseObject({
  id,
  name: z.string().min(1),
  version: semver,
  schema_version: z.string().min(1),
});

/**
 * Bands must cover every score the engine can give, once each: whole-number
 * limits, the first from 0, each next one starting where the last ended, the
 * last up to 100. The engine rounds `overall` before `bandOf` reads it,
 * so a gap (39 then 41) or a fractional limit would leave some score with no
 * band, which no band filter on the review list could ever match. Labels are
 * unique, since the list filters by label.
 *
 * Checked here, where a version comes in, and not by the engine's read
 * (`engine/model.ts`), so a version stored before this check still opens.
 */
export function checkBands(
  bands: ReadonlyArray<{ label: string; min: number; max: number }>,
  ctx: z.RefinementCtx
): void {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (bands.length === 0) return fail('Declare at least one band');
  const labels = bands.map((b) => b.label);
  const twice = labels.find((label, i) => labels.indexOf(label) !== i);
  if (twice !== undefined) {
    return fail(`Two bands are labelled '${twice}'; a band filter could not tell them apart`);
  }
  if (bands.some((b) => !Number.isInteger(b.min) || !Number.isInteger(b.max))) {
    return fail('Band limits must be whole numbers, since overall scores are');
  }
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  if (sorted[0].min !== 0) return fail(`The lowest band must start at 0, not ${sorted[0].min}`);
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (b.max < b.min) return fail(`A band runs from ${b.min} down to ${b.max}`);
    const next = sorted[i + 1];
    if (next && next.min !== b.max + 1) {
      return fail(
        next.min <= b.max
          ? `Bands overlap: ${b.min}–${b.max} and ${next.min}–${next.max}`
          : `No band covers ${b.max + 1}–${next.min - 1}`
      );
    }
  }
  const last = sorted[sorted.length - 1];
  if (last.max !== 100) return fail(`The highest band must end at 100, not ${last.max}`);
}

export const scoringSchema = z.looseObject({
  bands: z
    .array(z.looseObject({ label: z.string(), min: z.number(), max: z.number() }))
    .superRefine(checkBands),
  integrity_caps: z.array(z.looseObject({ appeal: id, dimension: id })),
  /** How far a project may adjust the weights (t-72); a version without it allows none. */
  adjustment_bounds: adjustmentBoundsSchema.optional(),
});

export const brandSchema = z.looseObject({ name: z.string().min(1) });
export const objectSchema = z.looseObject({});
export const lengthTargetsSchema = z.record(z.string(), z.array(z.number()));
/** A section that is wholly one collection: checked record by record instead. */
export const collectionSectionSchema = z.array(z.unknown());

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

export const scoringSchema = z.looseObject({
  bands: z.array(z.looseObject({ label: z.string(), min: z.number(), max: z.number() })),
  integrity_caps: z.array(z.looseObject({ appeal: id, dimension: id })),
});

export const brandSchema = z.looseObject({ name: z.string().min(1) });
export const objectSchema = z.looseObject({});
export const lengthTargetsSchema = z.record(z.string(), z.array(z.number()));
/** A section that is wholly one collection: checked record by record instead. */
export const collectionSectionSchema = z.array(z.unknown());

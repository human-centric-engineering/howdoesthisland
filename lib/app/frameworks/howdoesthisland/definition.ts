/**
 * The HowDoesThisLand framework, defined in code (app-plan §8.1, D2).
 *
 * Its sections, the collections of records in them, and the fields that refer
 * to other records. The reference list follows the model's own written spec,
 * `meta.reference_rules` (added in 0.5.1), line by line, plus `groups[].judge`
 * and `extra_dimensions`' grounding, which `prototype/tools/validate_refs.py`
 * also checks. A model with any reference that does not resolve is refused.
 */
import { isJsonObject } from '@/lib/app/frameworks/codec';
import { isCultureEnabled } from '@/lib/app/frameworks/culture';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import { HOWDOESTHISLAND_SLUG } from '@/lib/app/frameworks/howdoesthisland/slug';
import {
  SECTION_KIND,
  type CollectionSpec,
  type FrameworkDefinition,
  type JsonObject,
  type ReferenceSpec,
} from '@/lib/app/frameworks/types';
import * as s from '@/lib/app/frameworks/howdoesthisland/schemas';

export { HOWDOESTHISLAND_SLUG };

const collections: CollectionSpec[] = [
  { kind: 'appeal', path: ['appeals'], schema: s.appealSchema },
  { kind: 'dimension', path: ['dimensions'], schema: s.dimensionSchema },
  { kind: 'lens', path: ['lenses'], schema: s.lensSchema },
  { kind: 'archetype', path: ['archetypes'], schema: s.archetypeSchema },
  { kind: 'exec_role', path: ['exec_roles'], schema: s.execRoleSchema },
  {
    kind: 'perspective',
    path: ['perspectives'],
    schema: s.perspectiveSchema,
    nested: { field: 'levers', kind: 'lever', schema: s.leverSchema },
  },
  { kind: 'move', path: ['moves'], schema: s.moveSchema },
  { kind: 'red_flag', path: ['red_flags'], schema: s.redFlagSchema },
  { kind: 'content_type', path: ['content_types'], schema: s.contentTypeSchema },
  { kind: 'audience_modifier', path: ['audience_modifiers'], schema: s.audienceModifierSchema },
  { kind: 'balance_rule', path: ['balance_rules'], schema: s.balanceRuleSchema },
  { kind: 'craft_metric', path: ['craft_metrics'], schema: s.craftMetricSchema },
  { kind: 'judge', path: ['judges'], schema: s.judgeSchema },
  { kind: 'research', path: ['research'], schema: s.researchSchema },
  { kind: 'limitation', path: ['limitations'], schema: s.limitationSchema },
  { kind: 'duty', path: ['duties'], schema: s.dutySchema },
  { kind: 'group', path: ['groups'], schema: s.groupSchema },
  { kind: 'extra_dimension', path: ['extra_dimensions'], schema: s.extraDimensionSchema },
  { kind: 'judge_profile', path: ['judge_catalogue'], schema: s.judgeCatalogueSchema },
  {
    kind: 'knowledge_framework',
    path: ['knowledge_refs', 'frameworks'],
    schema: s.knowledgeFrameworkSchema,
  },
  {
    kind: 'knowledge_concept',
    path: ['knowledge_refs', 'concepts'],
    schema: s.knowledgeConceptSchema,
  },
  {
    kind: 'knowledge_thinker',
    path: ['knowledge_refs', 'thinkers'],
    schema: s.knowledgeThinkerSchema,
  },
  { kind: 'knowledge_study', path: ['knowledge_refs', 'studies'], schema: s.knowledgeStudySchema },
  {
    kind: 'knowledge_overlay',
    path: ['knowledge_refs', 'overlays'],
    schema: s.knowledgeOverlaySchema,
  },
  { kind: 'culture_pole', path: ['culture', 'poles'], schema: s.culturePoleSchema },
  {
    kind: 'culture_hofstede_dim',
    path: ['culture', 'hofstede_dims'],
    schema: s.cultureHofstedeDimSchema,
  },
  { kind: 'culture_scale', path: ['culture', 'scales'], schema: s.cultureScaleSchema },
  { kind: 'culture_country', path: ['culture', 'countries'], schema: s.cultureCountrySchema },
];

const sections = {
  meta: s.metaSchema,
  appeals: s.collectionSectionSchema,
  dimensions: s.collectionSectionSchema,
  lenses: s.collectionSectionSchema,
  archetypes: s.collectionSectionSchema,
  exec_roles: s.collectionSectionSchema,
  perspectives: s.collectionSectionSchema,
  moves: s.collectionSectionSchema,
  red_flags: s.collectionSectionSchema,
  content_types: s.collectionSectionSchema,
  audience_modifiers: s.collectionSectionSchema,
  balance_rules: s.collectionSectionSchema,
  craft_metrics: s.collectionSectionSchema,
  scoring: s.scoringSchema,
  judges: s.collectionSectionSchema,
  judge_output_schema: s.objectSchema,
  influence_output_schema: s.objectSchema,
  research: s.collectionSectionSchema,
  limitations: s.collectionSectionSchema,
  knowledge_refs: s.objectSchema,
  duties: s.collectionSectionSchema,
  brand: s.brandSchema,
  groups: s.collectionSectionSchema,
  extra_dimensions: s.collectionSectionSchema,
  length_targets: s.lengthTargetsSchema,
  culture: s.objectSchema,
  judge_catalogue: s.collectionSectionSchema,
} as const;

const field =
  (name: string) =>
  (record: JsonObject): unknown =>
    record[name];

const nested =
  (outer: string, inner: string) =>
  (record: JsonObject): unknown => {
    const value = record[outer];
    return isJsonObject(value) ? value[inner] : undefined;
  };

const KNOWLEDGE = [
  ['frameworks', 'knowledge_framework'],
  ['concepts', 'knowledge_concept'],
  ['thinkers', 'knowledge_thinker'],
  ['studies', 'knowledge_study'],
] as const;

/** `grounded_in.*` (or a perspective's `gumption.*`) → `knowledge_refs.*`. */
function grounding(from: string, holder: 'grounded_in' | 'gumption'): ReferenceSpec[] {
  return KNOWLEDGE.map(([part, target]) => ({
    from,
    relation: holder,
    field: `${from}.${holder}.${part}`,
    pick: nested(holder, part),
    targets: [target],
  }));
}

const DIMENSION_LIKE = ['dimension', 'lens', 'extra_dimension'] as const;

const references: ReferenceSpec[] = [
  // grounded_in.frameworks|concepts|thinkers|studies, and perspectives[].gumption
  ...[
    'appeal',
    'dimension',
    'lens',
    'move',
    'red_flag',
    'audience_modifier',
    'extra_dimension',
  ].flatMap((kind) => grounding(kind, 'grounded_in')),
  ...grounding('perspective', 'gumption'),
  // knowledge_refs.frameworks[].originators
  {
    from: 'knowledge_framework',
    relation: 'originator',
    field: 'knowledge_refs.frameworks[].originators',
    pick: field('originators'),
    targets: ['knowledge_thinker'],
  },
  // content_types[].frameworks and .overlay
  {
    from: 'content_type',
    relation: 'framework',
    field: 'content_types[].frameworks',
    pick: field('frameworks'),
    targets: ['knowledge_framework'],
  },
  {
    from: 'content_type',
    relation: 'overlay',
    field: 'content_types[].overlay',
    pick: field('overlay'),
    targets: ['knowledge_overlay'],
  },
  // perspectives[].levers[].refs: research (rs_*) or a study (st_*)
  {
    from: 'lever',
    relation: 'ref',
    field: 'perspectives[].levers[].refs',
    pick: field('refs'),
    targets: ['research', 'knowledge_study'],
  },
  // *.research
  ...[
    'appeal',
    'dimension',
    'lens',
    'move',
    'red_flag',
    'perspective',
    'audience_modifier',
    'extra_dimension',
  ].map((kind): ReferenceSpec => ({
    from: kind,
    relation: 'research',
    field: `${kind}.research`,
    pick: field('research'),
    targets: ['research'],
  })),
  // dimensions|lenses|extra_dimensions[].moves
  ...DIMENSION_LIKE.map((kind): ReferenceSpec => ({
    from: kind,
    relation: 'move',
    field: `${kind}.moves`,
    pick: field('moves'),
    targets: ['move'],
  })),
  // moves[].dimensions, red_flags[].dimension, content_types[].priority_dimensions,
  // scoring.integrity_caps[].dimension
  {
    from: 'move',
    relation: 'dimension',
    field: 'moves[].dimensions',
    pick: field('dimensions'),
    targets: DIMENSION_LIKE,
  },
  {
    from: 'red_flag',
    relation: 'dimension',
    field: 'red_flags[].dimension',
    pick: field('dimension'),
    targets: DIMENSION_LIKE,
  },
  {
    from: 'content_type',
    relation: 'priority_dimension',
    field: 'content_types[].priority_dimensions',
    pick: field('priority_dimensions'),
    targets: DIMENSION_LIKE,
  },
  {
    from: `${SECTION_KIND}:scoring`,
    relation: 'integrity_cap',
    field: 'scoring.integrity_caps[].dimension',
    pick: (record) =>
      Array.isArray(record.integrity_caps)
        ? record.integrity_caps.map((cap: unknown) => (isJsonObject(cap) ? cap.dimension : cap))
        : undefined,
    targets: DIMENSION_LIKE,
  },
  // archetypes[].primary|secondary, exec_roles[].primary|secondary → duties
  ...(['archetype', 'exec_role'] as const).flatMap((kind) =>
    (['primary', 'secondary'] as const).map((slot): ReferenceSpec => ({
      from: kind,
      relation: `${slot}_duty`,
      field: `${kind}.${slot}`,
      pick: field(slot),
      targets: ['duty'],
    }))
  ),
  // exec_roles[].archetype
  {
    from: 'exec_role',
    relation: 'archetype',
    field: 'exec_roles[].archetype',
    pick: field('archetype'),
    targets: ['archetype'],
  },
  // judges[].appeal, judge_catalogue[].judges → appeals, groups, 'lenses' or 'influence'
  {
    from: 'judge',
    relation: 'judges',
    field: 'judges[].appeal',
    pick: field('appeal'),
    targets: ['appeal', 'group'],
    literals: ['lenses', 'influence'],
  },
  {
    from: 'judge_profile',
    relation: 'includes',
    field: 'judge_catalogue[].judges',
    pick: field('judges'),
    targets: ['appeal', 'group'],
    literals: ['lenses', 'influence'],
  },
  // groups[].judge (checked by validate_refs.py)
  {
    from: 'group',
    relation: 'judged_by',
    field: 'groups[].judge',
    pick: field('judge'),
    targets: ['judge'],
  },
  // length_targets keys → content_types
  {
    from: `${SECTION_KIND}:length_targets`,
    relation: 'length_target',
    field: 'length_targets keys',
    pick: (record) => Object.keys(record),
    targets: ['content_type'],
  },
];

export const howDoesThisLand: FrameworkDefinition = {
  slug: HOWDOESTHISLAND_SLUG,
  name: 'HowDoesThisLand',
  summary:
    'How a piece of writing lands on credibility, emotion, reason and timing, ' +
    'the levers of influence it pulls, and what to change.',
  sections,
  collections,
  references,
  versionOf: (document) => {
    // decompose() has already checked meta against its schema.
    const meta = isJsonObject(document.meta) ? document.meta : {};
    return { version: String(meta.version), schemaVersion: String(meta.schema_version) };
  },
  // The culture switch is read here, when the engine is made, so one engine
  // answers the same way for its whole life.
  createEngine: (model) => createHowDoesThisLandEngine(model, { culture: isCultureEnabled() }),
};

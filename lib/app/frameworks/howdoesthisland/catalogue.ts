/**
 * What API callers may know about a HowDoesThisLand version (t-67): the ids
 * and names a review request takes, and the ids and names a result uses.
 *
 * The model is HowDoesThisLand's IP (owner ruling, 2026-11-22). The catalogue
 * is its public face: enough to build a request and read a result, and
 * nothing that makes the model work. No rubric, weight, formula, cap,
 * detection pattern, reviewer instruction or description is copied here, and
 * each entry is built field by field, so a field a later version adds is not
 * served until it is added here on purpose.
 *
 * Takes the model as `versionDocument()` serves it, so a section a switch
 * withholds (culture) is already gone, and the countries with it.
 */
import { z } from 'zod';
import type { JsonObject } from '@/lib/app/frameworks/types';

const named = z.object({ id: z.string(), name: z.string() });

/**
 * The parts of the model the catalogue reads. Every section but culture is
 * one the import refuses a version without (the definition's `sections`);
 * a few fields read here (a country's `region`, a red flag's `severity`, an
 * audience option's `label`) are not import-checked. A version that lacks
 * one is a model defect: the catalogue throws a plain error, which the
 * routes log and answer 500, rather than serving an empty list callers would
 * take as "no ids", or a 400 naming the model's fields. A share link's page
 * never builds the catalogue, so it still renders. Only culture is optional:
 * its switch withholds it.
 */
const modelSchema = z.object({
  content_types: z.array(named),
  archetypes: z.array(named),
  exec_roles: z.array(named),
  audience_modifiers: z.array(
    named.extend({ options: z.array(z.object({ id: z.string(), label: z.string() })) })
  ),
  appeals: z.array(named),
  dimensions: z.array(named.extend({ appeal: z.string() })),
  extra_dimensions: z.array(named.extend({ appeal: z.string(), group: z.string() })),
  lenses: z.array(named),
  groups: z.array(named),
  red_flags: z.array(named.extend({ severity: z.string() })),
  duties: z.array(named),
  moves: z.array(named),
  perspectives: z.array(named.extend({ levers: z.array(named) })),
  judge_catalogue: z.array(named),
  judges: z.array(z.object({ id: z.string(), appeal: z.string() })),
  culture: z
    .object({
      countries: z.array(named.extend({ region: z.string() })),
      scales: z.array(named),
    })
    .optional(),
});

/** Strip a record to its id and name: the schema's other keys are dropped. */
const idName = ({ id, name }: { id: string; name: string }) => ({ id, name });

type IdName = { id: string; name: string };

/**
 * Bump when the catalogue's fields change, so a caller holding an old ETag
 * for a version does not keep the old catalogue (`versionETagSource`).
 */
export const CATALOGUE_SHAPE = 2;

/** What `howDoesThisLandCatalogue` returns: `frameworkCatalogueSchema` in the registry. */
export type HowDoesThisLandCatalogue = {
  request: {
    contentTypes: IdName[];
    archetypes: IdName[];
    roles: IdName[];
    audience: Array<IdName & { options: Array<{ id: string; label: string }> }>;
    /** Only with the culture switch on. */
    countries?: Array<IdName & { region: string }>;
  };
  result: {
    appeals: IdName[];
    /**
     * `appeal` is the id a result's dimension row carries; a dimension a
     * reviewer group scores also names its `group` (null for a core one).
     */
    dimensions: Array<IdName & { appeal: string; group: string | null }>;
    lenses: IdName[];
    groups: IdName[];
    redFlags: Array<IdName & { severity: string }>;
    duties: IdName[];
    /** The moves a recommendation names. */
    moves: IdName[];
    /** The perspectives and levers a result scores. */
    perspectives: Array<IdName & { levers: IdName[] }>;
    /** The cultural scales a result's culture positions use. Only with the culture switch on. */
    cultureScales?: IdName[];
    /** The reviewer sets a review's `profile` names. */
    profiles: IdName[];
    /**
     * The AI reviewers a review's `judges` and `judgeRuns` name, each with what
     * it covers: an appeal's id, a group's id, or `lenses` or `influence`.
     */
    reviewers: Array<{ id: string; covers: string }>;
  };
};

export function howDoesThisLandCatalogue(model: JsonObject): JsonObject {
  return buildCatalogue(model);
}

function buildCatalogue(model: JsonObject): HowDoesThisLandCatalogue {
  const parsed = modelSchema.safeParse(model);
  if (!parsed.success) {
    // Paths only, for the log: never sent to a caller.
    const where = parsed.error.issues.slice(0, 5).map((i) => i.path.join('.'));
    throw new Error(`The model does not fit the catalogue at: ${where.join(', ')}`);
  }
  const m = parsed.data;
  return {
    request: {
      contentTypes: m.content_types.map(idName),
      archetypes: m.archetypes.map(idName),
      roles: m.exec_roles.map(idName),
      audience: m.audience_modifiers.map((a) => ({
        ...idName(a),
        options: a.options.map(({ id, label }) => ({ id, label })),
      })),
      // Only with the culture switch on: off, the section is not in the model.
      ...(m.culture
        ? { countries: m.culture.countries.map(({ id, name, region }) => ({ id, name, region })) }
        : {}),
    },
    result: {
      appeals: m.appeals.map(idName),
      dimensions: [
        ...m.dimensions.map((d) => ({ ...idName(d), appeal: d.appeal, group: null })),
        ...m.extra_dimensions.map((d) => ({ ...idName(d), appeal: d.appeal, group: d.group })),
      ],
      lenses: m.lenses.map(idName),
      groups: m.groups.map(idName),
      redFlags: m.red_flags.map(({ id, name, severity }) => ({ id, name, severity })),
      duties: m.duties.map(idName),
      moves: m.moves.map(idName),
      perspectives: m.perspectives.map((p) => ({ ...idName(p), levers: p.levers.map(idName) })),
      ...(m.culture ? { cultureScales: m.culture.scales.map(idName) } : {}),
      profiles: m.judge_catalogue.map(idName),
      reviewers: m.judges.map(({ id, appeal }) => ({ id, covers: appeal })),
    },
  };
}

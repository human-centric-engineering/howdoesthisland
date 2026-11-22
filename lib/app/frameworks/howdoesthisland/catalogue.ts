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
const list = <T extends z.ZodType>(item: T) => z.array(item).catch([]);

const modelSchema = z.object({
  content_types: list(named),
  archetypes: list(named),
  exec_roles: list(named),
  audience_modifiers: list(
    named.extend({
      options: list(z.object({ id: z.string(), label: z.string() })),
    })
  ),
  appeals: list(named),
  dimensions: list(named.extend({ appeal: z.string() })),
  extra_dimensions: list(named.extend({ group: z.string() })),
  lenses: list(named),
  groups: list(named),
  red_flags: list(named.extend({ severity: z.string() })),
  duties: list(named),
  culture: z
    .object({ countries: list(named.extend({ region: z.string() })) })
    .optional()
    .catch(undefined),
});

/** Strip a record to its id and name: the schema's other keys are dropped. */
const idName = ({ id, name }: { id: string; name: string }) => ({ id, name });

type IdName = { id: string; name: string };

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
    /** A core dimension names its appeal; a reviewer group's names its group. */
    dimensions: Array<IdName & { appeal: string | null; group: string | null }>;
    lenses: IdName[];
    groups: IdName[];
    redFlags: Array<IdName & { severity: string }>;
    duties: IdName[];
  };
};

export function howDoesThisLandCatalogue(model: JsonObject): JsonObject {
  return buildCatalogue(model);
}

function buildCatalogue(model: JsonObject): HowDoesThisLandCatalogue {
  const m = modelSchema.parse(model);
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
        ...m.extra_dimensions.map((d) => ({ ...idName(d), appeal: null, group: d.group })),
      ],
      lenses: m.lenses.map(idName),
      groups: m.groups.map(idName),
      redFlags: m.red_flags.map(({ id, name, severity }) => ({ id, name, severity })),
      duties: m.duties.map(idName),
    },
  };
}

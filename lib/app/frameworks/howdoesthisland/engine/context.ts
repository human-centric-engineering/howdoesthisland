/**
 * Who a text is for, checked against the version it is scored with (t-24).
 *
 * The context's ids are the model's (content types, archetypes, exec roles,
 * audience modifiers and their options, countries), so it is checked here,
 * where the version is known, and not by a fixed schema in the API. The
 * engine trusts what this returns: an id the version lacks would throw part
 * way through a run (`must()` in `scoring.ts` and `prompts.ts`), after the
 * assessment was stored.
 *
 * Anything left out takes the prototype's `DEFAULT_CTX` (`engine.js`):
 * a `general` text for a `general` reader, a global culture. An audience
 * modifier the default does not name, or whose default option a version has
 * dropped, takes its first option, since every judge prompt names one option
 * for each modifier (`audienceText()`).
 *
 * An empty `role`, `reader` or `writer` means none, as the prototype sends it.
 *
 * With the culture switch off, `culture` is refused rather than ignored, as
 * the culture judge is (`activeJudgeSlots`), so a caller learns it is off.
 */
import { z } from 'zod';
import type { ContextParse } from '@/lib/app/frameworks/engine';
import type { EngineModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import type { EngineContext } from '@/lib/app/frameworks/howdoesthisland/engine/types';

/** `DEFAULT_CTX.audience` in the prototype's `engine.js`. */
const DEFAULT_AUDIENCE: Readonly<Record<string, string>> = {
  involvement: 'medium',
  awareness: 'problem_aware',
  relationship: 'warm',
  decision_unit: 'individual',
  focus: 'unknown',
  expertise: 'informed',
};

const DEFAULT_KIND = 'general';

/** The reader or writer culture that means no country in particular. */
export const GLOBAL_CULTURE = 'global';

/**
 * One of `ids`, read at run time. `orNone` also accepts `''`, which the
 * prototype sends for "none" (`role: ''`, `writer: ''`).
 */
function oneOf(ids: readonly string[], what: string, orNone = false): z.ZodType<string> {
  const allowed = new Set(orNone ? ['', ...ids] : ids);
  return z.string().refine((id) => allowed.has(id), { error: `Not a ${what} in this version` });
}

/** The schema for one version's context, with defaults applied. */
export function contextSchema(m: EngineModel, culture: boolean): z.ZodType<EngineContext> {
  const contentTypes = [...m.CT.keys()];
  const archetypes = [...m.ARCH.keys()];
  const audienceShape: Record<string, z.ZodType<string | undefined>> = {};
  for (const mod of m.MODS) {
    audienceShape[mod.id] = oneOf(
      mod.options.map((o) => o.id),
      `${mod.id} option`
    ).optional();
  }
  const country = oneOf([GLOBAL_CULTURE, ...m.COUNTRY.keys()], 'culture', true);

  return z
    .strictObject({
      contentType: oneOf(contentTypes, 'content type').optional(),
      archetype: oneOf(archetypes, 'archetype').optional(),
      role: oneOf([...m.ROLE.keys()], 'role', true).optional(),
      audience: z.strictObject(audienceShape).optional(),
      culture: culture
        ? z.strictObject({ reader: country.optional(), writer: country.optional() }).optional()
        : z.undefined({ error: 'The culture module is switched off' }).optional(),
    })
    .transform((input): EngineContext => {
      const audience: Record<string, string> = {};
      for (const mod of m.MODS) {
        const chosen = input.audience?.[mod.id];
        const fallback = DEFAULT_AUDIENCE[mod.id];
        audience[mod.id] =
          chosen ??
          (fallback && mod.options.some((o) => o.id === fallback)
            ? fallback
            : (mod.options[0]?.id ?? ''));
      }
      return {
        contentType:
          input.contentType ?? (m.CT.has(DEFAULT_KIND) ? DEFAULT_KIND : (contentTypes[0] ?? '')),
        archetype:
          input.archetype ?? (m.ARCH.has(DEFAULT_KIND) ? DEFAULT_KIND : (archetypes[0] ?? '')),
        ...(input.role ? { role: input.role } : {}),
        audience,
        ...(culture && input.culture ? { culture: input.culture } : {}),
      };
    });
}

/** Parse a caller's context (absent is `{}`), answering each problem by its path. */
export function parseContext(
  m: EngineModel,
  input: unknown,
  culture: boolean
): ContextParse<EngineContext> {
  const parsed = contextSchema(m, culture).safeParse(input ?? {});
  if (parsed.success) return { ok: true, ctx: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  };
}

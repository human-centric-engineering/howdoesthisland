/**
 * Turning a project's stored defaults into the form's pickers and back (t-71).
 *
 * The API stores `defaults` as given and checks it against the framework's
 * latest version (`lib/app/projects/service.ts`), so a picker left on "No
 * default" sends nothing for that field and the review takes the version's
 * own default. Pure, so it is tested without rendering the form.
 */
import { z } from 'zod';
import type { DefaultsCatalogue, ProjectWire } from '@/components/app/projects/schemas';
import {
  MAX_BRIEF_FIELD,
  MAX_PROJECT_NAME,
  type UpdateProjectBody,
} from '@/lib/app/projects/validations';

/** A picker's value for "no default". Never sent. */
export const NO_DEFAULT = '__none__';

/** `quick` and `full` are profiles the engine knows by name, beside the catalogue's groups. */
export const QUICK_PROFILE = 'quick';
export const FULL_PROFILE = 'full';

/**
 * The reviewer set that is only the culture reviewer. The engine refuses it
 * with the culture switch off, so it is offered only when the version serves
 * countries, as the culture pickers are.
 */
export const CULTURE_PROFILE = 'culture';

/**
 * The audience setting the engine leaves out, because it repeats the context's
 * own `archetype` (`MODS` in `engine/model.ts`, as the prototype's `engine.js`
 * does). The catalogue still lists it, and a default naming it is refused, so
 * the form offers the reader picker alone.
 */
export const REPEATED_MODIFIER = 'archetype';

/** The audience settings a default may name: the catalogue's, less {@link REPEATED_MODIFIER}. */
export function audienceSettings(
  catalogue: DefaultsCatalogue
): DefaultsCatalogue['request']['audience'] {
  return catalogue.request.audience.filter((m) => m.id !== REPEATED_MODIFIER);
}

/** The brief's parts, in the order the form shows them. */
export const BRIEF_KEYS = ['offer', 'audience', 'voice', 'markets', 'goals'] as const;
export type BriefKey = (typeof BRIEF_KEYS)[number];

const briefText = z
  .string()
  .max(MAX_BRIEF_FIELD, `Keep it under ${MAX_BRIEF_FIELD.toLocaleString('en-GB')} characters`);

export const projectFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the project a name')
    .max(MAX_PROJECT_NAME, `Keep it under ${MAX_PROJECT_NAME} characters`),
  offer: briefText,
  audience: briefText,
  voice: briefText,
  markets: briefText,
  goals: briefText,
  contentType: z.string(),
  archetype: z.string(),
  role: z.string(),
  /** Audience setting id → option id, or {@link NO_DEFAULT}. */
  modifiers: z.record(z.string(), z.string()),
  cultureReader: z.string(),
  cultureWriter: z.string(),
  profile: z.string(),
});

export type ProjectFormValues = z.infer<typeof projectFormSchema>;

const storedContext = z.object({
  contentType: z.string().optional(),
  archetype: z.string().optional(),
  role: z.string().optional(),
  audience: z.record(z.string(), z.string()).optional(),
  culture: z.object({ reader: z.string().optional(), writer: z.string().optional() }).optional(),
});

/** A stored id, or No default. `''` is the engine's own "none" for a role or a culture. */
const orNone = (value: string | undefined): string => (value ? value : NO_DEFAULT);

/**
 * Whether the pickers can read the project's stored context. When they cannot
 * (it was written through the API in another shape), every picker starts on
 * No default and the page says that saving replaces what is stored.
 */
export function storedContextReadable(project: ProjectWire): boolean {
  return storedContext.safeParse(project.defaults.context ?? {}).success;
}

/**
 * The form's starting values. Nothing stored is dropped unseen: an audience
 * setting the version no longer has keeps a picker of its own (the form shows
 * it, marked), so saving sends it back and the API says what it refuses. A
 * stored context the pickers cannot read starts every picker on No default
 * (see {@link storedContextReadable}).
 */
export function formValuesOf(
  project: ProjectWire,
  catalogue: DefaultsCatalogue
): ProjectFormValues {
  const parsed = storedContext.safeParse(project.defaults.context ?? {});
  const context = parsed.success ? parsed.data : {};
  return {
    name: project.name,
    offer: project.brief.offer ?? '',
    audience: project.brief.audience ?? '',
    voice: project.brief.voice ?? '',
    markets: project.brief.markets ?? '',
    goals: project.brief.goals ?? '',
    contentType: orNone(context.contentType),
    archetype: orNone(context.archetype),
    role: orNone(context.role),
    modifiers: {
      ...Object.fromEntries(
        Object.entries(context.audience ?? {}).map(([id, option]) => [id, orNone(option)])
      ),
      ...Object.fromEntries(
        audienceSettings(catalogue).map((m) => [m.id, orNone(context.audience?.[m.id])])
      ),
    },
    cultureReader: orNone(context.culture?.reader),
    cultureWriter: orNone(context.culture?.writer),
    profile: orNone(project.defaults.profile),
  };
}

const picked = (value: string): string | undefined => (value === NO_DEFAULT ? undefined : value);

/**
 * What `PATCH /api/v1/projects/{id}` is sent: the brief and defaults, each
 * whole. Culture is sent as the form holds it, switch or no: with the switch
 * off the form shows the culture pickers only when culture is stored, and the
 * API refuses it rather than this dropping it unseen.
 */
export function patchBodyOf(
  values: ProjectFormValues
): Required<Pick<UpdateProjectBody, 'name' | 'brief' | 'defaults'>> {
  const brief = Object.fromEntries(
    BRIEF_KEYS.flatMap((key) => {
      const text = values[key].trim();
      return text ? [[key, text]] : [];
    })
  );

  const audience = Object.fromEntries(
    Object.entries(values.modifiers).flatMap(([id, option]) => {
      const chosen = picked(option);
      return chosen ? [[id, chosen]] : [];
    })
  );
  const reader = picked(values.cultureReader);
  const writer = picked(values.cultureWriter);
  const contentType = picked(values.contentType);
  const archetype = picked(values.archetype);
  const role = picked(values.role);
  const context = {
    ...(contentType ? { contentType } : {}),
    ...(archetype ? { archetype } : {}),
    ...(role ? { role } : {}),
    ...(Object.keys(audience).length ? { audience } : {}),
    ...(reader || writer
      ? { culture: { ...(reader ? { reader } : {}), ...(writer ? { writer } : {}) } }
      : {}),
  };
  const profile = picked(values.profile);

  return {
    name: values.name.trim(),
    brief,
    defaults: {
      ...(Object.keys(context).length ? { context } : {}),
      ...(profile ? { profile } : {}),
    },
  };
}

/** One choice in a picker. */
export interface PickerOption {
  value: string;
  label: string;
}

/**
 * The AI reviewer sets the version offers, by the catalogue's names, between
 * the two the engine knows by name. The field's help says a set also runs
 * the four appeals.
 */
export function profileOptions(catalogue: DefaultsCatalogue): PickerOption[] {
  const cultureOn = catalogue.request.countries !== undefined;
  return [
    { value: QUICK_PROFILE, label: 'None: the quick scan only' },
    ...catalogue.result.profiles
      .filter((p) => cultureOn || p.id !== CULTURE_PROFILE)
      .map((p) => ({ value: p.id, label: p.name })),
    { value: FULL_PROFILE, label: 'All AI reviewers' },
  ];
}

/**
 * A picker's options, with a stored value the version no longer offers kept
 * so the form does not silently drop it. Saving it is then refused by the API
 * and says which default to change.
 */
export function withStored(options: PickerOption[], stored: string): PickerOption[] {
  if (stored === NO_DEFAULT || options.some((o) => o.value === stored)) return options;
  return [...options, { value: stored, label: `${stored} (not in this version)` }];
}

/**
 * The audience settings the form shows: the version's, then any stored one the
 * version no longer has, named by its id with only its stored option, so it
 * can be seen and set back to No default.
 */
export function audiencePickers(
  catalogue: DefaultsCatalogue,
  stored: Record<string, string>
): Array<{ id: string; name: string; options: PickerOption[] }> {
  const offered = audienceSettings(catalogue);
  const known = new Set(offered.map((m) => m.id));
  return [
    ...offered.map((m) => ({
      id: m.id,
      name: m.name,
      options: m.options.map((o) => ({ value: o.id, label: o.label })),
    })),
    ...Object.keys(stored)
      .filter((id) => !known.has(id))
      .map((id) => ({ id, name: `${id} (not in this version)`, options: [] })),
  ];
}

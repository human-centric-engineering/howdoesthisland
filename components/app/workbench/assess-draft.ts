/**
 * The `/assess` workbench's state and what it sends (t-78). Pure, so it is
 * tested without rendering the page.
 *
 * - The **draft** is what the page keeps in the browser (`useLocalStorage`):
 *   the text, the URL and the settings, never a file. Read back through
 *   {@link readDraft}, since storage is outside data: anything that does not
 *   parse starts a fresh draft.
 * - The **reader settings** are the project form's pickers
 *   (`project-defaults.ts`). Choosing a project fills them, and the profile,
 *   from its defaults; each can still be changed. A setting the project fixes
 *   offers no "model's default" choice, since the API would fill it from the
 *   project again (`mergeContext`): it can be changed to another value only.
 * - The **request** is `POST /api/v1/assessments`'s body: the context the
 *   pickers name (`contextOf`, as a project saves it), the project, and a
 *   profile or an explicit list of AI reviewers.
 * - **Comparing** (t-89) is the fourth source: 2–5 pasted drafts, each with
 *   an optional label, sent to `POST /api/v1/comparisons` with the same
 *   options, given once for every draft.
 */
import { z } from 'zod';
import { APIClientError } from '@/lib/api/client';
import {
  MAX_CONTENT_CHARS,
  MAX_REVIEW_FILE_BYTES,
  MAX_URL_CHARS,
} from '@/lib/app/assessments/limits';
import { DRAFT_LABEL_MAX, MAX_DRAFTS, MIN_DRAFTS } from '@/lib/app/comparisons/limits';
import { USAGE_PAGE } from '@/lib/app/usage/wire';
import { WORDS } from '@/lib/app/reports/words';
import {
  CULTURE_PROFILE,
  FULL_PROFILE,
  NO_DEFAULT,
  audienceSettings,
  contextOf,
  cultureOptions,
  formValuesOf,
  profileOptions,
  type PickerOption,
  type ReaderSettings,
} from '@/components/app/projects/project-defaults';
import type { ProjectWire } from '@/components/app/projects/schemas';
import type { AssessCatalogue } from '@/components/app/workbench/schemas';
import { HOWDOESTHISLAND_SLUG } from '@/lib/app/frameworks/howdoesthisland/slug';

/** Where the browser keeps the draft. Bump the version when its shape changes. */
export const DRAFT_KEY = 'howdoesthisland.assess.draft.v1';

export const SOURCES = ['text', 'file', 'url', 'compare'] as const;
export type Source = (typeof SOURCES)[number];

/** The profile picker's value for "choose the AI reviewers one by one". Never sent. */
export const CHOOSE_REVIEWERS = '__choose__';

/** No project: the picker's none value. Never sent. */
export const NO_PROJECT = NO_DEFAULT;

const settingsSchema = z.object({
  contentType: z.string(),
  archetype: z.string(),
  role: z.string(),
  modifiers: z.record(z.string(), z.string()),
  cultureReader: z.string(),
  cultureWriter: z.string(),
});

/** One draft of a comparison, as the page keeps it: the label empty when none is given. */
export interface CompareDraft {
  label: string;
  text: string;
}

const NO_COMPARE_DRAFT: CompareDraft = { label: '', text: '' };

/** A comparison starts with the fewest drafts it takes, each empty. */
export const EMPTY_COMPARE: CompareDraft[] = Array.from({ length: MIN_DRAFTS }, () => ({
  ...NO_COMPARE_DRAFT,
}));

export const draftSchema = z.object({
  source: z.enum(SOURCES),
  // Not capped: a draft over a cap would fail to read back and empty the
  // field. Too long is what `problemsOf` reports, before anything is sent.
  text: z.string(),
  url: z.string(),
  projectId: z.string().max(64),
  settings: settingsSchema,
  /** A profile id, or {@link CHOOSE_REVIEWERS}. */
  profile: z.string().max(64),
  /** The AI reviewers ticked, by slot, when choosing them one by one. */
  judges: z.array(z.string().max(64)).max(32),
  /**
   * The drafts to compare (t-89). A draft kept before comparing existed has
   * none, and one stored out of shape is started again, without losing the
   * rest of the draft.
   */
  drafts: z
    .array(z.object({ label: z.string(), text: z.string() }))
    .min(MIN_DRAFTS)
    .max(MAX_DRAFTS)
    .catch(() => EMPTY_COMPARE.map((d) => ({ ...d }))),
});

export type Draft = z.infer<typeof draftSchema>;

const NO_SETTINGS: ReaderSettings = {
  contentType: NO_DEFAULT,
  archetype: NO_DEFAULT,
  role: NO_DEFAULT,
  modifiers: {},
  cultureReader: NO_DEFAULT,
  cultureWriter: NO_DEFAULT,
};

export const EMPTY_DRAFT: Draft = {
  source: 'text',
  text: '',
  url: '',
  projectId: NO_PROJECT,
  settings: NO_SETTINGS,
  profile: FULL_PROFILE,
  judges: [],
  drafts: EMPTY_COMPARE,
};

/** The stored draft, or a fresh one when nothing usable is stored. */
export function readDraft(stored: unknown): Draft {
  const parsed = draftSchema.safeParse(stored);
  return parsed.success ? parsed.data : EMPTY_DRAFT;
}

/** The reader settings and profile a project's defaults give, or the model's own with none. */
export function defaultsOf(
  project: ProjectWire | null,
  catalogue: AssessCatalogue
): Pick<Draft, 'settings' | 'profile' | 'judges'> {
  if (!project) return { settings: NO_SETTINGS, profile: FULL_PROFILE, judges: [] };
  const v = formValuesOf(project, catalogue);
  return {
    settings: {
      contentType: v.contentType,
      archetype: v.archetype,
      role: v.role,
      modifiers: Object.fromEntries(
        Object.entries(v.modifiers).filter(([, option]) => option !== NO_DEFAULT)
      ),
      cultureReader: v.cultureReader,
      cultureWriter: v.cultureWriter,
    },
    profile: v.profile === NO_DEFAULT ? FULL_PROFILE : v.profile,
    judges: [],
  };
}

/** A settings field, as `fixedByProject` names it: a picker's key, or `modifiers.<id>`. */
export type SettingKey = Exclude<keyof ReaderSettings, 'modifiers'> | `modifiers.${string}`;

/**
 * The settings the project fixes: each offers no "model's default" choice,
 * because leaving it out of the request has the API fill it from the project.
 */
export function fixedByProject(
  project: ProjectWire | null,
  catalogue: AssessCatalogue
): ReadonlySet<SettingKey> {
  if (!project) return new Set();
  const { settings } = defaultsOf(project, catalogue);
  const fixed = new Set<SettingKey>();
  for (const key of [
    'contentType',
    'archetype',
    'role',
    'cultureReader',
    'cultureWriter',
  ] as const) {
    if (settings[key] !== NO_DEFAULT) fixed.add(key);
  }
  for (const id of Object.keys(settings.modifiers)) fixed.add(`modifiers.${id}`);
  return fixed;
}

/**
 * The draft's settings as a review in the project runs them: a setting the
 * project fixes that the draft leaves to the model's default is the
 * project's, since the API fills it from the project (`mergeContext`). A
 * draft kept from before the project's defaults changed can hold one.
 */
export function settingsInProject(
  settings: ReaderSettings,
  project: ProjectWire | null,
  catalogue: AssessCatalogue
): ReaderSettings {
  if (!project) return settings;
  const own = defaultsOf(project, catalogue).settings;
  const pick = (key: Exclude<keyof ReaderSettings, 'modifiers'>) =>
    settings[key] === NO_DEFAULT ? own[key] : settings[key];
  return {
    contentType: pick('contentType'),
    archetype: pick('archetype'),
    role: pick('role'),
    modifiers: { ...own.modifiers, ...settings.modifiers },
    cultureReader: pick('cultureReader'),
    cultureWriter: pick('cultureWriter'),
  };
}

/**
 * The project's defaults this version refuses: a value it no longer offers,
 * an audience setting it no longer has (or the one the reader sets), or a
 * culture with the culture switch off. The API fills each into every review
 * in the project (`mergeContext`), and nothing sent can take it out, so the
 * project's own page is the only place to fix them. By picker label.
 */
export function staleDefaultsOf(project: ProjectWire | null, catalogue: AssessCatalogue): string[] {
  if (!project) return [];
  const { settings } = defaultsOf(project, catalogue);
  const { request } = catalogue;
  const stale: string[] = [];
  const offered = (value: string, ids: Array<{ id: string }>) =>
    value === NO_DEFAULT || ids.some((x) => x.id === value);
  if (!offered(settings.contentType, request.contentTypes)) stale.push(WORDS.TypeOfCopy);
  if (!offered(settings.archetype, request.archetypes)) stale.push('Reader');
  if (!offered(settings.role, request.roles)) stale.push('Reader’s role');
  const audience = audienceSettings(catalogue);
  for (const [id, option] of Object.entries(settings.modifiers)) {
    const setting = audience.find((m) => m.id === id);
    if (!setting?.options.some((o) => o.id === option)) stale.push(setting?.name ?? id);
  }
  const countries = cultureOptions(catalogue);
  const cultureOk = (value: string) =>
    value === NO_DEFAULT ||
    (request.countries !== undefined && countries.some((c) => c.value === value));
  if (!cultureOk(settings.cultureReader)) stale.push('Reader’s culture');
  if (!cultureOk(settings.cultureWriter)) stale.push('Writer’s culture');
  return stale;
}

/** The profile picker's choices: the project form's, then choosing the AI reviewers one by one. */
export function reviewerSetOptions(catalogue: AssessCatalogue): PickerOption[] {
  return [
    ...profileOptions(catalogue),
    { value: CHOOSE_REVIEWERS, label: `Choose the ${WORDS.aiReviewers} one by one` },
  ];
}

/**
 * The name an AI reviewer goes by: the appeal or group it covers, else the
 * reviewer set of that id (`lenses`, `influence`), else its slot.
 */
export function reviewerName(catalogue: AssessCatalogue, slot: string): string {
  const { result } = catalogue;
  const covers = result.reviewers.find((r) => r.id === slot)?.covers ?? slot;
  return (
    result.appeals.find((a) => a.id === covers)?.name ??
    result.groups.find((g) => g.id === covers)?.name ??
    result.profiles.find((p) => p.id === covers)?.name ??
    covers
  );
}

/**
 * The AI reviewers that can be ticked one by one: the version's, less the
 * culture reviewer when the version serves no countries (the culture switch
 * off), which the API refuses.
 */
export function choosableReviewers(
  catalogue: AssessCatalogue
): Array<{ slot: string; name: string }> {
  const cultureOn = catalogue.request.countries !== undefined;
  return catalogue.result.reviewers
    .filter((r) => cultureOn || r.covers !== CULTURE_PROFILE)
    .map((r) => ({ slot: r.id, name: reviewerName(catalogue, r.id) }));
}

/**
 * The ticked AI reviewers the version still offers. A restored draft can name
 * one it no longer does (a slot dropped, or culture switched off), which has
 * no box to untick and which the API refuses.
 */
export function tickedReviewers(draft: Draft, catalogue: AssessCatalogue): string[] {
  const offered = new Set(choosableReviewers(catalogue).map((r) => r.slot));
  return draft.judges.filter((slot) => offered.has(slot));
}

/** What the page checks before sending: each problem, by the input it is about. */
export function problemsOf(
  draft: Draft,
  file: File | null,
  catalogue: AssessCatalogue,
  project: ProjectWire | null
): Array<{ field: string; message: string }> {
  const problems: Array<{ field: string; message: string }> = [];
  if (staleDefaultsOf(project, catalogue).length > 0) {
    problems.push({
      field: 'assess-project',
      message: `This project’s defaults need fixing on its own page before a ${WORDS.review} in it can start.`,
    });
  }
  if (draft.source === 'text') {
    // Counted as the API counts it: the text as sent, untrimmed, in code points.
    const length = [...draft.text].length;
    if (draft.text.trim() === '')
      problems.push({ field: 'assess-text', message: 'Paste some copy to review.' });
    else if (length > MAX_CONTENT_CHARS) {
      problems.push({
        field: 'assess-text',
        message: `That’s over ${MAX_CONTENT_CHARS.toLocaleString('en-GB')} characters. Review a shorter piece.`,
      });
    }
  }
  if (draft.source === 'url') {
    const url = draft.url.trim();
    if (url.length > MAX_URL_CHARS) {
      problems.push({
        field: 'assess-url',
        message: `That address is over ${MAX_URL_CHARS.toLocaleString('en-GB')} characters. Leave off what follows the page’s own address, such as tracking after a ?`,
      });
    } else if (!z.url({ protocol: /^https?$/ }).safeParse(url).success) {
      problems.push({
        field: 'assess-url',
        message: 'Give the page’s full address, starting https://',
      });
    }
  }
  if (draft.source === 'file') {
    if (!file) problems.push({ field: 'assess-file', message: 'Choose a file to review.' });
    else if (file.size > MAX_REVIEW_FILE_BYTES) {
      problems.push({
        field: 'assess-file',
        message: `${file.name} is ${(file.size / 1_048_576).toFixed(1)} MB; the largest a ${WORDS.review} reads is ${MAX_REVIEW_FILE_BYTES / 1_048_576} MB. Paste its text instead.`,
      });
    }
  }
  if (draft.source === 'compare') {
    for (const [i, d] of draft.drafts.entries()) {
      const name = d.label.trim() || `Draft ${i + 1}`;
      if (d.text.trim() === '') {
        problems.push({ field: `compare-text-${i}`, message: `Paste the copy for ${name}.` });
      } else if ([...d.text].length > MAX_CONTENT_CHARS) {
        problems.push({
          field: `compare-text-${i}`,
          message: `${name} is over ${MAX_CONTENT_CHARS.toLocaleString('en-GB')} characters. Compare shorter pieces.`,
        });
      }
      if (d.label.trim().length > DRAFT_LABEL_MAX) {
        problems.push({
          field: `compare-label-${i}`,
          message: `Keep ${name}’s name to ${DRAFT_LABEL_MAX} characters.`,
        });
      }
    }
  }
  if (
    draft.profile !== CHOOSE_REVIEWERS &&
    !profileOptions(catalogue).some((o) => o.value === draft.profile)
  ) {
    problems.push({
      field: 'assess-profile',
      message: `This version of the model has no ${WORDS.aiReviewers} set “${draft.profile}”. Pick one it offers.`,
    });
  }
  if (draft.profile === CHOOSE_REVIEWERS && tickedReviewers(draft, catalogue).length === 0) {
    problems.push({
      field: 'assess-reviewers',
      message: 'Tick at least one AI reviewer, or pick a set of them.',
    });
  }
  return problems;
}

/**
 * `POST /api/v1/assessments`'s fields for the draft but its source, once
 * {@link problemsOf} finds none: the JSON body beside {@link jsonSourceOf},
 * or a file upload's `options` part (t-80). It names the `version` the page's catalogue is, so the review
 * runs on the version whose settings and reviewers were offered, not on one
 * published since the page was opened.
 */
export function requestOptionsOf(
  draft: Draft,
  catalogue: AssessCatalogue,
  version: string
): Record<string, unknown> {
  const context = contextOf(draft.settings);
  return {
    framework: HOWDOESTHISLAND_SLUG,
    version,
    ...(Object.keys(context).length ? { context } : {}),
    ...(draft.projectId !== NO_PROJECT ? { projectId: draft.projectId } : {}),
    ...(draft.profile === CHOOSE_REVIEWERS
      ? { judges: tickedReviewers(draft, catalogue) }
      : { profile: draft.profile }),
  };
}

/** A text or page draft's `source`, as the JSON body takes it; `null` for a file, which is uploaded. */
export function jsonSourceOf(draft: Draft): { text: string } | { url: string } | null {
  if (draft.source === 'text') return { text: draft.text };
  if (draft.source === 'url') return { url: draft.url.trim() };
  return null;
}

/**
 * `POST /api/v1/comparisons`'s `drafts`, once {@link problemsOf} finds none:
 * each draft's text as pasted, and its label when it has one.
 */
export function comparisonDraftsOf(draft: Draft): Array<{ text: string; label?: string }> {
  return draft.drafts.map((d) => {
    const label = d.label.trim();
    return label ? { text: d.text, label } : { text: d.text };
  });
}

/** A refusal, in words a person can act on, and the usage page when it points there. */
export interface Refusal {
  message: string;
  usagePage: string | null;
}

/** A path on this site: one leading slash, never `//host`, which a browser reads as another site. */
const usageDetails = z.object({ usagePage: z.string().regex(/^\/(?!\/)/) });

/**
 * The refusals the page words itself; `null` for the rest, whose server
 * message already says what to do (the intake codes: a file too large, a
 * page that could not be fetched, too much text).
 *
 * - 402 `INSUFFICIENT_CREDITS` / `BUDGET_EXCEEDED`: the server's message
 *   says why and what to do; the usage page it names becomes a link.
 * - 429 `WORKSPACE_BUSY` / `RATE_LIMIT_EXCEEDED`: wait and try again.
 */
export function refusalOf(err: unknown): Refusal | null {
  if (!(err instanceof APIClientError)) return null;
  switch (err.code) {
    case 'INSUFFICIENT_CREDITS':
    case 'BUDGET_EXCEEDED': {
      const details = usageDetails.safeParse(err.details);
      return {
        message: err.message,
        usagePage: details.success ? details.data.usagePage : USAGE_PAGE,
      };
    }
    case 'FRAMEWORK_VERSION_NOT_FOUND':
      return {
        message:
          'The model has been updated since this page was opened. Reload the page to review with the new version; your draft is kept.',
        usagePage: null,
      };
    case 'WORKSPACE_BUSY':
      return {
        message:
          'Your workspace already has as many reviews running as it can. Try again when one has finished.',
        usagePage: null,
      };
    case 'RATE_LIMIT_EXCEEDED':
      return {
        message:
          'You have started a lot of reviews in the last minute. Wait a minute, then try again.',
        usagePage: null,
      };
    default:
      return null;
  }
}

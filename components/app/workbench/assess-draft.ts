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
 */
import { z } from 'zod';
import { APIClientError } from '@/lib/api/client';
import { MAX_CONTENT_CHARS, MAX_REVIEW_FILE_BYTES } from '@/lib/app/assessments/limits';
import { USAGE_PAGE } from '@/lib/app/usage/wire';
import { WORDS } from '@/lib/app/reports/words';
import {
  CULTURE_PROFILE,
  FULL_PROFILE,
  NO_DEFAULT,
  contextOf,
  formValuesOf,
  profileOptions,
  type PickerOption,
  type ReaderSettings,
} from '@/components/app/projects/project-defaults';
import type { ProjectWire } from '@/components/app/projects/schemas';
import type { AssessCatalogue } from '@/components/app/workbench/schemas';

/** Where the browser keeps the draft. Bump the version when its shape changes. */
export const DRAFT_KEY = 'howdoesthisland.assess.draft.v1';

export const SOURCES = ['text', 'file', 'url'] as const;
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

export const draftSchema = z.object({
  source: z.enum(SOURCES),
  text: z.string().max(MAX_CONTENT_CHARS * 2),
  url: z.string().max(2048),
  projectId: z.string().max(64),
  settings: settingsSchema,
  /** A profile id, or {@link CHOOSE_REVIEWERS}. */
  profile: z.string().max(64),
  /** The AI reviewers ticked, by slot, when choosing them one by one. */
  judges: z.array(z.string().max(64)).max(32),
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

/** A file chosen for review, read as the API takes it. */
export interface ChosenFile {
  name: string;
  base64: string;
}

/** What the page checks before sending: each problem, by the input it is about. */
export function problemsOf(
  draft: Draft,
  file: File | null
): Array<{ field: string; message: string }> {
  const problems: Array<{ field: string; message: string }> = [];
  if (draft.source === 'text') {
    const length = [...draft.text.trim()].length;
    if (length === 0)
      problems.push({ field: 'assess-text', message: 'Paste some copy to review.' });
    else if (length > MAX_CONTENT_CHARS) {
      problems.push({
        field: 'assess-text',
        message: `That’s over ${MAX_CONTENT_CHARS.toLocaleString('en-GB')} characters. Review a shorter piece.`,
      });
    }
  }
  if (draft.source === 'url') {
    const ok = z.url({ protocol: /^https?$/ }).safeParse(draft.url.trim()).success;
    if (!ok) {
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
        message: `${file.name} is ${(file.size / 1_048_576).toFixed(1)} MB; the largest we read is ${MAX_REVIEW_FILE_BYTES / 1_048_576} MB.`,
      });
    }
  }
  if (draft.profile === CHOOSE_REVIEWERS && draft.judges.length === 0) {
    problems.push({
      field: 'assess-reviewers',
      message: 'Tick at least one AI reviewer, or pick a set of them.',
    });
  }
  return problems;
}

/** `POST /api/v1/assessments`'s body for the draft, once {@link problemsOf} finds none. */
export function requestBodyOf(draft: Draft, file: ChosenFile | null): Record<string, unknown> {
  const source =
    draft.source === 'text'
      ? { text: draft.text }
      : draft.source === 'url'
        ? { url: draft.url.trim() }
        : { file };
  const context = contextOf(draft.settings);
  return {
    source,
    ...(Object.keys(context).length ? { context } : {}),
    ...(draft.projectId !== NO_PROJECT ? { projectId: draft.projectId } : {}),
    ...(draft.profile === CHOOSE_REVIEWERS ? { judges: draft.judges } : { profile: draft.profile }),
  };
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

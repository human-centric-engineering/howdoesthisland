/**
 * What the `projects` routes accept (t-70, f-projects).
 *
 * The route registry (`lib/app/api/registry.ts`) imports these, so the
 * contract is the schema the handlers parse with. `defaults.context` is open
 * JSON here, as an assessment's `context` is: its ids are the framework
 * version's, so the service checks it against the version
 * (`lib/app/projects/service.ts`).
 */
import { z } from 'zod';
import type { UploadedFile } from '@/lib/app/intake/upload';
import { slugParam } from '@/lib/app/frameworks/api/validations';

/** The longest a project's name may be. */
export const MAX_PROJECT_NAME = 120;

/** The longest one part of a brief may be. */
export const MAX_BRIEF_FIELD = 2000;

const briefField = z.string().trim().max(MAX_BRIEF_FIELD).optional();

/**
 * The brief, in the author's own words: what the copy is for. Every part is
 * optional, and the AI reviewers are told it is the author's description,
 * never instructions (D21).
 */
export const briefSchema = z.strictObject({
  /** What you offer: the product, service or idea the copy sells. */
  offer: briefField,
  /** Who it is for: the reader, in the author's words. */
  audience: briefField,
  /** Tone of voice: how the brand or author sounds. */
  voice: briefField,
  /** Where it runs: countries, regions or markets. */
  markets: briefField,
  /** What the copy must achieve. */
  goals: briefField,
});

export type Brief = z.infer<typeof briefSchema>;

/**
 * What a review in the project takes when its request leaves it out: who the
 * copy is for (`context`, as `POST /api/v1/assessments` takes it) and the
 * profile. Stored as given, so what it leaves out takes the version's own
 * defaults.
 */
export const projectDefaultsSchema = z.strictObject({
  context: z.record(z.string(), z.unknown()).optional(),
  /** `quick`, `full` or one of the version's catalogue groups. */
  profile: z.string().trim().min(1).max(64).optional(),
});

export type ProjectDefaults = z.infer<typeof projectDefaultsSchema>;

/**
 * A project's adjustment to its framework's weights (t-72): open JSON here,
 * as `defaults.context` is, since what it may hold and how far are the
 * version's (`lib/app/projects/overlay.ts`). Null clears it.
 */
export const overlayInputSchema = z.record(z.string(), z.unknown()).nullable();

const nameField = z.string().trim().min(1, 'Give the project a name').max(MAX_PROJECT_NAME);

/** POST /api/v1/projects. */
export const createProjectSchema = z.strictObject({
  name: nameField,
  brief: briefSchema.optional(),
  defaults: projectDefaultsSchema.optional(),
  /** The framework its reviews are scored with; HowDoesThisLand's by default. */
  framework: slugParam.optional(),
  /**
   * Its adjustment to the framework's weights (t-72), checked against the
   * bounds the latest version declares. Left out or null, none.
   */
  overlay: overlayInputSchema.optional(),
});

export type CreateProjectBody = z.infer<typeof createProjectSchema>;

/**
 * PATCH /api/v1/projects/{id}. `brief`, `defaults` and `overlay` replace what
 * is there whole; `overlay: null` clears it. `archived: false` restores an
 * archived project. The framework is fixed once made, because the defaults
 * are checked against it.
 */
export const updateProjectSchema = z
  .strictObject({
    name: nameField.optional(),
    brief: briefSchema.optional(),
    defaults: projectDefaultsSchema.optional(),
    overlay: overlayInputSchema.optional(),
    archived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { error: 'Nothing to change' });

export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;

/** GET /api/v1/projects. */
export const listProjectsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** `true` lists archived projects too. */
  archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

/** `{id}` in `/api/v1/projects/{id}`. */
export const projectIdParamSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * The largest context document file, in bytes: intake's own default. Named
 * here rather than imported from intake, because this module reaches client
 * components (through `wire.ts`) and intake carries the file parsers.
 */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** The longest a document's title may be. */
export const MAX_DOCUMENT_TITLE = 200;

/**
 * Where a context document comes from (t-74), as JSON: a page by URL, as a
 * review's source may be (`assessmentSourceSchema`). A file is sent as
 * `multipart/form-data` instead (t-80, `lib/app/intake/upload.ts`).
 */
export const documentSourceSchema = z.strictObject(
  { url: z.url({ protocol: /^https?$/ }).max(2048) },
  {
    error: 'Give source as { url }; send a file as multipart/form-data, in a `file` part',
  }
);

const documentOptionsShape = {
  /** The name the project shows it by; the document's own title when left out. */
  title: z.string().trim().min(1).max(MAX_DOCUMENT_TITLE).optional(),
};

/** POST /api/v1/projects/{id}/documents, as JSON: a page. */
export const addDocumentSchema = z.strictObject({
  source: documentSourceSchema,
  ...documentOptionsShape,
});

/**
 * POST /api/v1/projects/{id}/documents, as `multipart/form-data` (t-80): the
 * `options` part, every field of the JSON body but `source`, whose place the
 * `file` part takes.
 */
export const documentUploadOptionsSchema = z.strictObject(documentOptionsShape);

export type AddDocumentBody = z.infer<typeof addDocumentSchema>;

/** What the service adds: a JSON body, or an upload's options with its file as the source. */
export type AddDocumentRequest = Omit<AddDocumentBody, 'source'> & {
  source: AddDocumentBody['source'] | { file: UploadedFile };
};

/** `{id}` and `{documentId}` in `/api/v1/projects/{id}/documents/{documentId}`. */
export const projectDocumentParamSchema = z.object({
  id: z.string().min(1).max(64),
  documentId: z.string().min(1).max(64),
});

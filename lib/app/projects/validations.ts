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

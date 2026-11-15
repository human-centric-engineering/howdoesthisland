/**
 * What the `scan` and `assessments` routes accept (t-24).
 *
 * The route registry (`lib/app/api/registry.ts`) imports these, so the
 * contract is the schema the handler parses with. `context` is open JSON
 * here: its ids are the framework version's, so it is checked against the
 * version once that is known (`engine.parseContext`).
 */
import { z } from 'zod';
import { slugParam, versionParam } from '@/lib/app/frameworks/api/validations';
import { DEFAULT_INTAKE_LIMITS } from '@/lib/app/intake/extract-text';
import { MAX_CONTENT_CHARS } from '@/lib/app/assessments/limits';

/**
 * Pasted text. The precise limit ({@link MAX_CONTENT_CHARS} code points) is
 * checked with its own message once parsed (`assessableText`); this bound
 * only stops a body far past it from being held as a string any longer.
 */
const textField = z.string().max(MAX_CONTENT_CHARS * 2);

/** The framework and version to score against; both default (`versionToScore`). */
const versionChoice = {
  framework: slugParam.optional(),
  version: versionParam.optional(),
};

/** Who the text is for, checked against the version's ids before anything runs. */
const contextField = z.record(z.string(), z.unknown()).optional();

/** POST /api/v1/scan: pasted text only (D7, D14). */
export const scanRequestSchema = z.strictObject({
  text: textField,
  ...versionChoice,
  context: contextField,
});

/** The largest upload, as base64: four characters per three bytes. */
const MAX_FILE_BASE64 = Math.ceil(DEFAULT_INTAKE_LIMITS.maxBytes / 3) * 4;

/** Exactly one of: pasted text, a page by URL (D14), or a file to read. */
export const assessmentSourceSchema = z.union([
  z.strictObject({ text: textField }),
  z.strictObject({ url: z.url({ protocol: /^https?$/ }).max(2048) }),
  z.strictObject({
    file: z.strictObject({
      /** The file's name; its extension picks the reader (`extractText`). */
      name: z.string().trim().min(1).max(255),
      base64: z.base64().max(MAX_FILE_BASE64),
    }),
  }),
]);

/** POST /api/v1/assessments. */
export const createAssessmentSchema = z
  .strictObject({
    source: assessmentSourceSchema,
    title: z.string().trim().min(1).max(200).optional(),
    ...versionChoice,
    context: contextField,
    /** `quick`, `full` (the default) or one of the version's catalogue groups. */
    profile: z.string().trim().min(1).max(64).optional(),
    /** An explicit list of judge slots, in place of a profile. */
    judges: z.array(z.string().trim().min(1).max(64)).min(1).max(32).optional(),
    /** Answer with the result, or with 202 once the wait bound passes. */
    wait: z.boolean().optional(),
    /** `false` keeps nothing but the cost record; it is always synchronous. */
    store: z.boolean().optional(),
  })
  .refine((body) => !(body.profile !== undefined && body.judges !== undefined), {
    error: 'Give a profile or a list of judges, not both',
    path: ['judges'],
  })
  .refine((body) => !(body.store === false && body.wait === false), {
    error: 'An assessment that is not stored is always waited for: leave out wait, or set it true',
    path: ['wait'],
  });

export type CreateAssessmentBody = z.infer<typeof createAssessmentSchema>;

/** The states, as the API names them. */
export const ASSESSMENT_STATES = [
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const;

export type AssessmentState = (typeof ASSESSMENT_STATES)[number];

/** GET /api/v1/assessments. */
export const listAssessmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(ASSESSMENT_STATES).optional(),
});

/** `{id}` in `/api/v1/assessments/{id}`. */
export const assessmentIdParamSchema = z.object({ id: z.string().min(1).max(64) });

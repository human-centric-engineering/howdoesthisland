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
import { BAND_LABEL_MAX } from '@/lib/app/frameworks/howdoesthisland/schemas';
import type { UploadedFile } from '@/lib/app/intake/upload';
import { MAX_CONTENT_CHARS, MAX_URL_CHARS } from '@/lib/app/assessments/limits';
import { MAX_TYPED_CODE } from '@/lib/app/credits/codes/wire';

/**
 * Pasted text. The precise limit ({@link MAX_CONTENT_CHARS} code points) is
 * checked with its own message once parsed (`assessableText`); this bound
 * only stops a body far past it from being held as a string any longer.
 */
export const textField = z.string().max(MAX_CONTENT_CHARS * 2);

/** The framework and version to score against; both default (`versionToScore`). */
export const versionChoice = {
  framework: slugParam.optional(),
  version: versionParam.optional(),
};

/** Who the text is for, checked against the version's ids before anything runs. */
export const contextField = z.record(z.string(), z.unknown()).optional();

/**
 * POST /api/v1/scan: pasted text only (D7, D14). `code` is accepted and
 * ignored (t-68): the quick scan is open to anyone, and a free review code is
 * for a full review. Kept so a caller built for t-61 is not refused.
 */
export const scanRequestSchema = z.strictObject({
  text: textField,
  ...versionChoice,
  context: contextField,
  code: z.string().max(MAX_TYPED_CODE, `${MAX_TYPED_CODE} characters at most`).optional(),
});

/**
 * Exactly one of: pasted text or a page by URL (D14). A file is sent as
 * `multipart/form-data` instead (t-80, `lib/app/intake/upload.ts`), so it
 * travels as its own bytes rather than as base64 the proxy would cut short.
 */
export const assessmentSourceSchema = z.union(
  [
    z.strictObject({ text: textField }),
    z.strictObject({ url: z.url({ protocol: /^https?$/ }).max(MAX_URL_CHARS) }),
  ],
  {
    error:
      'Give source as { text } or { url }; send a file as multipart/form-data, in a `file` part',
  }
);

/** Every field of the request but its source. */
const optionsShape = {
  title: z.string().trim().min(1).max(200).optional(),
  ...versionChoice,
  context: contextField,
  /**
   * The workspace's project to review it in (t-70). Its defaults fill what
   * `context` and `profile` leave out, and it is recorded on the review.
   */
  projectId: z.string().min(1).max(64).optional(),
  /** `quick`, `full` (the default) or one of the version's catalogue groups. */
  profile: z.string().trim().min(1).max(64).optional(),
  /** An explicit list of judge slots, in place of a profile. */
  judges: z.array(z.string().trim().min(1).max(64)).min(1).max(32).optional(),
  /** Answer with the result, or with 202 once the wait bound passes. */
  wait: z.boolean().optional(),
  /** `false` keeps nothing but the cost record; it is always synchronous. */
  store: z.boolean().optional(),
};

/** The rules across fields, the same for a JSON body and a multipart upload's options. */
function withRules<
  T extends z.ZodType<{ profile?: string; judges?: string[]; store?: boolean; wait?: boolean }>,
>(schema: T) {
  return schema
    .refine((body) => !(body.profile !== undefined && body.judges !== undefined), {
      error: 'Give a profile or a list of judges, not both',
      path: ['judges'],
    })
    .refine((body) => !(body.store === false && body.wait === false), {
      error:
        'An assessment that is not stored is always waited for: leave out wait, or set it true',
      path: ['wait'],
    });
}

/** POST /api/v1/assessments, as JSON: text or a page. */
export const createAssessmentSchema = withRules(
  z.strictObject({ source: assessmentSourceSchema, ...optionsShape })
);

/**
 * POST /api/v1/assessments, as `multipart/form-data` (t-80): the `options`
 * part, every field of the JSON body but `source`, whose place the `file`
 * part takes.
 */
export const assessmentUploadOptionsSchema = withRules(z.strictObject(optionsShape));

export type CreateAssessmentBody = z.infer<typeof createAssessmentSchema>;

/**
 * What the service assesses: a JSON body, or an upload's options with the
 * file it read (`readUpload`) as its source.
 */
export type AssessmentRequest = Omit<CreateAssessmentBody, 'source'> & {
  source: CreateAssessmentBody['source'] | { file: UploadedFile };
};

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
  /** Only the reviews in this project (t-70). */
  projectId: z.string().min(1).max(64).optional(),
  /** Only the reviews of this content type (t-79): an id of the version's catalogue. */
  contentType: z.string().min(1).max(64).optional(),
  /** Only the reviews in this band (t-79): its label, as `band` carries it. */
  band: z.string().min(1).max(BAND_LABEL_MAX).optional(),
});

/** `{id}` in `/api/v1/assessments/{id}`. */
export const assessmentIdParamSchema = z.object({ id: z.string().min(1).max(64) });

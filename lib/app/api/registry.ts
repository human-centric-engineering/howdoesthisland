/**
 * The app's API contract: every route this fork serves under `/api/v1/`
 * (t-23, D12).
 *
 * The API is the product, so its contract is written down here rather than
 * read off the handlers. Each entry gives a route's method, path, request and
 * response Zod schemas, who may call it, and a one-line summary.
 * `lib/app/api/openapi.ts` publishes it as OpenAPI 3.1 at
 * `GET /api/v1/openapi.json` (t-44).
 *
 * **Request schemas are the handlers' own.** Each one is imported from where
 * its handler (or the service behind it) parses with it, never restated, so
 * the contract cannot drift from what is enforced. The one assembly done here
 * is wrapping the framework routes' per-segment schemas, which their service
 * checks one at a time, into a `params` object. Response schemas describe
 * the `data` (and `meta`) of the success envelope on the wire, where a `Date`
 * is an ISO string. Where a service returns the value, a type test
 * (`tests/unit/lib/app/api/registry.test.ts`) holds the schema against that
 * type; the two bodies a handler builds inline (`invitationSentSchema` and the
 * decline's `{ declined: true }`) are checked by reading the handler.
 *
 * **Which routes are the app's:** the route directories this fork added under
 * `app/api/v1/`, listed in that test beside core's, so a directory in neither
 * list fails it. Core's routes are not ours to declare. The same test fails
 * when a route file exports a method this registry does not declare, or this
 * registry declares one no file exports.
 *
 * Errors are not declared per route: every route answers the standard error
 * envelope, and its docblock lists the codes. The exception is `errors`: a
 * refusal with a status of its own that a caller has to plan for (402
 * `INSUFFICIENT_CREDITS`, t-58, and `BUDGET_EXCEEDED`, t-49), which the
 * OpenAPI document then lists.
 */
import { z } from 'zod';
import {
  calibrationRunParamsSchema,
  startCalibrationRunSchema,
} from '@/lib/app/calibration/validations';
import { frameworkCalibrationSchema, startedRunSchema } from '@/lib/app/calibration/wire';
import { orgIdParamSchema } from '@/lib/validations/tenancy';
import { ORG_OWNER_ROLE, ORG_ROLES } from '@/lib/tenancy/roles';
import { kindParam, slugParam, versionParam } from '@/lib/app/frameworks/api/validations';
import { JUDGE_ROLES } from '@/lib/app/judges/approved-models';
import { chooseJudgeModelSchema, judgeModelParamsSchema } from '@/lib/app/judges/validations';
import {
  ASSESSMENT_STATES,
  assessmentIdParamSchema,
  createAssessmentSchema,
  listAssessmentsQuerySchema,
  scanRequestSchema,
} from '@/lib/app/assessments/api/validations';
import { ASSESS_SCOPE, REPORTS_SCOPE } from '@/lib/app/assessments/api/route-auth';
import { PROJECTS_SCOPE } from '@/lib/app/projects/route-auth';
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParamSchema,
  updateProjectSchema,
} from '@/lib/app/projects/validations';
import { projectSchema } from '@/lib/app/projects/wire';
import { isQuickScanEnabled } from '@/lib/app/quick-scan/switch';
import { quickScanSummarySchema } from '@/lib/app/quick-scan/summary';
import {
  appRetentionSchema,
  judgeReplyRetentionSchema,
  updateWorkspaceSettingsSchema,
} from '@/lib/app/retention/settings';
import {
  createdReportShareSchema,
  createShareSchema,
  reportShareSchema,
  shareIdParamSchema,
  shareTokenParamSchema,
} from '@/lib/app/reports/share/validations';
import {
  createWorkspaceSchema,
  invitationIdParamSchema,
  inviteToWorkspaceSchema,
} from '@/lib/app/workspaces/validations';
import { monthUsageSchema, reviewRefusalDetailsSchema } from '@/lib/app/usage/wire';
import {
  adminCreditsListSchema,
  adminCreditsQuerySchema,
  creditChangeResultSchema,
  creditChangeSchema,
} from '@/lib/app/credits/wire';
import {
  adminCodesListSchema,
  adminCodesQuerySchema,
  codeIdParamSchema,
  issueCodesSchema,
  codeCheckSchema,
  issuedCodesSchema,
  redemptionSchema,
  reviewCodeSchema,
  typedCodeSchema,
} from '@/lib/app/credits/codes/wire';

/** Every method a Next.js route handler can export. */
export const HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Who may call a route.
 *
 * - `anyone` — no sign-in; anonymous callers are rate-limited by IP.
 * - `signed-in` — any session. With `orSignedOut`, a caller with neither a
 *   session nor a key may call too, and gets less: the route's docblock and
 *   summary say what (the quick scan's scores and a caveat, t-68).
 * - `workspace-admin` — the workspace the path names, as its `OWNER` or
 *   `ADMIN` acting in it, or a platform admin (the authorization policy's
 *   answer for an org resource). `platformAdmin` says where that platform
 *   admin may be acting: `anywhere`, or only `entered` — acting in this very
 *   workspace, which for a customer's means under its support grant.
 *
 * - `platform-admin` — a platform admin, by session or by an API key with
 *   the `admin` scope (`withAdminAuth`).
 *
 * `apiKeyScope` is the scope an API key needs, or `null` when the route
 * refuses API keys and wants a browser session.
 */
export type RouteAuth =
  | { who: 'anyone' }
  | { who: 'platform-admin' }
  | { who: 'signed-in'; apiKeyScope: string | null; orSignedOut?: true }
  | {
      who: 'workspace-admin';
      apiKeyScope: string | null;
      platformAdmin: 'anywhere' | 'entered';
    };

export interface RouteContract {
  /**
   * A route behind a switch: published in the OpenAPI document and on
   * `/developers` only while this answers `true` (`servedRoutes()`). Read per
   * call. Absent: always published. It does not gate the handler: the route
   * must check the same switch itself and answer 404 while it is off, as
   * `POST /api/v1/scan` does.
   */
  enabled?: () => boolean;
  method: HttpMethod;
  /** The URL path, with each dynamic segment as `{name}`, e.g. `/api/v1/frameworks/{slug}`. */
  path: string;
  summary: string;
  auth: RouteAuth;
  /** The schemas the handler parses with. */
  request: {
    params?: z.ZodType;
    /**
     * What a path that fails `params` is answered with. Absent: 400
     * `VALIDATION_ERROR`. The framework routes answer 404, as for a
     * well-formed segment that names nothing.
     */
    invalidParamsStatus?: 404;
    query?: z.ZodType;
    body?: z.ZodType;
  };
  /** Refusals declared beyond the codes every route answers; see the module docblock. */
  errors?: readonly RouteError[];
  response: {
    /**
     * The success status, or each one the route answers with the same `data`
     * shape (`POST assessments`: 200 once final, 202 while it runs).
     */
    status: SuccessStatus | readonly [SuccessStatus, ...SuccessStatus[]];
    /**
     * The success envelope's `data`; for a `stream`, each event's payload,
     * which is also its `type`.
     */
    data: z.ZodType;
    /** The success envelope's `meta`, when the route sends one. */
    meta?: z.ZodType;
    /**
     * A conditional GET: the response carries an `ETag`, and a request whose
     * `If-None-Match` holds it is answered 304 with no body.
     */
    conditional?: true;
    /**
     * `sse`: the response is `text/event-stream` (`sseResponse`), not the
     * envelope. Each event is `event: <type>` and `data: <payload>`.
     */
    stream?: 'sse';
    /**
     * The response is a file of this media type, sent as an attachment, not
     * the envelope; `data` describes its bytes. Errors are still the envelope.
     */
    file?: 'application/pdf';
    /**
     * `false`: the body is `data` itself, as JSON, not the success envelope
     * (the OpenAPI document). Errors are still the envelope.
     */
    envelope?: false;
  };
}

export type SuccessStatus = 200 | 201 | 202;

/** A refusal a route declares: its status, its `error.code`, and when it is answered. */
export interface RouteError {
  status: number;
  code: string;
  description: string;
}

// --- Response shapes -------------------------------------------------------

const isoDateTime = z.iso.datetime();

/** `VersionSummary` in `lib/app/frameworks/api/service.ts`. */
export const versionSummarySchema = z.object({
  version: z.string(),
  schemaVersion: z.string(),
  status: z.enum(['published', 'retired']),
  publishedAt: isoDateTime.nullable(),
  sourceSha256: z.string(),
});

/** `FrameworkSummary`. */
export const frameworkSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  summary: z.string(),
  latestVersion: z.string().nullable(),
  versions: z.array(versionSummarySchema),
});

/** `FrameworkDetail`. */
export const frameworkDetailSchema = frameworkSummarySchema;

const idNameSchema = z.object({ id: z.string(), name: z.string() });

/** `howDoesThisLandCatalogue()` (t-67): ids and names only, never the model. */
export const frameworkCatalogueSchema = z.object({
  request: z.object({
    contentTypes: z.array(idNameSchema),
    archetypes: z.array(idNameSchema),
    roles: z.array(idNameSchema),
    audience: z.array(
      idNameSchema.extend({ options: z.array(z.object({ id: z.string(), label: z.string() })) })
    ),
    countries: z.array(idNameSchema.extend({ region: z.string() })).optional(),
    /**
     * How far a project may adjust the version's weights (t-72), or `null`
     * when it allows none: per appeal, how far either way as a share of the
     * mix, and how many core dimensions may be added to or removed from a
     * content type's priorities.
     */
    adjustment: z
      .object({
        weights: z.object({
          ethos: z.number(),
          pathos: z.number(),
          logos: z.number(),
          kairos: z.number(),
        }),
        priorityDimensions: z.object({ add: z.number().int(), remove: z.number().int() }),
      })
      .nullable(),
  }),
  result: z.object({
    appeals: z.array(idNameSchema),
    dimensions: z.array(idNameSchema.extend({ appeal: z.string(), group: z.string().nullable() })),
    lenses: z.array(idNameSchema),
    groups: z.array(idNameSchema),
    redFlags: z.array(idNameSchema.extend({ severity: z.string() })),
    duties: z.array(idNameSchema),
    moves: z.array(idNameSchema),
    perspectives: z.array(idNameSchema.extend({ levers: z.array(idNameSchema) })),
    cultureScales: z.array(idNameSchema).optional(),
    profiles: z.array(idNameSchema),
    reviewers: z.array(z.object({ id: z.string(), covers: z.string() })),
  }),
});

/** A framework record or model as the version materialises it: open JSON. */
const jsonObjectSchema = z.record(z.string(), z.unknown());

/** `VersionMeta` in `lib/app/frameworks/api/service.ts`. */
export const versionMetaSchema = versionSummarySchema.extend({
  framework: z.string(),
  /** Sections a switch withholds; absent when none is. */
  omitted: z.array(z.string()).optional(),
});

/** `KindMeta`. */
export const kindMetaSchema = versionMetaSchema.extend({
  kind: z.string(),
  count: z.number().int(),
  /** A nested kind only: the kind its records sit under, and each record's parent id. */
  parentKind: z.string().nullable().optional(),
  parents: z.record(z.string(), z.string()).optional(),
});

/** `CreatedWorkspace` in `lib/app/workspaces/create.ts`. */
export const createdWorkspaceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  role: z.literal(ORG_OWNER_ROLE),
});

/** `InvitationForInvitee` in `lib/app/workspaces/invitations.ts`. */
export const invitationForInviteeSchema = z.object({
  id: z.string(),
  workspace: z.object({ id: z.string(), name: z.string() }),
  role: z.enum(ORG_ROLES),
  invitedBy: z.string().nullable(),
  expiresAt: isoDateTime,
  createdAt: isoDateTime,
});

/** What `acceptInvitation()` returns. */
export const acceptedInvitationSchema = z.object({
  orgId: z.string(),
  role: z.enum(ORG_ROLES),
});

/** The 202 an invitation answers whatever happened behind it. */
export const invitationSentSchema = z.object({
  email: z.string(),
  message: z.string(),
});

/** `WorkspaceSettings` in `lib/app/retention/settings.ts`. */
export const workspaceSettingsSchema = z.object({
  retention: appRetentionSchema.nullable(),
  /** `null` only when the stored window is unreadable: no reply is deleted then. */
  judgeReplyRetention: judgeReplyRetentionSchema.nullable(),
});

/** `JudgeModelChoice` in `lib/app/judges/model-choice.ts`. */
export const judgeModelChoiceSchema = z.object({
  key: z.string(),
  name: z.string(),
  role: z.enum(JUDGE_ROLES),
  current: z.object({ model: z.string(), label: z.string(), approved: z.boolean() }).nullable(),
  followsDefault: z.boolean(),
  options: z.array(
    z.object({
      model: z.string(),
      label: z.string(),
      tradeoff: z.string(),
      isDefault: z.boolean(),
    })
  ),
});

/** `FrameworkRef` in `lib/app/assessments/api/views.ts`. */
export const frameworkRefSchema = z.object({ slug: z.string(), version: z.string() });

const assessmentStateSchema = z.enum(ASSESSMENT_STATES);

/** `JudgeRunView`. */
export const judgeRunViewSchema = z.object({
  judge: z.string(),
  status: z.enum(['succeeded', 'failed']),
  model: z.string().nullable(),
  costUsd: z.number(),
  latencyMs: z.number().int().nullable(),
  errorCode: z.string().nullable(),
});

/** `AssessmentSummary`. */
export const assessmentSummarySchema = z.object({
  id: z.string(),
  stored: z.literal(true),
  status: assessmentStateSchema,
  profile: z.string(),
  judges: z.array(z.string()),
  framework: frameworkRefSchema,
  projectId: z
    .string()
    .nullable()
    .describe("The workspace's project it was reviewed in, or `null`."),
  title: z.string().nullable(),
  source: z.object({
    kind: z.enum(['text', 'file', 'url']),
    url: z.string().nullable(),
    fileName: z.string().nullable(),
  }),
  wordCount: z.number().int(),
  overall: z.number().nullable(),
  band: z.string().nullable(),
  costUsd: z.number(),
  error: z.string().nullable(),
  errorCode: z
    .string()
    .nullable()
    .describe(
      "For a failed one that has one: `INSUFFICIENT_CREDITS` (the workspace's CopyCredits no longer covered it) or `BUDGET_EXCEEDED` (its monthly AI budget no longer did) when a stored review was refused as it was claimed, having waited in the queue while other spend landed (after its 202, not as the 402 at request). No AI reviewer was started and nothing was charged. `null` otherwise."
    ),
  errorDetails: reviewRefusalDetailsSchema
    .nullable()
    .describe(
      'For `INSUFFICIENT_CREDITS` or `BUDGET_EXCEEDED`: the figures that 402 carries in `details`. `null` otherwise.'
    ),
  createdAt: isoDateTime,
  startedAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
});

/*
 * An assessment's `context` and `result` are each framework's own shapes, so
 * open here: nothing parses an answer with them. Each place they appear has
 * its own instance, which `lib/app/api/openapi.ts` swaps for the schema of
 * what HowDoesThisLand serves there (t-44).
 */

/** Who the text is for, defaults applied. */
export const assessmentContextField = z.unknown();
/** A result that is always there: the quick scan's, a run kept nowhere. */
export const assessmentResultField = z.unknown();
/** A stored assessment's result: `null` until it is final. */
export const storedResultField = z.unknown();
/** A shared report's result: only what the report reads. */
export const sharedResultField = z.unknown();
/**
 * The project's adjustment to the weights an assessment was scored with
 * (t-72), or `null` for none. Its shape is the framework's; HowDoesThisLand's
 * is `{ weights?, priorityDimensions? }`.
 */
export const assessmentOverlayField = z.record(z.string(), z.unknown()).nullable();

/** `AssessmentDetail`. */
export const assessmentDetailSchema = assessmentSummarySchema.extend({
  /** The copy assessed; the result's offsets point into it. */
  text: z.string(),
  context: assessmentContextField,
  overlay: assessmentOverlayField,
  result: storedResultField,
  judgeRuns: z.array(judgeRunViewSchema),
});

/**
 * A judge run as a shared report shows it (t-32): which judge, whether it
 * answered, and its model. Not its cost, timing or error code.
 */
export const sharedJudgeRunSchema = judgeRunViewSchema.pick({
  judge: true,
  status: true,
  model: true,
});

/**
 * `SharedAssessment` in `lib/app/reports/share/service.ts`: what a share link
 * serves of an assessment. The report's fields and nothing else: no id, cost,
 * source, error, workspace or author.
 */
export const sharedAssessmentSchema = assessmentDetailSchema
  .pick({
    status: true,
    profile: true,
    judges: true,
    framework: true,
    title: true,
    wordCount: true,
    overall: true,
    band: true,
    createdAt: true,
    completedAt: true,
    text: true,
    // The report's cover names it, so a reader knows the scores were weighted for this project.
    overlay: true,
  })
  .extend({ result: sharedResultField, judgeRuns: z.array(sharedJudgeRunSchema) });

// `reportShareSchema` and `createdReportShareSchema` live with the share
// routes' request schemas, which the share panel imports in the browser.
export { createdReportShareSchema, reportShareSchema };

/**
 * `SharedReport`, less its model, plus the version's catalogue: what
 * `GET shared-reports/{token}` answers with, so a reader needs no second
 * call (and has nothing to make one with). `expiresAt` is when the link stops.
 */
export const sharedReportSchema = z.object({
  assessment: sharedAssessmentSchema,
  /** The names of what the result names by id: never the model, which is IP (t-67). */
  catalogue: frameworkCatalogueSchema,
  expiresAt: isoDateTime,
});

/** `EphemeralAssessment`. */
export const ephemeralAssessmentSchema = z.object({
  stored: z.literal(false),
  status: z.enum(['completed', 'partial']),
  profile: z.string(),
  judges: z.array(z.string()),
  framework: frameworkRefSchema,
  wordCount: z.number().int(),
  overall: z.number().nullable(),
  band: z.string().nullable(),
  costUsd: z.number(),
  context: assessmentContextField,
  overlay: assessmentOverlayField,
  result: assessmentResultField,
  judgeRuns: z.array(judgeRunViewSchema),
});

/** `QuickScanSummary`: what a signed-out caller gets from the quick scan (t-68). */
export { quickScanSummarySchema };

/** `QuickScanView`. */
export const quickScanViewSchema = z.object({
  framework: frameworkRefSchema,
  wordCount: z.number().int(),
  overall: z.number().nullable(),
  band: z.string().nullable(),
  context: assessmentContextField,
  result: assessmentResultField,
});

/** `PaginationMeta` in `lib/api/responses.ts`. */
export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

/** `AssessmentEvent` in `lib/app/assessments/api/events.ts`. */
export const assessmentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('assessment_status'), id: z.string(), status: assessmentStateSchema }),
  judgeRunViewSchema.extend({ type: z.literal('assessment_judge'), id: z.string() }),
  z.object({
    type: z.literal('assessment_done'),
    id: z.string(),
    status: assessmentStateSchema,
    overall: z.number().nullable(),
    band: z.string().nullable(),
    costUsd: z.number(),
    error: z.string().nullable(),
    errorCode: z.string().nullable(),
  }),
  z.object({ type: z.literal('assessment_gone'), id: z.string() }),
  z.object({ type: z.literal('assessment_timeout'), id: z.string() }),
]);

/** What `remove()` in `lib/app/assessments/api/service.ts` returns. */
export const assessmentDeletedSchema = z.object({ deleted: z.literal(true) });

/** The report PDF's body: the document's bytes (`file: 'application/pdf'`). */
export const reportPdfSchema = z
  .string()
  .meta({ format: 'binary', description: 'The report, as a PDF document' });

/**
 * The OpenAPI 3.1 document `GET /api/v1/openapi.json` serves, bare
 * (`envelope: false`). Its shape is the OpenAPI specification's.
 */
export const openApiDocumentSchema = z
  .looseObject({
    openapi: z.string(),
    info: z.looseObject({ title: z.string(), version: z.string() }),
    paths: z.record(z.string(), z.unknown()),
  })
  .meta({ description: 'This API, as an OpenAPI 3.1 document.' });

// --- The routes ------------------------------------------------------------

const frameworkParams = z.object({ slug: slugParam });
const versionParams = frameworkParams.extend({ version: versionParam });
const kindParams = versionParams.extend({ kind: kindParam });

/** A browser session, or an API key with the `assess` scope. */
const ASSESS: RouteAuth = { who: 'signed-in', apiKeyScope: ASSESS_SCOPE };
const PROJECTS: RouteAuth = { who: 'signed-in', apiKeyScope: PROJECTS_SCOPE };
/** The quick scan's callers (t-68): as `ASSESS` for the full result, or anyone for the scores. */
const QUICK_SCAN: RouteAuth = { who: 'signed-in', apiKeyScope: ASSESS_SCOPE, orSignedOut: true };
const assessmentParams = assessmentIdParamSchema;

/** Browser-session routes: an API key is refused. */
const SIGNED_IN: RouteAuth = { who: 'signed-in', apiKeyScope: null };
const WORKSPACE_ADMIN: RouteAuth = {
  who: 'workspace-admin',
  apiKeyScope: null,
  platformAdmin: 'anywhere',
};
/** As above, and a platform admin must have entered the workspace (`requireEnteredWorkspace`). */
const WORKSPACE_ADMIN_ENTERED: RouteAuth = {
  who: 'workspace-admin',
  apiKeyScope: null,
  platformAdmin: 'entered',
};

export const APP_ROUTES: readonly RouteContract[] = [
  // This contract, as OpenAPI (t-44).
  {
    method: 'GET',
    path: '/api/v1/openapi.json',
    summary:
      'Get this API as an OpenAPI 3.1 document, generated from the schemas it validates with.',
    auth: { who: 'anyone' },
    request: {},
    response: { status: 200, data: openApiDocumentSchema, conditional: true, envelope: false },
  },

  // Frameworks (t-11). The model is IP (t-67): whole or by kind, platform
  // admins only; callers building reviews read the catalogue.
  {
    method: 'GET',
    path: '/api/v1/frameworks',
    summary: 'List every framework with a published version, newest version first.',
    auth: ASSESS,
    request: {},
    response: { status: 200, data: z.array(frameworkSummarySchema), conditional: true },
  },
  {
    method: 'GET',
    path: '/api/v1/frameworks/{slug}',
    summary: 'Get one framework and its published versions, with the one new reviews use.',
    auth: ASSESS,
    request: { params: frameworkParams, invalidParamsStatus: 404 },
    response: { status: 200, data: frameworkDetailSchema, conditional: true },
  },
  {
    method: 'GET',
    path: '/api/v1/frameworks/{slug}/versions/{version}/catalogue',
    summary:
      "List what a version's reviews take and return, by id and name: the types of copy, readers and settings a review's context takes, and the appeals, dimensions and red flags a result names.",
    auth: ASSESS,
    request: { params: versionParams, invalidParamsStatus: 404 },
    response: {
      status: 200,
      data: frameworkCatalogueSchema,
      meta: versionMetaSchema,
      conditional: true,
    },
  },
  {
    method: 'GET',
    path: '/api/v1/frameworks/{slug}/versions/{version}',
    summary: 'Get the whole model of a published version. Platform admins only.',
    auth: { who: 'platform-admin' },
    request: { params: versionParams, invalidParamsStatus: 404 },
    response: {
      status: 200,
      data: jsonObjectSchema,
      meta: versionMetaSchema,
      conditional: true,
    },
  },
  {
    method: 'GET',
    path: '/api/v1/frameworks/{slug}/versions/{version}/{kind}',
    summary:
      "Get one kind of record from a published version, in the model's order. Platform admins only.",
    auth: { who: 'platform-admin' },
    request: { params: kindParams, invalidParamsStatus: 404 },
    response: {
      status: 200,
      data: z.array(jsonObjectSchema),
      meta: kindMetaSchema,
      conditional: true,
    },
  },

  // The quick scan (t-24), behind its switch (t-61), and assessments (t-24).
  {
    enabled: isQuickScanEnabled,
    method: 'POST',
    path: '/api/v1/scan',
    summary:
      'Run the quick scan on pasted text: deterministic, no AI, nothing stored. Open to anyone: signed out, the scores and a caveat; with an account or an `assess` key, the full result. Limited per IP.',
    auth: QUICK_SCAN,
    request: { body: scanRequestSchema },
    // Which one a caller gets follows the credential, not the body: with a
    // session or a key, the full view; with neither, the summary, which alone
    // has `caveat` and `appeals`. The summary comes first: the view's
    // `unknown` fields would also accept a summary, and strip its caveat.
    response: { status: 200, data: z.union([quickScanSummarySchema, quickScanViewSchema]) },
  },
  {
    method: 'POST',
    path: '/api/v1/assessments',
    summary:
      'Assess a text, a page or a file with a profile or a list of judges: queued, waited for, or kept nowhere.',
    auth: ASSESS,
    request: { body: createAssessmentSchema },
    errors: [
      {
        status: 402,
        code: 'INSUFFICIENT_CREDITS',
        description:
          "The workspace's CopyCredits do not cover the review's estimated cost, or it has none left. No AI reviewer started, nothing was stored and nothing was charged. What is left is the balance less what the workspace's reviews already starting, queued or running (stored or not) have spent and are yet to spend: a review is charged for what it actually spent, rounded up to a whole credit, once it ends, so requests sent together cannot each spend the same credits. A review that started may cost more than its estimate and take the balance below zero; below zero, every review is refused until credits are added. `details` carries, in whole credits, `estimateCredits`, its `basis` (as for `BUDGET_EXCEEDED`), `balanceCredits`, `heldCredits`, `remainingCredits`, and `usagePage`. Credits come from a review code or from HowDoesThisLand. A `quick` review is never refused this way.",
      },
      {
        status: 402,
        code: 'BUDGET_EXCEEDED',
        description:
          "The review's estimated cost is more than what is left of the workspace's monthly AI budget, its safety ceiling whatever its credits, or none is left. Checked after the credits. No AI reviewer started and nothing was stored. What is left holds back what the workspace's reviews already starting, queued or running (stored or not) are yet to spend, so requests sent together cannot each spend the same remainder. `details` carries `estimateUsd`, its `basis` (`profile`, `judges`, `kept-nowhere` for an estimate from the workspace's `store: false` reviews, or `none`), `remainingUsd`, `inFlightUsd`, `limitUsd` and `usagePage`. A `quick` review is never refused this way.",
      },
    ],
    response: {
      status: [200, 202],
      data: z.union([assessmentDetailSchema, ephemeralAssessmentSchema]),
    },
  },
  {
    method: 'GET',
    path: '/api/v1/assessments',
    summary: "List the workspace's assessments, newest first.",
    auth: ASSESS,
    request: { query: listAssessmentsQuerySchema },
    response: { status: 200, data: z.array(assessmentSummarySchema), meta: paginationMetaSchema },
  },
  {
    method: 'GET',
    path: '/api/v1/assessments/{id}',
    summary: 'Get one assessment, its judges and, once final, its result.',
    auth: ASSESS,
    request: { params: assessmentParams },
    response: { status: 200, data: assessmentDetailSchema },
  },
  {
    method: 'DELETE',
    path: '/api/v1/assessments/{id}',
    summary: 'Delete an assessment, its judge runs and its text.',
    auth: ASSESS,
    request: { params: assessmentParams },
    response: { status: 200, data: assessmentDeletedSchema },
  },
  {
    method: 'GET',
    path: '/api/v1/assessments/{id}/events',
    summary: "Follow an assessment's progress as Server-Sent Events, read from its stored rows.",
    auth: ASSESS,
    request: { params: assessmentParams },
    response: { status: 200, data: assessmentEventSchema, stream: 'sse' },
  },
  {
    method: 'GET',
    path: '/api/v1/assessments/{id}/report.pdf',
    summary:
      "Download a finished review's report as a PDF, rendered once and then served from the workspace's storage.",
    auth: { who: 'signed-in', apiKeyScope: REPORTS_SCOPE },
    request: { params: assessmentParams },
    response: { status: 200, data: reportPdfSchema, file: 'application/pdf' },
  },
  // Projects (t-70).
  {
    method: 'POST',
    path: '/api/v1/projects',
    summary:
      'Make a project: a name, a brief the AI reviewers read, and the defaults its reviews take (type of copy, audience, culture, profile).',
    auth: PROJECTS,
    request: { body: createProjectSchema },
    response: { status: 201, data: projectSchema },
  },
  {
    method: 'GET',
    path: '/api/v1/projects',
    summary: "List the workspace's projects, newest first; archived ones only when asked.",
    auth: PROJECTS,
    request: { query: listProjectsQuerySchema },
    response: { status: 200, data: z.array(projectSchema), meta: paginationMetaSchema },
  },
  {
    method: 'GET',
    path: '/api/v1/projects/{id}',
    summary: 'Get one project.',
    auth: PROJECTS,
    request: { params: projectIdParamSchema },
    response: { status: 200, data: projectSchema },
  },
  {
    method: 'PATCH',
    path: '/api/v1/projects/{id}',
    summary:
      "Change a project's name, brief or defaults (each replaced whole), or archive or restore it.",
    auth: PROJECTS,
    request: { params: projectIdParamSchema, body: updateProjectSchema },
    response: { status: 200, data: projectSchema },
  },
  {
    method: 'DELETE',
    path: '/api/v1/projects/{id}',
    summary: 'Archive a project. Its reviews keep their link, and it can be restored.',
    auth: PROJECTS,
    request: { params: projectIdParamSchema },
    response: { status: 200, data: projectSchema },
  },
  // Share links (t-32).
  {
    method: 'POST',
    path: '/api/v1/assessments/{id}/shares',
    summary:
      "Make a link that opens a finished review's report for someone without an account, until it expires (30 days unless set) or is revoked. The token is shown only here.",
    auth: { who: 'signed-in', apiKeyScope: ASSESS_SCOPE },
    request: { params: assessmentParams, body: createShareSchema },
    response: { status: 201, data: createdReportShareSchema },
  },
  {
    method: 'GET',
    path: '/api/v1/assessments/{id}/shares',
    summary: "List a review's share links, newest first, with each one's state and view count.",
    auth: { who: 'signed-in', apiKeyScope: REPORTS_SCOPE },
    request: { params: assessmentParams },
    response: { status: 200, data: z.array(reportShareSchema) },
  },
  {
    method: 'DELETE',
    path: '/api/v1/shares/{id}',
    summary: 'Revoke a share link: it stops opening the report at once.',
    auth: { who: 'signed-in', apiKeyScope: ASSESS_SCOPE },
    request: { params: shareIdParamSchema },
    response: { status: 200, data: reportShareSchema },
  },
  {
    method: 'GET',
    path: '/api/v1/shared-reports/{token}',
    summary:
      'Open a shared report by its link token, without an account: the review, less its cost and who ran it, and the model it ran on. Limited per IP.',
    auth: { who: 'anyone' },
    request: { params: shareTokenParamSchema },
    response: { status: 200, data: sharedReportSchema },
  },
  {
    method: 'POST',
    path: '/api/v1/assessments/{id}/cancel',
    summary: 'Cancel a queued or running assessment: no further judge is called.',
    auth: ASSESS,
    request: { params: assessmentParams },
    response: { status: 200, data: assessmentDetailSchema },
  },

  // Usage (t-48).
  {
    method: 'GET',
    path: '/api/v1/usage',
    summary:
      "Get the workspace's reviews, AI reviewer calls and spend this month (UTC), by project and in total, against its monthly budget.",
    auth: { who: 'signed-in', apiKeyScope: REPORTS_SCOPE },
    request: {},
    response: { status: 200, data: monthUsageSchema },
  },

  // Workspaces (t-8, t-9).
  {
    method: 'POST',
    path: '/api/v1/workspaces',
    summary: 'Create a team workspace with the caller as its owner.',
    auth: SIGNED_IN,
    request: { body: createWorkspaceSchema },
    response: { status: 201, data: createdWorkspaceSchema },
  },
  {
    method: 'POST',
    path: '/api/v1/workspaces/{id}/invitations',
    summary: 'Invite someone into a workspace, whether or not they have an account.',
    auth: WORKSPACE_ADMIN,
    request: { params: orgIdParamSchema, body: inviteToWorkspaceSchema },
    response: { status: 202, data: invitationSentSchema },
  },
  {
    method: 'GET',
    path: '/api/v1/workspaces/invitations',
    summary: "List the caller's own open workspace invitations, newest first.",
    auth: SIGNED_IN,
    request: {},
    response: { status: 200, data: z.object({ invitations: z.array(invitationForInviteeSchema) }) },
  },
  {
    method: 'POST',
    path: '/api/v1/workspaces/invitations/{invitationId}/accept',
    summary: 'Accept an invitation and join the workspace with its role.',
    auth: SIGNED_IN,
    request: { params: invitationIdParamSchema },
    response: { status: 200, data: acceptedInvitationSchema },
  },
  {
    method: 'POST',
    path: '/api/v1/workspaces/invitations/{invitationId}/decline',
    summary: 'Decline an invitation.',
    auth: SIGNED_IN,
    request: { params: invitationIdParamSchema },
    response: { status: 200, data: z.object({ declined: z.literal(true) }) },
  },
  {
    method: 'GET',
    path: '/api/v1/workspaces/{id}/settings',
    summary: "Get the workspace's retention windows for its content and its judges' replies.",
    auth: WORKSPACE_ADMIN,
    request: { params: orgIdParamSchema },
    response: { status: 200, data: workspaceSettingsSchema },
  },
  {
    method: 'PATCH',
    path: '/api/v1/workspaces/{id}/settings',
    summary:
      "Set how long the workspace keeps its content and assessments, and its judges' replies.",
    auth: WORKSPACE_ADMIN,
    request: { params: orgIdParamSchema, body: updateWorkspaceSettingsSchema },
    response: { status: 200, data: workspaceSettingsSchema },
  },

  // Judges (t-21).
  {
    method: 'GET',
    path: '/api/v1/workspaces/{id}/judges',
    summary: "List the workspace's judges and editor, the model each runs on, and its options.",
    auth: WORKSPACE_ADMIN_ENTERED,
    request: { params: orgIdParamSchema },
    response: { status: 200, data: z.object({ agents: z.array(judgeModelChoiceSchema) }) },
  },
  {
    method: 'PATCH',
    path: '/api/v1/workspaces/{id}/judges/{key}',
    summary: 'Choose the model one judge or the editor runs on, or return it to the default.',
    auth: WORKSPACE_ADMIN_ENTERED,
    request: { params: judgeModelParamsSchema, body: chooseJudgeModelSchema },
    response: { status: 200, data: judgeModelChoiceSchema },
  },

  // Calibration, for platform admins (t-38). Publishing stays a CLI action.
  {
    method: 'GET',
    path: '/api/v1/admin/frameworks',
    summary:
      'List every framework version with its calibration snapshot and runs, each with its agreement and its change from the run before.',
    auth: { who: 'platform-admin' },
    request: {},
    response: { status: 200, data: z.array(frameworkCalibrationSchema) },
  },
  {
    method: 'POST',
    path: '/api/v1/admin/frameworks/{slug}/versions/{version}/calibration-runs',
    summary:
      'Start a calibration run of a version: a quick run answers once complete, an AI run once started.',
    auth: { who: 'platform-admin' },
    request: { params: calibrationRunParamsSchema, body: startCalibrationRunSchema },
    response: { status: [201, 202], data: startedRunSchema },
  },

  // CopyCredits, for platform admins (t-57).
  {
    method: 'GET',
    path: '/api/v1/admin/credits',
    summary:
      'List active workspaces with their CopyCredits balance and what their monthly AI cap leaves this month. `q` narrows by name or slug.',
    auth: { who: 'platform-admin' },
    request: { query: adminCreditsQuerySchema },
    response: { status: 200, data: adminCreditsListSchema },
  },
  {
    method: 'POST',
    path: '/api/v1/admin/credits/{id}/entries',
    summary:
      "Grant or adjust a workspace's CopyCredits, with a reason. Answers with the new balance, and a warning when it is worth more than the workspace's cap leaves this month.",
    auth: { who: 'platform-admin' },
    request: { params: orgIdParamSchema, body: creditChangeSchema },
    response: { status: 201, data: creditChangeResultSchema },
  },

  // Free review codes, for platform admins (t-59).
  {
    method: 'GET',
    path: '/api/v1/admin/codes',
    summary:
      'List free review codes, newest first, each with its redeem link, the redemptions used and left, and whether it can still be redeemed. `q` narrows by campaign or code.',
    auth: { who: 'platform-admin' },
    request: { query: adminCodesQuerySchema },
    response: { status: 200, data: adminCodesListSchema },
  },
  {
    method: 'POST',
    path: '/api/v1/admin/codes',
    summary:
      'Mint free review codes: `count` codes alike, each giving `creditsPerRedemption` CopyCredits to the workspace that redeems it, up to `maxRedemptions` times (1 for a personal code, more for a QR card), until `expiresAt`. Each answers with its redeem link, which is what its QR encodes. With an `idempotencyKey`, a retried call mints once: the same key and body answer 200 with the codes first minted (`replayed: true`); a new mint answers 201. A retry is checked like a first call, so one sent after `expiresAt` has passed is refused (400): give a code more life than the caller retries for. Keys are install-wide, not per caller: use keys unique to the caller, such as a UUID or a prefixed id of its own.',
    auth: { who: 'platform-admin' },
    request: { body: issueCodesSchema },
    errors: [
      {
        status: 409,
        code: 'CONFLICT',
        description:
          'The `idempotencyKey` already minted codes for a different request. Nothing was minted; use a new key.',
      },
    ],
    response: { status: [200, 201], data: issuedCodesSchema },
  },
  {
    method: 'DELETE',
    path: '/api/v1/admin/codes/{id}',
    summary:
      'Revoke a free review code: it can no longer be redeemed, and credits it already gave stay given. Revoking a revoked code changes nothing. Answers with the code.',
    auth: { who: 'platform-admin' },
    request: { params: codeIdParamSchema, invalidParamsStatus: 404 },
    errors: [{ status: 404, code: 'NOT_FOUND', description: 'No code has this id.' }],
    response: { status: 200, data: reviewCodeSchema },
  },
  {
    method: 'POST',
    path: '/api/v1/codes/check',
    summary:
      'Check a free review code before redeeming it: `active` with the CopyCredits it gives and when it expires, or why it cannot be redeemed (`expired`, `used-up`, `revoked`). Anything malformed or not found is `unknown`, alike. The code goes in the body, as typed: any case, with or without dashes. Nothing is written. Limited per IP, with the redeem page and redeeming.',
    auth: { who: 'anyone' },
    request: { body: typedCodeSchema },
    response: { status: 200, data: codeCheckSchema },
  },
  {
    method: 'POST',
    path: '/api/v1/codes/redeem',
    summary:
      'Redeem a free review code into the workspace you act in: its CopyCredits are added to the balance, once per person per code, and never more times than the code allows however many redeem at once. Answers with the credits given, the balance after, and the workspace. Limited per IP and per person.',
    auth: ASSESS,
    request: { body: typedCodeSchema },
    errors: [
      {
        status: 404,
        code: 'CODE_UNKNOWN',
        description: 'No such code: malformed or not found, alike. Nothing was written.',
      },
      {
        status: 404,
        code: 'NOT_FOUND',
        description: 'The workspace you act in is not active.',
      },
      {
        status: 409,
        code: 'CODE_ALREADY_REDEEMED',
        description: 'You have already redeemed this code. Each person redeems a code once.',
      },
      { status: 410, code: 'CODE_EXPIRED', description: 'The code has expired.' },
      {
        status: 410,
        code: 'CODE_USED_UP',
        description: 'The code has been redeemed as many times as it allows.',
      },
      { status: 410, code: 'CODE_REVOKED', description: 'The code has been withdrawn.' },
    ],
    response: { status: 200, data: redemptionSchema },
  },
];

/** The routes served right now: every one but those whose switch is off. */
export function servedRoutes(): RouteContract[] {
  return APP_ROUTES.filter((route) => route.enabled?.() ?? true);
}

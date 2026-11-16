/**
 * The app's API contract: every route this fork serves under `/api/v1/`
 * (t-23, D12).
 *
 * The API is the product, so its contract is written down here rather than
 * read off the handlers. Each entry gives a route's method, path, request and
 * response Zod schemas, who may call it, and a one-line summary. `dp2`
 * publishes it as OpenAPI; nothing generates OpenAPI yet.
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
 * envelope, and its docblock lists the codes.
 */
import { z } from 'zod';
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
import {
  appRetentionSchema,
  judgeReplyRetentionSchema,
  updateWorkspaceSettingsSchema,
} from '@/lib/app/retention/settings';
import {
  createWorkspaceSchema,
  invitationIdParamSchema,
  inviteToWorkspaceSchema,
} from '@/lib/app/workspaces/validations';

/** Every method a Next.js route handler can export. */
export const HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Who may call a route.
 *
 * - `anyone` — no sign-in; anonymous callers are rate-limited by IP.
 * - `signed-in` — any session.
 * - `workspace-admin` — the workspace the path names, as its `OWNER` or
 *   `ADMIN` acting in it, or a platform admin (the authorization policy's
 *   answer for an org resource). `platformAdmin` says where that platform
 *   admin may be acting: `anywhere`, or only `entered` — acting in this very
 *   workspace, which for a customer's means under its support grant.
 *
 * `apiKeyScope` is the scope an API key needs, or `null` when the route
 * refuses API keys and wants a browser session.
 */
export type RouteAuth =
  | { who: 'anyone' }
  | { who: 'signed-in'; apiKeyScope: string | null }
  | {
      who: 'workspace-admin';
      apiKeyScope: string | null;
      platformAdmin: 'anywhere' | 'entered';
    };

export interface RouteContract {
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
  };
}

export type SuccessStatus = 200 | 201 | 202;

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
export const frameworkDetailSchema = frameworkSummarySchema.extend({
  kinds: z.array(z.string()),
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
  createdAt: isoDateTime,
  startedAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
});

/**
 * `AssessmentDetail`. `context` and `result` are the framework's own shapes,
 * so open here; `dp2` documents HowDoesThisLand's.
 */
export const assessmentDetailSchema = assessmentSummarySchema.extend({
  /** The copy assessed; the result's offsets point into it. */
  text: z.string(),
  context: z.unknown(),
  result: z.unknown(),
  judgeRuns: z.array(judgeRunViewSchema),
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
  context: z.unknown(),
  result: z.unknown(),
  judgeRuns: z.array(judgeRunViewSchema),
});

/** `QuickScanView`. */
export const quickScanViewSchema = z.object({
  framework: frameworkRefSchema,
  wordCount: z.number().int(),
  overall: z.number().nullable(),
  band: z.string().nullable(),
  context: z.unknown(),
  result: z.unknown(),
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

// --- The routes ------------------------------------------------------------

const frameworkParams = z.object({ slug: slugParam });
const versionParams = frameworkParams.extend({ version: versionParam });
const kindParams = versionParams.extend({ kind: kindParam });

/** A browser session, or an API key with the `assess` scope. */
const ASSESS: RouteAuth = { who: 'signed-in', apiKeyScope: ASSESS_SCOPE };
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
  // Frameworks (t-11): public, read-only, conditional GETs.
  {
    method: 'GET',
    path: '/api/v1/frameworks',
    summary: 'List every framework with a published version, newest version first.',
    auth: { who: 'anyone' },
    request: {},
    response: { status: 200, data: z.array(frameworkSummarySchema), conditional: true },
  },
  {
    method: 'GET',
    path: '/api/v1/frameworks/{slug}',
    summary: 'Get one framework, its published versions and the record kinds a version serves.',
    auth: { who: 'anyone' },
    request: { params: frameworkParams, invalidParamsStatus: 404 },
    response: { status: 200, data: frameworkDetailSchema, conditional: true },
  },
  {
    method: 'GET',
    path: '/api/v1/frameworks/{slug}/versions/{version}',
    summary: 'Get the whole model of a published version.',
    auth: { who: 'anyone' },
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
    summary: "Get one kind of record from a published version, in the model's order.",
    auth: { who: 'anyone' },
    request: { params: kindParams, invalidParamsStatus: 404 },
    response: {
      status: 200,
      data: z.array(jsonObjectSchema),
      meta: kindMetaSchema,
      conditional: true,
    },
  },

  // The quick scan and assessments (t-24).
  {
    method: 'POST',
    path: '/api/v1/scan',
    summary:
      'Run the free quick scan on pasted text: deterministic, no AI, nothing stored. Limited per IP.',
    auth: { who: 'anyone' },
    request: { body: scanRequestSchema },
    response: { status: 200, data: quickScanViewSchema },
  },
  {
    method: 'POST',
    path: '/api/v1/assessments',
    summary:
      'Assess a text, a page or a file with a profile or a list of judges: queued, waited for, or kept nowhere.',
    auth: ASSESS,
    request: { body: createAssessmentSchema },
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
  {
    method: 'POST',
    path: '/api/v1/assessments/{id}/cancel',
    summary: 'Cancel a queued or running assessment: no further judge is called.',
    auth: ASSESS,
    request: { params: assessmentParams },
    response: { status: 200, data: assessmentDetailSchema },
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
];

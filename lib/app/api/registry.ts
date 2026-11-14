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
 * the contract cannot drift from what is enforced. Response schemas describe
 * the `data` (and `meta`) of the success envelope on the wire, where a `Date`
 * is an ISO string. A type test (`tests/unit/lib/app/api/registry.test.ts`)
 * holds each against the type its service returns.
 *
 * **Which routes are the app's:** the route directories this fork added under
 * `app/api/v1/`, listed in that test. Core's routes are not ours to declare.
 * The same test fails when a route file exports a method this registry does
 * not declare, or this registry declares one no file exports.
 *
 * Errors are not declared per route: every route answers the standard error
 * envelope, and its docblock lists the codes.
 */
import { z } from 'zod';
import { orgIdParamSchema } from '@/lib/validations/tenancy';
import { ORG_OWNER_ROLE, ORG_ROLES } from '@/lib/tenancy/roles';
import { kindParam, slugParam, versionParam } from '@/lib/app/frameworks/api/service';
import { JUDGE_ROLES } from '@/lib/app/judges/approved-models';
import { chooseJudgeModelSchema, judgeModelParamsSchema } from '@/lib/app/judges/validations';
import {
  createWorkspaceSchema,
  invitationIdParamSchema,
  inviteToWorkspaceSchema,
} from '@/lib/app/workspaces/validations';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Who may call a route.
 *
 * - `anyone` — no sign-in; anonymous callers are rate-limited by IP.
 * - `signed-in` — any session.
 * - `workspace-admin` — the workspace the path names, as its `OWNER` or
 *   `ADMIN` acting in it, or a platform admin (the authorization policy's
 *   answer for an org resource).
 *
 * `apiKeyScope` is the scope an API key needs, or `null` when the route
 * refuses API keys and wants a browser session.
 */
export type RouteAuth =
  { who: 'anyone' } | { who: 'signed-in' | 'workspace-admin'; apiKeyScope: string | null };

export interface RouteContract {
  method: HttpMethod;
  /** The URL path, with each dynamic segment as `{name}`, e.g. `/api/v1/frameworks/{slug}`. */
  path: string;
  summary: string;
  auth: RouteAuth;
  request: {
    params?: z.ZodType;
    query?: z.ZodType;
    body?: z.ZodType;
  };
  response: {
    /** The success status. */
    status: 200 | 201 | 202;
    /** The success envelope's `data`. */
    data: z.ZodType;
    /** The success envelope's `meta`, when the route sends one. */
    meta?: z.ZodType;
  };
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
export const frameworkDetailSchema = frameworkSummarySchema.extend({
  kinds: z.array(z.string()),
});

/** A framework record or model as the version materialises it: open JSON. */
const jsonObjectSchema = z.record(z.string(), z.unknown());

/** The `meta` of a version response (`versionMeta()`). */
export const versionMetaSchema = versionSummarySchema.extend({
  framework: z.string(),
  /** Sections a switch withholds; absent when none is. */
  omitted: z.array(z.string()).optional(),
});

/** The `meta` of a kind response (`kindRecords()`). */
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

// --- The routes ------------------------------------------------------------

const frameworkParams = z.object({ slug: slugParam });
const versionParams = frameworkParams.extend({ version: versionParam });
const kindParams = versionParams.extend({ kind: kindParam });

/** Browser-session routes: an API key is refused. */
const SIGNED_IN: RouteAuth = { who: 'signed-in', apiKeyScope: null };
const WORKSPACE_ADMIN: RouteAuth = { who: 'workspace-admin', apiKeyScope: null };

export const APP_ROUTES: readonly RouteContract[] = [
  // Frameworks (t-11): public, read-only, conditional GETs.
  {
    method: 'GET',
    path: '/api/v1/frameworks',
    summary: 'List every framework with a published version, newest version first.',
    auth: { who: 'anyone' },
    request: {},
    response: { status: 200, data: z.array(frameworkSummarySchema) },
  },
  {
    method: 'GET',
    path: '/api/v1/frameworks/{slug}',
    summary: 'Get one framework, its published versions and the record kinds a version serves.',
    auth: { who: 'anyone' },
    request: { params: frameworkParams },
    response: { status: 200, data: frameworkDetailSchema },
  },
  {
    method: 'GET',
    path: '/api/v1/frameworks/{slug}/versions/{version}',
    summary: 'Get the whole model of a published version.',
    auth: { who: 'anyone' },
    request: { params: versionParams },
    response: { status: 200, data: jsonObjectSchema, meta: versionMetaSchema },
  },
  {
    method: 'GET',
    path: '/api/v1/frameworks/{slug}/versions/{version}/{kind}',
    summary: "Get one kind of record from a published version, in the model's order.",
    auth: { who: 'anyone' },
    request: { params: kindParams },
    response: { status: 200, data: z.array(jsonObjectSchema), meta: kindMetaSchema },
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

  // Judges (t-21).
  {
    method: 'GET',
    path: '/api/v1/workspaces/{id}/judges',
    summary: "List the workspace's judges and editor, the model each runs on, and its options.",
    auth: WORKSPACE_ADMIN,
    request: { params: orgIdParamSchema },
    response: { status: 200, data: z.object({ agents: z.array(judgeModelChoiceSchema) }) },
  },
  {
    method: 'PATCH',
    path: '/api/v1/workspaces/{id}/judges/{key}',
    summary: 'Choose the model one judge or the editor runs on, or return it to the default.',
    auth: WORKSPACE_ADMIN,
    request: { params: judgeModelParamsSchema, body: chooseJudgeModelSchema },
    response: { status: 200, data: judgeModelChoiceSchema },
  },
];

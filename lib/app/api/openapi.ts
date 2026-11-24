/**
 * The app's API as an OpenAPI 3.1 document, generated from the route
 * registry (t-44, D20).
 *
 * Every schema in the document is the registry's Zod schema converted by
 * zod 4's `z.toJSONSchema` (JSON Schema 2020-12, OpenAPI 3.1's own dialect),
 * so the document cannot say something the handlers do not enforce. Request
 * schemas are converted as their input (what a caller sends, before defaults
 * and coercion), responses as their output. The two framework components
 * below are the exception: nothing checks a stored result on the way out,
 * so they are converted as input, which forbids no key they do not name.
 *
 * **What each registry property becomes:**
 * - `auth` → the operation's `security`: none for `anyone`; a session
 *   cookie, or a bearer API key holding `apiKeyScope` where one is accepted;
 *   a session or a key with the `admin` scope for a platform admin. A 401
 *   and a 403 for every route that needs a caller: one that refuses API keys
 *   answers a key with 403. `orSignedOut` adds the empty requirement `{}`:
 *   a caller with no credential may call too, and gets less.
 * - `enabled` → a route whose switch is off is left out of the document.
 * - `upload` → a `multipart/form-data` request body beside the JSON one: a
 *   `file` part, and an `options` part in that schema, as JSON (t-80).
 * - `params` / `query` / `body` → parameters and the request body, with a
 *   400 `VALIDATION_ERROR`; `invalidParamsStatus: 404` answers a bad path
 *   with a 404 instead.
 * - `status` → one success response per status, each with the same body.
 * - `conditional` → an `If-None-Match` parameter, an `ETag` header on the
 *   success response, and a 304.
 * - `stream: 'sse'` → `text/event-stream`, its schema the events' payload.
 * - `file` → that media type, with the bytes as its schema.
 * - `envelope: false` → `data` as the body itself.
 * - `errors` → an error response per status, its description each code's.
 *
 * Every route also answers 429 (the `/api/v1` rate-limit policy, applied in
 * `proxy.ts`) and, as `default`, the error envelope for anything else. A
 * code a route's handler raises beyond those is in its docblock, not here,
 * unless the registry declares it in `errors`.
 *
 * The document lists only the methods the registry declares. Next.js also
 * answers HEAD on every GET and OPTIONS on every route; OpenAPI tools expect
 * neither listed, and the developer docs say so (dp2b).
 *
 * An assessment's `context` and `result` are `unknown` in the registry (each
 * framework brings its own); here they are HowDoesThisLand's
 * (`lib/app/frameworks/howdoesthisland/engine/wire.ts`), as components.
 */
import { z } from 'zod';
import { computeETag } from '@/lib/api/etag';
import {
  servedRoutes,
  assessmentContextField,
  assessmentResultField,
  sharedResultField,
  storedResultField,
  type RouteAuth,
  type RouteContract,
} from '@/lib/app/api/registry';
import {
  engineContextSchema,
  engineResultSchema,
} from '@/lib/app/frameworks/howdoesthisland/engine/wire';
import { reportResultSchema } from '@/lib/app/reports/input';

export const OPENAPI_VERSION = '3.1.1';

/** Bumped with the API's contract, not the app's release. */
export const API_VERSION = '1.0.0';

type JsonSchema = Record<string, unknown>;
type JsonObject = Record<string, unknown>;

/** A JSON object: the document is built of plain values only. */
export type OpenApiDocument = JsonObject & {
  openapi: string;
  info: { title: string; version: string; description: string };
  paths: Record<string, Record<string, JsonObject>>;
  components: JsonObject;
};

const ref = (component: string): JsonSchema => ({ $ref: `#/components/schemas/${component}` });

/** The registry's open fields, and what HowDoesThisLand serves in each. */
const FRAMEWORK_FIELDS = new Map<unknown, JsonSchema>([
  [assessmentContextField, ref('AssessmentContext')],
  [assessmentResultField, ref('AssessmentResult')],
  [
    storedResultField,
    {
      anyOf: [ref('AssessmentResult'), { type: 'null' }],
      description: '`null` until the assessment is final.',
    },
  ],
  [sharedResultField, ref('SharedReportResult')],
]);

/** A Zod schema as JSON Schema 2020-12, with the framework fields swapped in. */
function toSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const json: JsonSchema = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    // Every schema is written out in place, so no `$defs` reference can
    // point at the document root, where it would not resolve.
    reused: 'inline',
    override: ({ zodSchema, jsonSchema }) => {
      const swapped = FRAMEWORK_FIELDS.get(zodSchema);
      if (!swapped) return;
      for (const k of Object.keys(jsonSchema)) Reflect.deleteProperty(jsonSchema, k);
      Object.assign(jsonSchema, swapped);
    },
  });
  delete json.$schema;
  return json;
}

/** The `{ success: true, data, meta? }` envelope around `data`. */
function envelope(route: RouteContract): JsonSchema {
  const { data, meta } = route.response;
  return {
    type: 'object',
    properties: {
      success: { const: true },
      data: toSchema(data, 'output'),
      ...(meta ? { meta: toSchema(meta, 'output') } : {}),
    },
    required: meta ? ['success', 'data', 'meta'] : ['success', 'data'],
  };
}

function successContent(route: RouteContract): JsonObject {
  const { response } = route;
  if (response.stream === 'sse') {
    return {
      'text/event-stream': {
        schema: { type: 'string', description: 'Server-Sent Events.' },
        // Each event's `data:` line, whose `type` is also its `event:` name.
        'x-event-schema': toSchema(response.data, 'output'),
      },
    };
  }
  if (response.file) {
    return { [response.file]: { schema: toSchema(response.data, 'output') } };
  }
  if (response.envelope === false) {
    return { 'application/json': { schema: toSchema(response.data, 'output') } };
  }
  return { 'application/json': { schema: envelope(route) } };
}

const errorRef = (description: string): JsonObject => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
});

/** Who may call it, beyond the security requirement, in words. */
function authNote(auth: RouteAuth): string | null {
  switch (auth.who) {
    case 'anyone':
      return null;
    case 'signed-in': {
      const who = auth.apiKeyScope
        ? `A session, or an API key with the \`${auth.apiKeyScope}\` scope.`
        : 'A browser session; API keys are refused.';
      return auth.orSignedOut
        ? `${who} With neither, anyone may call, and gets less: see the summary.`
        : who;
    }
    case 'platform-admin':
      return 'A platform admin: a session, or an API key with the `admin` scope.';
    case 'workspace-admin': {
      const key = auth.apiKeyScope
        ? `, or an API key with the \`${auth.apiKeyScope}\` scope`
        : '; API keys are refused';
      const admin =
        auth.platformAdmin === 'entered'
          ? 'a platform admin who has entered this workspace'
          : 'a platform admin';
      return `An owner or admin of the workspace in the path, or ${admin}. A browser session${key}.`;
    }
  }
}

function security(auth: RouteAuth): JsonObject[] {
  switch (auth.who) {
    case 'anyone':
      return [];
    case 'platform-admin':
      return [{ session: [] }, { apiKey: ['admin'] }];
    case 'signed-in':
      // `{}`: no credential; a signed-out caller may call too, and gets less.
      return [
        ...(auth.apiKeyScope
          ? [{ session: [] }, { apiKey: [auth.apiKeyScope] }]
          : [{ session: [] }]),
        ...(auth.orSignedOut ? [{}] : []),
      ];
    case 'workspace-admin':
      return auth.apiKeyScope
        ? [{ session: [] }, { apiKey: [auth.apiKeyScope] }]
        : [{ session: [] }];
  }
}

/**
 * Why a caller who is signed in can still be refused. Every route that needs a
 * caller can answer 403: one that refuses API keys refuses them with it.
 */
function forbiddenNote(auth: Exclude<RouteAuth, { who: 'anyone' }>): string {
  const role =
    auth.who === 'signed-in'
      ? null
      : auth.who === 'platform-admin'
        ? 'not a platform admin'
        : 'not an admin of the workspace';
  const key =
    auth.who === 'platform-admin'
      ? 'an API key without the `admin` scope'
      : auth.apiKeyScope
        ? `an API key without the \`${auth.apiKeyScope}\` scope`
        : 'an API key, which this route refuses';
  return `\`FORBIDDEN\`: ${role ? `${role}, ` : ''}${key}, or a key or session whose workspace cannot be entered (suspended, or no longer theirs).`;
}

/** What `parameters()` reads of an object schema's JSON Schema. */
const objectSchemaShape = z.object({
  properties: z.record(z.string(), z.looseObject({})).default({}),
  required: z.array(z.string()).default([]),
});

/** The object schema's top-level properties as OpenAPI parameters. */
function parameters(schema: z.ZodType, where: 'path' | 'query'): JsonObject[] {
  const json = objectSchemaShape.parse(toSchema(schema, 'input'));
  const required = new Set(json.required);
  return Object.entries(json.properties).map(([name, s]) => ({
    name,
    in: where,
    required: where === 'path' || required.has(name),
    schema: s,
  }));
}

function operation(route: RouteContract): JsonObject {
  const { request, response, auth } = route;
  const params: JsonObject[] = [
    ...(request.params ? parameters(request.params, 'path') : []),
    ...(request.query ? parameters(request.query, 'query') : []),
  ];
  if (response.conditional) {
    params.push({
      name: 'If-None-Match',
      in: 'header',
      required: false,
      description: 'An `ETag` from an earlier answer: a 304 with no body if it still holds.',
      schema: { type: 'string' },
    });
  }

  const statuses = Array.isArray(response.status) ? response.status : [response.status];
  const responses: Record<string, JsonObject> = {};
  for (const status of statuses) {
    responses[String(status)] = {
      description: status === 202 ? 'Accepted.' : 'Success.',
      ...(response.conditional
        ? {
            headers: { ETag: { schema: { type: 'string' }, description: 'The answer’s version.' } },
          }
        : {}),
      content: successContent(route),
    };
  }
  if (response.conditional) {
    responses['304'] = {
      description: 'Not modified: `If-None-Match` holds the current `ETag`.',
      headers: { ETag: { schema: { type: 'string' } } },
    };
  }

  const paramsFail404 = request.params !== undefined && request.invalidParamsStatus === 404;
  const validated =
    (request.params !== undefined && !paramsFail404) ||
    request.query ||
    request.body ||
    request.upload;
  if (validated) responses['400'] = errorRef('`VALIDATION_ERROR`: the request does not parse.');
  if (auth.who !== 'anyone') {
    responses['401'] = errorRef(
      auth.who === 'signed-in' && auth.orSignedOut
        ? '`UNAUTHORIZED`: an API key that is not valid. `ACCOUNT_REQUIRED`: the body asks for something only an account may (a page or a file, on the quick scan). A caller with no credential at all is answered, with less.'
        : '`UNAUTHORIZED`: no caller.'
    );
    responses['403'] = errorRef(forbiddenNote(auth));
  }
  if (paramsFail404) {
    responses['404'] = errorRef('`NOT_FOUND`: the path names nothing, or does not parse.');
  }
  responses['429'] = errorRef('`RATE_LIMIT_EXCEEDED`: over the `/api/v1` rate limit.');
  for (const declared of route.errors ?? []) {
    const line = `\`${declared.code}\`: ${declared.description}`;
    const key = String(declared.status);
    const existing = responses[key]?.description;
    responses[key] = errorRef(typeof existing === 'string' ? `${existing} ${line}` : line);
  }
  responses.default = errorRef('Any other error, in the error envelope; `error.code` says which.');

  const note = authNote(auth);
  return {
    operationId: operationId(route),
    summary: route.summary,
    ...(note ? { description: note } : {}),
    tags: [tagOf(route.path)],
    security: security(auth),
    ...(params.length > 0 ? { parameters: params } : {}),
    ...(request.body || request.upload
      ? { requestBody: { required: true, content: requestContent(request) } }
      : {}),
    responses,
  };
}

/**
 * The request body's media types: the JSON body, and a file upload
 * (`multipart/form-data`, t-80) whose `options` part is JSON.
 */
function requestContent(request: RouteContract['request']): JsonObject {
  return {
    ...(request.body ? { 'application/json': { schema: toSchema(request.body, 'input') } } : {}),
    ...(request.upload
      ? {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                file: {
                  type: 'string',
                  contentMediaType: 'application/octet-stream',
                  description: "The file; its name's extension picks the reader.",
                },
                options: {
                  ...toSchema(request.upload, 'input'),
                  description: "The JSON body's other fields, as JSON.",
                },
              },
              required: ['file'],
            },
            encoding: { options: { contentType: 'application/json' } },
          },
        }
      : {}),
  };
}

/** `/api/v1/assessments/{id}/report.pdf` → `assessments`; `/api/v1/openapi.json` → `openapi`. */
function tagOf(path: string): string {
  const [first = '', second] = path.replace(/^\/api\/v1\//, '').split('/');
  return first === 'admin' && second ? `admin/${second}` : first.replace(/\.json$/, '');
}

/** `GET /api/v1/assessments/{id}/report.pdf` → `get_assessments_id_report_pdf`. */
export function operationId(route: Pick<RouteContract, 'method' | 'path'>): string {
  const rest = route.path
    .replace(/^\/api\/v1\//, '')
    .replace(/[{}]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_');
  return `${route.method.toLowerCase()}_${rest}`;
}

const ERROR_ENVELOPE: JsonSchema = {
  type: 'object',
  properties: {
    success: { const: false },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'A stable code, e.g. `VALIDATION_ERROR`.' },
        message: { type: 'string' },
        details: { type: 'object', additionalProperties: true },
      },
      required: ['code', 'message'],
    },
  },
  required: ['success', 'error'],
};

/** The document for `routes` (the routes served now, unless a test passes its own). */
export function buildOpenApiDocument(
  routes: readonly RouteContract[] = servedRoutes()
): OpenApiDocument {
  const paths: Record<string, Record<string, JsonObject>> = {};
  for (const route of routes) {
    const item = (paths[route.path] ??= {});
    item[route.method.toLowerCase()] = operation(route);
  }
  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: 'HowDoesThisLand API',
      version: API_VERSION,
      description:
        'Assess how a text lands with its reader. Generated from the route registry; every request schema is the one the server validates with, and every response schema describes what it sends. HEAD is answered on every GET, and is not listed.',
    },
    paths,
    components: {
      schemas: {
        Error: ERROR_ENVELOPE,
        // As input, so neither forbids a key it does not name: a result
        // stored by an earlier engine is served as it was stored.
        AssessmentContext: toSchema(engineContextSchema, 'input'),
        AssessmentResult: {
          ...toSchema(engineResultSchema, 'input'),
          description:
            "HowDoesThisLand's assembled assessment, as the current engine builds it. One stored by an earlier engine is served as it was stored, and may differ.",
        },
        SharedReportResult: {
          ...toSchema(reportResultSchema, 'output'),
          description:
            'The part of a result a shared report serves: what the report reads, and nothing else.',
        },
      },
      securitySchemes: {
        session: {
          type: 'apiKey',
          in: 'cookie',
          name: '__Secure-better-auth.session_token',
          description:
            'A browser session, set by signing in. Over plain HTTP (local development) the cookie is `better-auth.session_token`.',
        },
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description:
            'An API key (`Authorization: Bearer sk_…`). The requirement lists the scope the key must hold.',
        },
      },
    },
  };
}

let cached: { served: string; document: OpenApiDocument; etag: string } | null = null;

/**
 * The served routes' document and its `ETag`. The registry is fixed at build
 * time, but a switch (`RouteContract.enabled`) is read per call, so the
 * document is built again only when the set of routes served has changed.
 */
export function publishedOpenApi(): { document: OpenApiDocument; etag: string } {
  const routes = servedRoutes();
  const served = routes.map(operationId).join(' ');
  if (cached?.served !== served) {
    const document = buildOpenApiDocument(routes);
    cached = { served, document, etag: computeETag(document) };
  }
  return { document: cached.document, etag: cached.etag };
}

/** The served routes' document. */
export const openApiDocument = (): OpenApiDocument => publishedOpenApi().document;

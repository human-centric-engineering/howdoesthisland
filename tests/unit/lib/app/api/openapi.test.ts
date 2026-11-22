/**
 * Tests: the OpenAPI document generated from the route registry (t-44).
 *
 * The document is checked against the official OpenAPI 3.1 schema, vendored
 * at `tests/fixtures/openapi-3.1-schema.json` (the 2022-10-07 edition from
 * spec.openapis.org), with ajv's JSON Schema 2020-12 build. Each registry
 * property is then shown becoming what the document says, on a one-route
 * registry built for it.
 *
 * @see lib/app/api/openapi.ts
 */
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'test' as const,
  QUICK_SCAN_ENABLED: undefined as boolean | undefined,
}));
vi.mock('@/lib/env', () => ({ env: mockEnv }));

import {
  buildOpenApiDocument,
  openApiDocument,
  publishedOpenApi,
  operationId,
  type OpenApiDocument,
} from '@/lib/app/api/openapi';
import {
  APP_ROUTES,
  assessmentDetailSchema,
  ephemeralAssessmentSchema,
  sharedAssessmentSchema,
  type RouteAuth,
  type RouteContract,
} from '@/lib/app/api/registry';

// ─── Validity ────────────────────────────────────────────────────────────────

/**
 * The official schema, with its four `{"$dynamicRef": "#meta"}` read as the
 * `$ref` they resolve to. In this unextended edition `#meta` can only be its
 * own `$defs/schema`, so the two are the same check; ajv resolves the dynamic
 * form wrongly and fails a valid parameter's `schema` against the parameter
 * object itself. The count guards against a re-vendored file that changes it.
 */
function officialSchema(): Record<string, unknown> {
  const text = readFileSync('tests/fixtures/openapi-3.1-schema.json', 'utf8');
  const dynamic = /\{\s*"\$dynamicRef":\s*"#meta"\s*\}/g;
  expect(text.match(dynamic)).toHaveLength(4);
  const parsed: unknown = JSON.parse(text.replace(dynamic, '{ "$ref": "#/$defs/schema" }'));
  return z.looseObject({}).parse(parsed);
}

const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true });
const validateDocument = ajv.compile(officialSchema());

function errorsOf(doc: unknown): string[] {
  return validateDocument(doc)
    ? []
    : (validateDocument.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? ''}`);
}

/** Every value in `node` under a key named `key`, at any depth. */
function collect(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) node.forEach((n) => collect(n, key, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key) out.push(v);
      collect(v, key, out);
    }
  }
  return out;
}

/** The value at a `#/a/b` JSON pointer in `doc`, or `undefined`. */
function resolvePointer(doc: unknown, pointer: string): unknown {
  return pointer
    .replace(/^#\//, '')
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>(
      (at, part): unknown =>
        typeof at === 'object' && at !== null ? Reflect.get(at, part) : undefined,
      doc
    );
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The object at `pointer` in `doc` itself, to change in place. */
function objectAt(doc: unknown, pointer: string): Record<string, unknown> {
  const at = resolvePointer(doc, pointer);
  if (!isRecord(at)) throw new Error(`no object at ${pointer}`);
  return at;
}

const SLUG_GET = '#/paths/~1api~1v1~1frameworks~1{slug}/get';

describe('the document', () => {
  const doc = openApiDocument();

  it('is a valid OpenAPI 3.1 document', () => {
    expect(doc.openapi).toMatch(/^3\.1\.\d+$/);
    expect(errorsOf(doc)).toEqual([]);
  });

  it('fails the check when broken', () => {
    const noInfo: Record<string, unknown> = { ...doc };
    delete noInfo.info;
    expect(errorsOf(noInfo)).not.toEqual([]);

    // A response must say what it is.
    const undescribed = structuredClone(doc);
    delete objectAt(undescribed, `${SLUG_GET}/responses/200`).description;
    expect(errorsOf(undescribed)).not.toEqual([]);

    // A path parameter must be required.
    const optionalPath = structuredClone(doc);
    objectAt(optionalPath, `${SLUG_GET}/parameters/0`).required = false;
    expect(errorsOf(optionalPath)).not.toEqual([]);

    // A path must start with `/`.
    const unrooted = structuredClone(doc);
    unrooted.paths['api/v1/nowhere'] = {};
    expect(errorsOf(unrooted)).not.toEqual([]);
  });

  it('lists every registry route, and no other', () => {
    const listed = Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.keys(item).map((m) => `${m.toUpperCase()} ${path}`)
    );
    expect(listed.sort()).toEqual(APP_ROUTES.map((r) => `${r.method} ${r.path}`).sort());
  });

  it('gives each operation a unique id', () => {
    const ids = collect(doc.paths, 'operationId');
    expect(new Set(ids).size).toBe(APP_ROUTES.length);
    expect(operationId({ method: 'GET', path: '/api/v1/assessments/{id}/report.pdf' })).toBe(
      'get_assessments_id_report_pdf'
    );
  });

  it('resolves every $ref inside itself', () => {
    const refs = collect(doc, '$ref');
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) {
      expect(typeof r === 'string' && r.startsWith('#/'), String(r)).toBe(true);
      expect(resolvePointer(doc, String(r)), String(r)).toBeDefined();
    }
  });

  it('carries only valid JSON Schema 2020-12 schemas', () => {
    const schemas = [
      ...collect(doc.paths, 'schema'),
      ...collect(doc.paths, 'x-event-schema'),
      ...Object.values(doc.components.schemas as Record<string, unknown>),
    ];
    for (const s of schemas) {
      expect(ajv.validateSchema(z.looseObject({}).parse(s)), ajv.errorsText()).toBe(true);
    }
  });
});

// ─── Each registry property ──────────────────────────────────────────────────

const ok = { status: 200, data: z.object({ ok: z.boolean() }) } as const;

function route(over: Partial<RouteContract> = {}): RouteContract {
  return {
    method: 'GET',
    path: '/api/v1/things/{id}',
    summary: 'A thing.',
    auth: { who: 'anyone' },
    request: { params: z.object({ id: z.string().min(1) }) },
    response: ok,
    ...over,
  };
}

/** The one operation a one-route document holds, as plain JSON. */
function opOf(r: RouteContract): Record<string, unknown> {
  const doc: OpenApiDocument = buildOpenApiDocument([r]);
  expect(errorsOf(doc)).toEqual([]);
  const op = doc.paths[r.path]?.[r.method.toLowerCase()];
  if (!op) throw new Error('no operation');
  return op;
}

const responsesOf = (r: RouteContract) =>
  z.record(z.string(), z.looseObject({})).parse(opOf(r).responses);

describe('what each registry property becomes', () => {
  it('params: required path parameters, and a 400 when they fail', () => {
    const op = opOf(route());
    expect(op.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 1 } },
    ]);
    expect(Object.keys(responsesOf(route()))).toContain('400');
    expect(Object.keys(responsesOf(route()))).not.toContain('404');
  });

  it('invalidParamsStatus: 404 answers a bad path, not 400', () => {
    const r = route({
      request: { params: z.object({ id: z.string() }), invalidParamsStatus: 404 },
    });
    const keys = Object.keys(responsesOf(r));
    expect(keys).toContain('404');
    expect(keys).not.toContain('400');
  });

  it('query: parameters, required only where the schema has no default', () => {
    const r = route({
      path: '/api/v1/things',
      request: {
        query: z.object({
          page: z.coerce.number().int().default(1),
          q: z.string(),
        }),
      },
    });
    const params = z.array(z.looseObject({})).parse(opOf(r).parameters);
    expect(params.map((p) => [p.name, p.in, p.required])).toEqual([
      ['page', 'query', false],
      ['q', 'query', true],
    ]);
    expect(Object.keys(responsesOf(r))).toContain('400');
  });

  // As input: a default makes the field optional, and an unknown key is
  // stripped rather than refused, so neither `required` nor
  // `additionalProperties: false` is said.
  it("body: a JSON request body, as the schema's input", () => {
    const r = route({
      method: 'POST',
      path: '/api/v1/things',
      request: { body: z.object({ n: z.number().default(3) }) },
    });
    expect(opOf(r).requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { n: { type: 'number', default: 3 } },
          },
        },
      },
    });
  });

  it('data and meta: the success envelope', () => {
    const r = route({ response: { ...ok, meta: z.object({ total: z.number() }) } });
    expect(responsesOf(r)['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            properties: {
              success: { const: true },
              data: { type: 'object', properties: { ok: { type: 'boolean' } } },
              meta: { type: 'object', properties: { total: { type: 'number' } } },
            },
            required: ['success', 'data', 'meta'],
          },
        },
      },
    });
  });

  it('multi-status: each status, with the same body', () => {
    const r = route({ method: 'POST', response: { ...ok, status: [200, 202] } });
    const responses = responsesOf(r);
    expect(responses['200']?.content).toBeDefined();
    expect(responses['202']?.content).toEqual(responses['200']?.content);
  });

  it('conditional: If-None-Match, an ETag on the answer, and a 304', () => {
    const r = route({ response: { ...ok, conditional: true } });
    const params = z.array(z.looseObject({})).parse(opOf(r).parameters);
    expect(params).toContainEqual(
      expect.objectContaining({ name: 'If-None-Match', in: 'header', required: false })
    );
    const responses = responsesOf(r);
    expect(responses['200']?.headers).toHaveProperty('ETag');
    expect(responses['304']).toMatchObject({ headers: { ETag: { schema: { type: 'string' } } } });
    expect(responses['304']).not.toHaveProperty('content');

    const plain = responsesOf(route());
    expect(plain['304']).toBeUndefined();
    expect(plain['200']?.headers).toBeUndefined();
  });

  it("stream 'sse': text/event-stream, its events' schema alongside", () => {
    const r = route({
      response: { status: 200, data: z.object({ type: z.literal('tick') }), stream: 'sse' },
    });
    expect(responsesOf(r)['200']?.content).toEqual({
      'text/event-stream': {
        schema: { type: 'string', description: 'Server-Sent Events.' },
        'x-event-schema': {
          type: 'object',
          properties: { type: { type: 'string', const: 'tick' } },
          required: ['type'],
          additionalProperties: false,
        },
      },
    });
  });

  it('file: that media type, the bytes its schema, no envelope', () => {
    const r = route({
      response: {
        status: 200,
        data: z.string().meta({ format: 'binary' }),
        file: 'application/pdf',
      },
    });
    expect(responsesOf(r)['200']?.content).toEqual({
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    });
  });

  it('envelope false: data is the body', () => {
    const r = route({ response: { ...ok, envelope: false } });
    expect(responsesOf(r)['200']?.content).toEqual({
      'application/json': {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
      },
    });
  });

  it('errors: a response per declared status, joined to one already there', () => {
    const responses = responsesOf(
      route({
        errors: [
          { status: 402, code: 'BUDGET_EXCEEDED', description: 'Over budget.' },
          { status: 429, code: 'WORKSPACE_BUSY', description: 'Full.' },
        ],
      })
    );
    expect(responses['402']).toEqual({
      description: '`BUDGET_EXCEEDED`: Over budget.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    });
    expect(responses['429']?.description).toBe(
      '`RATE_LIMIT_EXCEEDED`: over the `/api/v1` rate limit. `WORKSPACE_BUSY`: Full.'
    );
  });

  it("lists POST assessments' 402s: the credit refusal (t-58), then the budget's (t-49)", () => {
    const op = openApiDocument().paths['/api/v1/assessments']?.post;
    const responses = z.record(z.string(), z.looseObject({})).parse(op?.responses);
    expect(responses['402']?.description).toMatch(
      /^`INSUFFICIENT_CREDITS`: .* `BUDGET_EXCEEDED`: /s
    );
  });

  it('every route: a 429, and the error envelope by default', () => {
    const responses = responsesOf(route());
    for (const code of ['429', 'default']) {
      expect(responses[code]).toMatchObject({
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      });
    }
  });
});

describe('what each auth kind becomes', () => {
  const cases: [string, RouteAuth, unknown[], string[], RegExp | null][] = [
    ['anyone', { who: 'anyone' }, [], [], null],
    [
      'signed-in, sessions only (a key is refused with 403)',
      { who: 'signed-in', apiKeyScope: null },
      [{ session: [] }],
      ['401', '403'],
      /API keys are refused/,
    ],
    [
      'signed-in, or a key with a scope',
      { who: 'signed-in', apiKeyScope: 'assess' },
      [{ session: [] }, { apiKey: ['assess'] }],
      ['401', '403'],
      /`assess` scope/,
    ],
    [
      'signed-in, a key with a scope, or signed out for less (the quick scan)',
      { who: 'signed-in', apiKeyScope: 'assess', orSignedOut: true },
      [{ session: [] }, { apiKey: ['assess'] }, {}],
      ['401', '403'],
      /`assess` scope\. With neither, anyone may call, and gets less/,
    ],
    [
      'workspace-admin, platform admins anywhere',
      { who: 'workspace-admin', apiKeyScope: null, platformAdmin: 'anywhere' },
      [{ session: [] }],
      ['401', '403'],
      /owner or admin of the workspace in the path, or a platform admin\./,
    ],
    [
      'workspace-admin, platform admins once entered',
      { who: 'workspace-admin', apiKeyScope: null, platformAdmin: 'entered' },
      [{ session: [] }],
      ['401', '403'],
      /a platform admin who has entered this workspace/,
    ],
    [
      'platform-admin',
      { who: 'platform-admin' },
      [{ session: [] }, { apiKey: ['admin'] }],
      ['401', '403'],
      /platform admin/,
    ],
  ];

  it('says a route open to signed-out callers answers a bad key 401, and no credential with less', () => {
    const open = responsesOf(
      route({ auth: { who: 'signed-in', apiKeyScope: 'assess', orSignedOut: true } })
    );
    expect(open['401']?.description).toMatch(/^`UNAUTHORIZED`: an API key that is not valid\./);
    expect(open['401']?.description).toContain('no credential at all is answered, with less');
    const closed = responsesOf(route({ auth: { who: 'signed-in', apiKeyScope: 'assess' } }));
    expect(closed['401']?.description).toMatch(/^`UNAUTHORIZED`/);
  });

  it('says why a session-only route answers 403', () => {
    const responses = responsesOf(route({ auth: { who: 'signed-in', apiKeyScope: null } }));
    expect(responses['403']?.description).toMatch(/an API key, which this route refuses/);
    // The guard also refuses a caller whose workspace it cannot enter.
    expect(responses['403']?.description).toMatch(/whose workspace cannot be entered/);
  });

  it.each(cases)('%s', (_name, auth, security, statuses, note) => {
    const r = route({ auth });
    const op = opOf(r);
    expect(op.security).toEqual(security);
    const keys = Object.keys(responsesOf(r));
    for (const s of ['401', '403']) {
      expect(keys.includes(s), s).toBe(statuses.includes(s));
    }
    if (note) expect(op.description).toMatch(note);
    else expect(op.description).toBeUndefined();
  });

  it('declares the two schemes the requirements name', () => {
    const schemes = buildOpenApiDocument([]).components.securitySchemes;
    expect(schemes).toMatchObject({
      // The name it has over HTTPS, as every deployment serves it.
      session: { type: 'apiKey', in: 'cookie', name: '__Secure-better-auth.session_token' },
      apiKey: { type: 'http', scheme: 'bearer' },
    });
  });
});

describe("an assessment's context and result", () => {
  const doc = openApiDocument();
  const RESULT = { $ref: '#/components/schemas/AssessmentResult' };
  const CONTEXT = { $ref: '#/components/schemas/AssessmentContext' };

  const asSchema = (s: z.ZodType) =>
    z
      .looseObject({ properties: z.record(z.string(), z.unknown()) })
      .parse(
        resolvePointer(
          buildOpenApiDocument([route({ response: { status: 200, data: s } })]),
          '#/paths/~1api~1v1~1things~1{id}/get/responses/200/content/application~1json/schema/properties/data'
        )
      ).properties;

  it("a stored assessment's: HowDoesThisLand's, the result null until final", () => {
    const props = asSchema(assessmentDetailSchema);
    expect(props.context).toEqual(CONTEXT);
    expect(props.result).toEqual({
      anyOf: [RESULT, { type: 'null' }],
      description: '`null` until the assessment is final.',
    });
  });

  it("a run kept nowhere's: always there", () => {
    const props = asSchema(ephemeralAssessmentSchema);
    expect(props.context).toEqual(CONTEXT);
    expect(props.result).toEqual(RESULT);
  });

  it("a shared report's: only what the report reads", () => {
    const props = asSchema(sharedAssessmentSchema);
    expect(props.result).toEqual({ $ref: '#/components/schemas/SharedReportResult' });
    expect(props).not.toHaveProperty('context');
  });

  it('documents both as components', () => {
    const schemas = z.record(z.string(), z.looseObject({})).parse(doc.components.schemas);
    expect(schemas.AssessmentContext).toMatchObject({
      type: 'object',
      required: ['contentType', 'archetype', 'audience'],
    });
    expect(schemas.AssessmentResult).toMatchObject({
      type: 'object',
      properties: { editor: { oneOf: expect.any(Array) } },
    });
    expect(schemas.SharedReportResult).toMatchObject({ type: 'object' });
  });

  // Nothing checks a stored result on the way out, and an older one may hold
  // a key the current engine does not write.
  it('forbids no key the context or result schema does not name', () => {
    const schemas = z.record(z.string(), z.unknown()).parse(doc.components.schemas);
    for (const name of ['AssessmentContext', 'AssessmentResult']) {
      expect(collect(schemas[name], 'additionalProperties'), name).not.toContain(false);
    }
  });

  it('leaves no assessment route with an open context or result', () => {
    const text = JSON.stringify(doc.paths);
    expect(text).not.toMatch(/"(context|result)":\{\}/);
  });
});

describe('a route behind a switch (t-61)', () => {
  const SCAN = 'POST /api/v1/scan';
  const listed = (doc: OpenApiDocument) =>
    Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.keys(item).map((m) => `${m.toUpperCase()} ${path}`)
    );

  it('the quick scan is the one switchable route, on the quick-scan switch', () => {
    const switchable = APP_ROUTES.filter((r) => r.enabled).map((r) => `${r.method} ${r.path}`);
    expect(switchable).toEqual([SCAN]);
  });

  it('is published while its switch is on, and left out while it is off, with a new ETag', () => {
    mockEnv.QUICK_SCAN_ENABLED = true;
    const on = publishedOpenApi();
    expect(listed(on.document)).toContain(SCAN);
    expect(listed(openApiDocument())).toContain(SCAN);

    mockEnv.QUICK_SCAN_ENABLED = false;
    const off = publishedOpenApi();
    expect(listed(off.document)).not.toContain(SCAN);
    expect(listed(off.document)).toHaveLength(APP_ROUTES.length - 1);
    expect(off.etag).not.toBe(on.etag);
    expect(errorsOf(off.document)).toEqual([]);

    mockEnv.QUICK_SCAN_ENABLED = true;
    expect(publishedOpenApi().etag).toBe(on.etag);
    mockEnv.QUICK_SCAN_ENABLED = undefined;
  });
});

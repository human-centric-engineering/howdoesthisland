/**
 * The developer docs' reading of the generated OpenAPI document (t-45).
 *
 * `/developers` renders its reference from `openApiDocument()`
 * (`lib/app/api/openapi.ts`), the same document `GET /api/v1/openapi.json`
 * serves, so the page cannot show a route the document does not have. The
 * document is typed as open JSON, so the parts the page reads are parsed
 * here rather than cast; anything else in it is left alone.
 */
import { z } from 'zod';
import type { OpenApiDocument } from '@/lib/app/api/openapi';

/** A JSON Schema node, read loosely: the renderer picks out what it shows. */
export type JsonSchemaNode = Record<string, unknown>;

const schemaNode = z.record(z.string(), z.unknown());

const parameterSchema = z.object({
  name: z.string(),
  in: z.enum(['path', 'query', 'header', 'cookie']),
  required: z.boolean().default(false),
  description: z.string().optional(),
  schema: schemaNode.default({}),
});

const mediaSchema = z.object({
  schema: schemaNode.default({}),
  /** An event stream's payload: each event's `data` (`lib/app/api/openapi.ts`). */
  'x-event-schema': schemaNode.optional(),
});

const responseSchema = z.object({
  description: z.string().default(''),
  content: z.record(z.string(), mediaSchema).optional(),
});

const operationSchema = z.object({
  operationId: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  security: z.array(z.record(z.string(), z.array(z.string()))).default([]),
  parameters: z.array(parameterSchema).default([]),
  requestBody: z
    .object({ content: z.record(z.string(), mediaSchema) })
    .optional()
    .transform((body) => body?.content['application/json']?.schema ?? null),
  responses: z.record(z.string(), responseSchema),
});

/** The methods OpenAPI names in a path item, in the order the page lists them. */
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export type Parameter = z.infer<typeof parameterSchema>;
export type Response = z.infer<typeof responseSchema>;

/** One operation as the page shows it. */
export interface Operation {
  method: Uppercase<(typeof METHODS)[number]>;
  path: string;
  operationId: string;
  summary: string;
  /** Who may call it, in words, when the document says. */
  description: string | null;
  tag: string;
  /** No caller needed. */
  anonymous: boolean;
  /** A browser session is accepted. */
  session: boolean;
  /** The scope an API key needs, or `null` when keys are refused. */
  apiKeyScope: string | null;
  parameters: Parameter[];
  requestBody: JsonSchemaNode | null;
  responses: [status: string, response: Response][];
}

/** Every operation in the document, in the document's order. */
export function readOperations(doc: OpenApiDocument): Operation[] {
  const operations: Operation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const raw = item[method];
      if (raw === undefined) continue;
      const op = operationSchema.parse(raw);
      const keyed = op.security.find((req) => 'apiKey' in req);
      operations.push({
        method: method.toUpperCase() as Operation['method'],
        path,
        operationId: op.operationId,
        summary: op.summary,
        description: op.description ?? null,
        tag: op.tags[0] ?? 'other',
        anonymous: op.security.length === 0,
        session: op.security.some((req) => 'session' in req),
        apiKeyScope: keyed?.apiKey[0] ?? null,
        parameters: op.parameters,
        requestBody: op.requestBody,
        responses: Object.entries(op.responses),
      });
    }
  }
  return operations;
}

/** Operations grouped by their tag, groups in first-seen order. */
export function groupByTag(operations: readonly Operation[]): [tag: string, Operation[]][] {
  const groups = new Map<string, Operation[]>();
  for (const op of operations) {
    const group = groups.get(op.tag) ?? [];
    group.push(op);
    groups.set(op.tag, group);
  }
  return [...groups.entries()];
}

/** The document's named schemas (`components.schemas`), parsed. */
export function readComponentSchemas(doc: OpenApiDocument): [name: string, JsonSchemaNode][] {
  const parsed = z
    .object({ schemas: z.record(z.string(), schemaNode).default({}) })
    .safeParse(doc.components);
  return parsed.success ? Object.entries(parsed.data.schemas) : [];
}

/** The anchor an operation's entry has on the page. */
export const operationAnchor = (operationId: string): string => `op-${operationId}`;

/** The anchor a named schema's entry has on the page. */
export const componentAnchor = (name: string): string => `schema-${name}`;

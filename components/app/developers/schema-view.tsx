/**
 * A JSON Schema from the generated OpenAPI document, as a nested field list
 * (t-45). Server-rendered with no script: the reference is our own markup
 * rather than a third-party renderer's.
 *
 * It shows what a caller needs to send or read: each field's name, type,
 * whether it is required, its description and its limits. A `$ref` to one of
 * the document's named schemas links to that schema's entry on the page
 * rather than repeating it. Nesting stops at {@link MAX_DEPTH}, which no
 * schema in the document reaches today; a deeper one says so rather than
 * rendering without end.
 */
import { z } from 'zod';
import { Prose } from '@/components/app/developers/prose';
import { componentAnchor, type JsonSchemaNode } from '@/components/app/developers/operations';

const MAX_DEPTH = 8;

const node = z.record(z.string(), z.unknown());
const nodes = z.array(node);
const strings = z.array(z.string());

/** What a node says about itself, read without casting. */
function read(schema: JsonSchemaNode) {
  const str = (key: string) => {
    const v = schema[key];
    return typeof v === 'string' ? v : null;
  };
  const num = (key: string) => {
    const v = schema[key];
    return typeof v === 'number' ? v : null;
  };
  const props = node.safeParse(schema.properties);
  const items = node.safeParse(schema.items);
  const variants = nodes.safeParse(schema.anyOf ?? schema.oneOf);
  const required = strings.safeParse(schema.required);
  const type = schema.type;
  return {
    ref: str('$ref'),
    type: typeof type === 'string' ? type : (strings.safeParse(type).data?.join(' | ') ?? null),
    description: str('description'),
    format: str('format'),
    enumValues: Array.isArray(schema.enum) ? schema.enum : null,
    hasConst: 'const' in schema,
    constValue: schema.const,
    hasDefault: 'default' in schema,
    defaultValue: schema.default,
    minimum: num('minimum'),
    maximum: num('maximum'),
    minLength: num('minLength'),
    maxLength: num('maxLength'),
    minItems: num('minItems'),
    maxItems: num('maxItems'),
    properties: props.success
      ? Object.entries(props.data).map(([k, v]) => [k, node.safeParse(v).data ?? {}] as const)
      : null,
    additional: node.safeParse(schema.additionalProperties).data ?? null,
    items: items.success ? items.data : null,
    variants: variants.success ? variants.data : null,
    nullableOf: variants.success ? nullableOf(variants.data) : null,
    pattern: str('pattern'),
    exclusiveMinimum: num('exclusiveMinimum'),
    exclusiveMaximum: num('exclusiveMaximum'),
    required: new Set(required.success ? required.data : []),
  };
}

/**
 * `X` when the variants are `X` or `null`, as zod writes every `.nullable()`:
 * shown as `X | null` rather than as two options.
 */
function nullableOf(variants: JsonSchemaNode[]): JsonSchemaNode | null {
  if (variants.length !== 2) return null;
  const isNull = (v: JsonSchemaNode) => v.type === 'null' && Object.keys(v).length === 1;
  const others = variants.filter((v) => !isNull(v));
  return others.length === 1 ? others[0] : null;
}

/**
 * zod writes every `.int()` with ±`Number.MAX_SAFE_INTEGER` as its bounds,
 * which say nothing to a reader: those are left out.
 */
const bound = (n: number | null): number | null =>
  n === null || Math.abs(n) >= Number.MAX_SAFE_INTEGER ? null : n;

const json = (value: unknown): string => JSON.stringify(value);

/** `#/components/schemas/AssessmentResult` → `AssessmentResult`. */
const refName = (ref: string): string => ref.replace(/^#\/components\/schemas\//, '');

/** A one-line type: `string`, `array of object`, `"queued" | "running"`. */
function typeLabel(schema: JsonSchemaNode): string {
  const s = read(schema);
  if (s.ref) return refName(s.ref);
  if (s.hasConst) return json(s.constValue);
  if (s.enumValues) return s.enumValues.map(json).join(' | ');
  if (s.nullableOf) return `${typeLabel(s.nullableOf)} | null`;
  if (s.variants) return 'one of';
  if (s.type === 'array') return s.items ? `array of ${typeLabel(s.items)}` : 'array';
  if (s.type === 'object' && !s.properties && s.additional) {
    return `map of ${typeLabel(s.additional)}`;
  }
  return s.type ?? 'any';
}

/** Limits and defaults, in words. */
function constraints(schema: JsonSchemaNode): string[] {
  const s = read(schema);
  const out: string[] = [];
  if (s.format) out.push(s.format);
  const range = (min: number | null, max: number | null, unit: string) => {
    if (min !== null && max !== null) out.push(`${min}–${max}${unit}`);
    else if (min !== null) out.push(`≥ ${min}${unit}`);
    else if (max !== null) out.push(`≤ ${max}${unit}`);
  };
  range(bound(s.minimum), bound(s.maximum), '');
  if (s.exclusiveMinimum !== null) out.push(`> ${s.exclusiveMinimum}`);
  if (s.exclusiveMaximum !== null) out.push(`< ${s.exclusiveMaximum}`);
  range(s.minLength, s.maxLength, ' chars');
  range(s.minItems, s.maxItems, ' items');
  if (s.pattern) out.push(`pattern ${s.pattern}`);
  if (s.hasDefault) out.push(`default ${json(s.defaultValue)}`);
  return out;
}

/** The schema's own children: an object's fields, an array's item, a union's variants. */
function Children({ schema, depth }: { schema: JsonSchemaNode; depth: number }) {
  const s = read(schema);
  if (depth >= MAX_DEPTH) {
    return <p className="text-muted-foreground text-xs">Nested further; see the JSON document.</p>;
  }
  if (s.properties && s.properties.length > 0) {
    return (
      <ul className="space-y-2 border-l pl-4">
        {s.properties.map(([name, child]) => (
          <Field
            key={name}
            name={name}
            schema={child}
            required={s.required.has(name)}
            depth={depth + 1}
          />
        ))}
      </ul>
    );
  }
  if (s.nullableOf) return <Children schema={s.nullableOf} depth={depth} />;
  if (s.variants) {
    return (
      <ol className="space-y-2 border-l pl-4">
        {s.variants.map((variant, i) => (
          <Field key={i} name={`option ${i + 1}`} schema={variant} depth={depth + 1} />
        ))}
      </ol>
    );
  }
  const inner = s.type === 'array' ? s.items : s.type === 'object' ? s.additional : null;
  if (inner) {
    const ri = read(inner);
    if (ri.properties || ri.variants) return <Children schema={inner} depth={depth + 1} />;
  }
  return null;
}

/** The named schema a type links to: its own `$ref`, an array's, or a nullable's. */
function linkedRef(schema: JsonSchemaNode): string | null {
  const s = read(schema);
  if (s.ref) return s.ref;
  if (s.type === 'array' && s.items) return linkedRef(s.items);
  return s.nullableOf ? linkedRef(s.nullableOf) : null;
}

function TypeText({ schema }: { schema: JsonSchemaNode }) {
  const target = linkedRef(schema);
  const label = typeLabel(schema);
  if (!target) return <span className="text-muted-foreground font-mono text-xs">{label}</span>;
  return (
    <a
      href={`#${componentAnchor(refName(target))}`}
      className="font-mono text-xs underline underline-offset-2"
    >
      {label}
    </a>
  );
}

function Field({
  name,
  schema,
  required = false,
  depth,
}: {
  name: string;
  schema: JsonSchemaNode;
  required?: boolean;
  depth: number;
}) {
  const s = read(schema);
  const limits = constraints(schema);
  return (
    <li>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <code className="text-sm font-medium">{name}</code>
        <TypeText schema={schema} />
        {required ? <span className="text-xs text-(--hd-red)">required</span> : null}
        {limits.length > 0 ? (
          <span className="text-muted-foreground text-xs">{limits.join(' · ')}</span>
        ) : null}
      </div>
      {s.description ? (
        <p className="text-muted-foreground mt-0.5 text-sm">
          <Prose>{s.description}</Prose>
        </p>
      ) : null}
      <Children schema={schema} depth={depth} />
    </li>
  );
}

/** A whole schema: its type and description, then its fields. */
export function SchemaView({ schema }: { schema: JsonSchemaNode }) {
  const s = read(schema);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <TypeText schema={schema} />
        {constraints(schema).length > 0 ? (
          <span className="text-muted-foreground text-xs">{constraints(schema).join(' · ')}</span>
        ) : null}
      </div>
      {s.description ? (
        <p className="text-muted-foreground text-sm">
          <Prose>{s.description}</Prose>
        </p>
      ) : null}
      <Children schema={schema} depth={0} />
    </div>
  );
}

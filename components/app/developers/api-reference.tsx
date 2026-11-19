/**
 * The API reference on `/developers` (t-45): every operation in the generated
 * OpenAPI document, grouped by its tag, then the document's named schemas.
 *
 * Rendered from the document `openApiDocument()` builds, the one
 * `GET /api/v1/openapi.json` serves, so it lists exactly the routes the
 * document has. Our own server-rendered markup rather than a third-party
 * renderer: those load scripts from outside the site, which the CSP refuses,
 * and do not carry the brand.
 */
import type { OpenApiDocument } from '@/lib/app/api/openapi';
import {
  componentAnchor,
  groupByTag,
  operationAnchor,
  readComponentSchemas,
  readOperations,
  type Operation,
} from '@/components/app/developers/operations';
import { SchemaView } from '@/components/app/developers/schema-view';

/** Who may call an operation, in a few words. */
function callerLabel(op: Operation): string {
  if (op.anonymous) return 'No key needed';
  if (op.apiKeyScope) return `Key scope: ${op.apiKeyScope}`;
  return 'Browser session only';
}

function OperationEntry({ op }: { op: Operation }) {
  const success = op.responses.filter(([status]) => /^2\d\d$/.test(status));
  const failures = op.responses.filter(([status]) => !/^2\d\d$/.test(status));
  return (
    <article
      id={operationAnchor(op.operationId)}
      data-operation={`${op.method} ${op.path}`}
      className="scroll-mt-24 space-y-4 border-t pt-6"
    >
      <header className="space-y-1">
        <h4 className="flex flex-wrap items-baseline gap-x-3 font-mono text-sm">
          <span className="font-semibold">{op.method}</span>
          <span className="break-all">{op.path}</span>
        </h4>
        <p>{op.summary}</p>
        <p className="hd-slug">{callerLabel(op)}</p>
        {op.description ? <p className="text-muted-foreground text-sm">{op.description}</p> : null}
      </header>

      {op.parameters.length > 0 ? (
        <section className="space-y-2">
          <h5 className="text-sm font-semibold">Parameters</h5>
          <ul className="space-y-2">
            {op.parameters.map((p) => (
              <li key={`${p.in}:${p.name}`} className="text-sm">
                <code className="font-medium">{p.name}</code>{' '}
                <span className="text-muted-foreground text-xs">
                  in {p.in}
                  {p.required ? ' · required' : ''}
                </span>
                {p.description ? <p className="text-muted-foreground">{p.description}</p> : null}
                <div className="mt-1 pl-4">
                  <SchemaView schema={p.schema} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {op.requestBody ? (
        <section className="space-y-2">
          <h5 className="text-sm font-semibold">Request body</h5>
          <SchemaView schema={op.requestBody} />
        </section>
      ) : null}

      {success.map(([status, response]) => (
        <section key={status} className="space-y-2">
          <h5 className="text-sm font-semibold">
            {status} {response.description}
          </h5>
          {Object.entries(response.content ?? {}).map(([type, media]) => (
            <div key={type} className="space-y-1">
              <p className="text-muted-foreground font-mono text-xs">{type}</p>
              {media['x-event-schema'] ? (
                <>
                  <p className="text-muted-foreground text-sm">
                    Each event is named by its <code>type</code>; its <code>data</code> is:
                  </p>
                  <SchemaView schema={media['x-event-schema']} />
                </>
              ) : (
                <SchemaView schema={media.schema} />
              )}
            </div>
          ))}
        </section>
      ))}

      {failures.length > 0 ? (
        <section className="space-y-1">
          <h5 className="text-sm font-semibold">Other answers</h5>
          <dl className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1 text-sm">
            {failures.map(([status, response]) => (
              <div key={status} className="contents">
                <dt className="font-mono">{status}</dt>
                <dd className="text-muted-foreground">{response.description}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </article>
  );
}

export function ApiReference({ document }: { document: OpenApiDocument }) {
  const groups = groupByTag(readOperations(document));
  const schemas = readComponentSchemas(document);
  return (
    <div className="space-y-12">
      <nav aria-label="Routes" className="text-sm">
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {groups.flatMap(([, ops]) =>
            ops.map((op) => (
              <li key={op.operationId}>
                <a
                  href={`#${operationAnchor(op.operationId)}`}
                  className="font-mono text-xs hover:underline"
                >
                  {op.method} {op.path.replace(/^\/api\/v1/, '')}
                </a>
              </li>
            ))
          )}
        </ul>
      </nav>

      {groups.map(([tag, ops]) => (
        <section key={tag} className="space-y-6">
          <h3 className="hd-slug text-sm">{tag}</h3>
          {ops.map((op) => (
            <OperationEntry key={op.operationId} op={op} />
          ))}
        </section>
      ))}

      {schemas.length > 0 ? (
        <section className="space-y-6">
          <h3 className="hd-slug text-sm">Schemas</h3>
          {schemas.map(([name, schema]) => (
            <article
              key={name}
              id={componentAnchor(name)}
              className="scroll-mt-24 space-y-2 border-t pt-6"
            >
              <h4 className="font-mono text-sm font-semibold">{name}</h4>
              <SchemaView schema={schema} />
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}

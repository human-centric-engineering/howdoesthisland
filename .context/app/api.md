# The app's API contract

The API is the product (D12), so every route this app serves under `/api/v1/` is
declared in one place: `APP_ROUTES` in `lib/app/api/registry.ts`. `dp2` will
publish it as OpenAPI. Until then it is the contract that reviews and later
tasks read.

## What an entry says

| Field      | What goes in it                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `method`   | `GET`, `HEAD`, `OPTIONS`, `POST`, `PUT`, `PATCH` or `DELETE`, as the route file exports it.                                                                                                                                                                                                                                     |
| `path`     | The URL path, with each dynamic segment as `{name}`: `app/api/v1/frameworks/[slug]/route.ts` is `/api/v1/frameworks/{slug}`.                                                                                                                                                                                                    |
| `summary`  | One line, in the words a developer reading the docs would use.                                                                                                                                                                                                                                                                  |
| `auth`     | `{ who: 'anyone' }`; `{ who: 'signed-in', apiKeyScope }`; or `{ who: 'workspace-admin', apiKeyScope, platformAdmin }`, where `platformAdmin` is `'anywhere'` or `'entered'` (a platform admin must be acting in this workspace). `apiKeyScope` is the scope an API key needs, or `null` when the route wants a browser session. |
| `request`  | `params`, `query`, `body`: the Zod schemas the handler parses with, **imported, never restated**. The `params` object has one key per `{name}` in the path. A path that fails `params` answers 400 `VALIDATION_ERROR` unless `invalidParamsStatus` says otherwise: the framework routes set it to 404.                          |
| `response` | The success `status`; the Zod schemas of the envelope's `data` and (if sent) `meta`, as they are on the wire, where a `Date` is an ISO string; and `conditional: true` for a route that sends an `ETag` and answers a matching `If-None-Match` with 304.                                                                        |

Errors are not declared per entry. Every route answers the standard error envelope,
and its docblock lists its codes.

## Adding a route

1. Write the route file. Parse with a schema exported from a `lib/app/*` module, not one
   defined inline in the handler, so the registry can import the same object.
2. Add its entry to `APP_ROUTES`. Where the response is a type the service returns, give
   its schema a doc comment naming that type, and add a type assertion beside the others
   in `tests/unit/lib/app/api/registry.test.ts`. A `meta` type must be a `type`, not an
   `interface`, to stay assignable to the envelope's `Record<string, unknown>`.
3. A route in a **new** directory under `app/api/v1/` (t-24's `scan/` and `assessments/`)
   also needs that directory added to `APP_ROUTE_DIRS` in the same test. Until it is, the
   test fails: every directory there must be in `APP_ROUTE_DIRS` or `CORE_ROUTE_DIRS`.

An app route goes in an app directory, never inside one of core's: the scan does not
look inside `CORE_ROUTE_DIRS`, so a route added under, say, `app/api/v1/orgs/` would go
undeclared.

## What keeps it honest

`tests/unit/lib/app/api/registry.test.ts`:

- fails for a directory directly under `app/api/v1/` in neither `APP_ROUTE_DIRS` nor
  `CORE_ROUTE_DIRS`. An upstream sync that adds a core directory lands here: add it to
  `CORE_ROUTE_DIRS`;
- reads every route file under the app's directories **as text** and fails when a file
  exports a method the registry does not declare, when the registry declares one no file
  exports, or when an entry is declared twice. A method exported in a form the scan
  cannot read (`export { GET }`, `export const { GET } = …`, `export * from …`) is refused;
- fails when an entry's `params` keys differ from the `{name}` segments of its path;
- holds each response schema to its service type with `expectTypeOf`, so a field
  added to a service's return type and not to the schema fails `npm run type-check`.
  The two bodies a handler builds inline (the invitation's 202 and the decline) have no
  service type, so they are checked by reading the handler.

Not in scope here: generating OpenAPI (`dp2`).

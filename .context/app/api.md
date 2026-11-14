# The app's API contract

The API is the product (D12), so every route this app serves under `/api/v1/` is
declared in one place: `APP_ROUTES` in `lib/app/api/registry.ts`. `dp2` will
publish it as OpenAPI. Until then it is the contract that reviews and later
tasks read.

## What an entry says

| Field      | What goes in it                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `method`   | `GET`, `POST`, `PUT`, `PATCH` or `DELETE`, as the route file exports it.                                                                                          |
| `path`     | The URL path, with each dynamic segment as `{name}`: `app/api/v1/frameworks/[slug]/route.ts` is `/api/v1/frameworks/{slug}`.                                      |
| `summary`  | One line, in the words a developer reading the docs would use.                                                                                                    |
| `auth`     | `{ who: 'anyone' }`, or `who: 'signed-in' \| 'workspace-admin'` with `apiKeyScope`: the scope an API key needs, or `null` when the route wants a browser session. |
| `request`  | `params`, `query`, `body`: the Zod schemas the handler parses with, **imported, never restated**. The `params` object has one key per `{name}` in the path.       |
| `response` | The success `status`, and the Zod schemas of the envelope's `data` and (if sent) `meta`, as they are on the wire. A `Date` is an ISO string.                      |

Errors are not declared per entry. Every route answers the standard error envelope,
and its docblock lists its codes.

## Adding a route

1. Write the route file. Parse with a schema exported from a `lib/app/*` module, not one
   defined inline in the handler, so the registry can import the same object.
2. Add its entry to `APP_ROUTES`. Where the response is a type the service returns, give
   its schema a doc comment naming that type, and add a type assertion beside the others
   in `tests/unit/lib/app/api/registry.test.ts`.
3. A route in a **new** directory under `app/api/v1/` (t-24's `scan/` and `assessments/`)
   also needs that directory added to `APP_ROUTE_DIRS` in the same test. Core's
   directories are not the app's to declare.

## What keeps it honest

`tests/unit/lib/app/api/registry.test.ts`:

- reads every `route.ts` under the app's route directories **as text** and fails when a
  file exports a method the registry does not declare, when the registry declares one
  no file exports, or when an entry is declared twice. A route file that re-exports a
  method (`export { GET }`) is refused, because the scan cannot read it;
- fails when an entry's `params` keys differ from the `{name}` segments of its path;
- holds each response schema to its service type with `expectTypeOf`, so a field
  added to a service's return type and not to the schema fails `npm run type-check`.

Not in scope here: generating OpenAPI (`dp2`).

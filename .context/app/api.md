# The app's API contract

The API is the product (D12), so every route this app serves under `/api/v1/` is
declared in one place: `APP_ROUTES` in `lib/app/api/registry.ts`, and published from
there as OpenAPI 3.1 at `GET /api/v1/openapi.json` (see [The OpenAPI document](#the-openapi-document)).

## What an entry says

| Field      | What goes in it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`  | Optional: a switch read per call. While it answers `false`, `servedRoutes()`, the OpenAPI document and `/developers` leave the route out. It does not gate the handler, which checks the same switch and answers 404. Only the quick scan has one (t-61).                                                                                                                                                                                                                                                                                                                     |
| `method`   | `GET`, `HEAD`, `OPTIONS`, `POST`, `PUT`, `PATCH` or `DELETE`, as the route file exports it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `path`     | The URL path, with each dynamic segment as `{name}`: `app/api/v1/frameworks/[slug]/route.ts` is `/api/v1/frameworks/{slug}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `summary`  | One line, in the words a developer reading the docs would use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `auth`     | `{ who: 'anyone' }`; `{ who: 'platform-admin' }` (`withAdminAuth`: a session or an `admin`-scoped key); `{ who: 'signed-in', apiKeyScope }`, with `orSignedOut: true` where a caller with neither may call too and gets less (the quick scan's scores, t-68); or `{ who: 'workspace-admin', apiKeyScope, platformAdmin }`, where `platformAdmin` is `'anywhere'` or `'entered'` (a platform admin must be acting in this workspace). `apiKeyScope` is the scope an API key needs, or `null` when the route wants a browser session.                                           |
| `request`  | `params`, `query`, `body`: the Zod schemas the handler parses with, **imported, never restated**. The `params` object has one key per `{name}` in the path. A path that fails `params` answers 400 `VALIDATION_ERROR` unless `invalidParamsStatus` says otherwise: the framework routes set it to 404.                                                                                                                                                                                                                                                                        |
| `response` | The success `status`, or a list of them when one route answers several with the same `data` (`POST assessments`: `[200, 202]`); the Zod schemas of the envelope's `data` and (if sent) `meta`, as they are on the wire, where a `Date` is an ISO string; `conditional: true` for a route that sends an `ETag` and answers a matching `If-None-Match` with 304; `stream: 'sse'` for a Server-Sent Events route, whose `data` is each event's payload; `file` for a download of that media type; and `envelope: false` for a body that is `data` itself (the OpenAPI document). |

Errors are not declared per entry. Every route answers the standard error envelope,
and its docblock lists its codes.

## Adding a route

1. Write the route file. Parse with a schema exported from a `lib/app/*` module, not one
   defined inline in the handler, so the registry can import the same object.
2. Add its entry to `APP_ROUTES`. Where the response is a type the service returns, give
   its schema a doc comment naming that type, and add a type assertion beside the others
   in `tests/unit/lib/app/api/registry.test.ts`. A `meta` type must be a `type`, not an
   `interface`, to stay assignable to the envelope's `Record<string, unknown>`.
3. A route in a **new** directory under `app/api/v1/` also needs that directory added to
   `APP_ROUTE_DIRS` in the same test. Until it is, the
   test fails: every directory there must be in `APP_ROUTE_DIRS` or `CORE_ROUTE_DIRS`.

An app route goes in an app directory. The scan does not look inside `CORE_ROUTE_DIRS`,
so a route added under, say, `app/api/v1/orgs/` would go undeclared. The one exception
is the app's admin routes, which sit under core's `admin/` so they share the `/api/v1/admin`
rate-limit section and URL space. Each of them gets its own subdirectory, listed by path
in `APP_ROUTE_DIRS` (`admin/frameworks`, t-38), and the scan reads that subdirectory as
it reads any app directory.

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

## The OpenAPI document

`lib/app/api/openapi.ts` builds it from the routes served now (`servedRoutes()`: `APP_ROUTES` less any whose switch is off) with zod 4's `z.toJSONSchema`
(JSON Schema 2020-12, OpenAPI 3.1's dialect): requests as the schema's input, responses
as its output. `GET /api/v1/openapi.json` serves it to anyone, bare, as a conditional GET
(t-44). Nothing about a route is written twice, so a new entry appears in the document
with no further step.

- **Each registry property maps to the document**, one test per mapping in
  `tests/unit/lib/app/api/openapi.test.ts`: `auth` to `security` (a `session` cookie, an
  `apiKey` bearer naming its scope, and `{}` for `orSignedOut`) plus a 401/403, `invalidParamsStatus` to a 404 in place
  of the 400, `conditional` to `If-None-Match`, `ETag` and a 304, `stream` to
  `text/event-stream`, `file` to its media type.
- **Errors:** a 429 and the shared `Error` envelope as `default` on every route, plus the
  statuses the registry implies. A code only a handler raises stays in its docblock.
- **HEAD and OPTIONS** are not listed: Next.js answers HEAD on every GET, and OpenAPI
  tools expect only declared methods.
- **`context` and `result`** are `unknown` in the registry, each framework's own. Each
  place they appear uses its own exported field (`assessmentContextField`,
  `assessmentResultField`, `storedResultField`, `sharedResultField`), which the generator
  swaps for HowDoesThisLand's schemas in `lib/app/frameworks/howdoesthisland/engine/wire.ts`.
  The registry stays open on purpose: the report parses `result` with its own looser
  schema, which an older stored result still passes. For the same reason the document's
  `AssessmentContext` and `AssessmentResult` forbid no key they do not name. A shared report's `result` is the
  report's allowlist (`reportResultSchema`), not the whole result.
- **Kept honest by:** validation against the official OpenAPI 3.1 schema (vendored at
  `tests/fixtures/openapi-3.1-schema.json`) with ajv's 2020-12 build, which fails a broken
  document; every `$ref` resolving; and `wire.test.ts`, which holds `wire.ts` to the
  engine's types and parses every baseline case's real result through it.

## API keys

People make, list and revoke their own keys at `/settings/api-keys` (t-43), linked from
the foot of `/settings` through `lib/app/account-sections.ts`. The page is a shell over
core's self-service routes (`GET`/`POST /api/v1/user/api-keys`,
`DELETE /api/v1/user/api-keys/{keyId}`), which refuse an API key and want a browser
session; their rules are core's (`.context/orchestration/api-keys.md`).

- **Scopes offered:** the app's own (`APP_API_KEY_SCOPES`: `assess`, `reports`, `projects`) that the
  install can mint, nothing else. Core's `chat`, `analytics`, `knowledge` and `webhook`
  reach nothing this product serves, and `admin` is a platform credential. Each scope's
  words are in `SCOPE_DESCRIPTIONS` (`components/app/settings/api-keys/schemas.ts`); a
  scope added to the seam without words is still offered, under its own name.
- **Workspace:** a key is bound to the workspace the request was made in, so the page
  names the active one, and so does the list: core lists only the active workspace's keys
  (and platform keys), so a key made elsewhere is listed there. A platform key (no
  workspace) is labelled as such.
- **Expiry:** 30 days, 90 days (the default), a year, or none, sent as an ISO datetime.
- The new key's value is shown once and never stored by the page.

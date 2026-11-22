# Frameworks

The model the service judges against is stored as data: a **framework** (D2) has
**versions**, each imported from a reviewed JSON file and published once, after which
it never changes (D3). Every assessment will pin the version it used. The design is
[`planning/app-plan.md`](./planning/app-plan.md) §8.1; this page is how to work with it.

## Importing and publishing a version

A model change is a PR to the JSON (D5). Once it is merged:

```bash
# 1. Check every reference resolves (the author's own check, also run by the import).
python3 prototype/tools/validate_refs.py prototype/howdoesthisland_model.json

# 2. Import it as a draft. Prints the record and link counts and the file's sha256.
npx tsx --env-file=.env.local scripts/app/frameworks/import.ts \
  howdoesthisland lib/app/frameworks/howdoesthisland/data/model-0.5.1.json

# 3. Calibrate it with the judges (t-37). A draft without a complete AI run of it
#    does not publish. See calibration.md.
npm run calibrate -- --mode ai --version 0.6.0

# 4. Publish it. From here it can never change.
npx tsx --env-file=.env.local scripts/app/frameworks/publish.ts howdoesthisland 0.6.0
```

Exit codes: `0` done, `1` refused (every problem is printed), `2` bad usage.

**Run them against every database**, development and each deployed one. No seed
runs them, so a database nobody imported into has no model. The gate reads the runs in
the database it publishes in, so each database needs its own AI run of a new version
before it publishes there. 0.5.1, published before the gate, needs none
(`UNGATED_VERSIONS`).

- **Importing the same file again changes nothing.** A different file under a draft's
  version number replaces the draft. Under a published one it is refused: give the
  file a new version number.
- **Both run in the system scope.** The tables are shared config, and at `multi` a
  write from inside a customer's workspace cannot change it.
- **A new version is a new file.** Copy the reviewed model to
  `lib/app/frameworks/howdoesthisland/data/model-<version>.json` byte for byte (the
  folder is kept out of Prettier for this), and keep `prototype/` as delivered.

## What the import refuses

All of it is reported in one run, and nothing is written:

- a reference that resolves to nothing, or to records of two kinds at once;
- a section the definition does not know, or one it expects that is missing;
- a record failing its kind's Zod schema, or with no `id`;
- two records of one kind with the same key;
- judges whose ids are not the definition's `judges.slots` (order aside): each slot is a
  platform agent in every workspace ([`judges.md`](./judges.md)), so a version
  cannot add, drop or rename one without code;
- a file that is not JSON.

The reference fields follow the model's own spec, `meta.reference_rules`, and are
declared in `lib/app/frameworks/howdoesthisland/definition.ts`. Model 0.5.0 is
refused: it has 38 unresolved references, an export fault fixed in 0.5.1.

## How it is stored

Four shared-config tables (no `orgId`), registered as `globalConfig`:

| Table                   | Holds                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `app_framework`         | One row per framework: `howdoesthisland`.                                                        |
| `app_framework_version` | A version: number, status (`DRAFT` → `PUBLISHED` → `RETIRED`), the file as imported, its sha256. |
| `app_framework_node`    | One record (an appeal, a move, a thinker) or one singleton section (`meta`, `scoring`).          |
| `app_framework_link`    | One reference from one record to another, by relation (`grounded_in`, `research`, `move`, …).    |

- **Reference fields stay in the records' attributes, and links index them.** Several
  are ordered lists, maps or nullable values that a link row cannot carry, so the
  model is rebuilt from the attributes. The links are written in the same import,
  checked to resolve, and frozen with the version, so the two cannot drift.
- **Containment is `parentKey`, not a link.** A lever's perspective is its `parentKey`.
- **`materialise(versionId)` rebuilds the model** exactly as imported, array order
  included, and caches a published version's model for the life of the process.

## Rules for code

- **Only `lib/app/frameworks/repo.ts` writes these tables.** A guard test fails on any
  other writer. Its writes to an existing version are conditioned on the version still
  being a draft, in the same statement.
- **Read a model through `materialise()`**, not by querying nodes and reassembling it.
- **A second framework is a new definition** in `lib/app/frameworks/registry.ts`, with
  no new tables.

## Reading it through the API

Public: no sign-in, in Sunrise's envelope. Rate limited by the `/api/v1` catch-all rule,
which keys on the session user and, for an anonymous caller, falls back to the IP.

| Route                                                     | Serves                                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/frameworks`                                  | Every framework with a published version, and those versions, most recently published first.              |
| `GET /api/v1/frameworks/{slug}`                           | One framework, its versions, and `kinds`: what the route below serves.                                    |
| `GET /api/v1/frameworks/{slug}/versions/{version}`        | The whole model, materialised from the records. `meta.sourceSha256` is the imported file's checksum.      |
| `GET /api/v1/frameworks/{slug}/versions/{version}/{kind}` | One kind's records (`red_flag`, `lever`, …), in model order. A nested kind's `meta.parents` maps parents. |

- **A draft is not found.** A retired version is still served, marked `retired`, since
  assessments made with it cite it. `latestVersion` is the most recently published
  version that is not retired (by publish time, not version number), or `null`.
- **404s carry their own code**: `FRAMEWORK_NOT_FOUND`, `FRAMEWORK_VERSION_NOT_FOUND`,
  `FRAMEWORK_KIND_NOT_FOUND`.
- **Every response has an ETag**, and a matching `If-None-Match` gets a 304. A version's
  ETag comes from its id, checksum, status and `VERSION_RESPONSE_SHAPE`, so a 304 never
  materialises the model. Bump that constant when a change alters what a version's
  response contains.
- **The checksum is of the file, not the response.** The response is the materialised
  model, so compare canonically: with sorted keys, its hash equals the committed file's
  (a route test proves it). This holds only with the culture switch on.
- **`{kind}` is the stored kind name**, singular and with underscores, as in the records
  and the links. Singleton sections (`meta`, `scoring`, …) are only in the whole model.

### The culture switch (D11)

`CULTURE_MODULE_ENABLED` (`true` or `false`, in `lib/app/env.ts`) withholds the model's
`culture` section, the Hofstede and Lewis data, whose terms are not yet checked. Unset, it
is **on outside production and off in production**, until `l2` settles the data and sets
it. Read it through `isCultureEnabled()` (`lib/app/frameworks/culture.ts`).

With it off, the whole-model response leaves `culture` out and names it in
`meta.omitted`, `kinds` drops the `culture_*` kinds, and those kinds are 404. Nothing
outside the section refers into it, so the rest of the model stays whole.
The engine follows the same switch: with it off, it reads no culture input and produces
no culture output ([`engine.md`](./engine.md#the-culture-switch-d11)).

## Checking it

```bash
npx tsx --env-file=.env.local scripts/app/smoke-framework-store.ts
```

Imports and publishes 0.5.1 against the dev database at `multi` (a no-op when already
done), checks a changed file is refused, and reads the model back from inside a
workspace that is not the install org.

## The model pages (`/model`)

The public, signed-out pages that show a published version (t-63). `/model` and
`/model/{section}` show the latest version; `/model/v/{version}/…` pins one, and its links
stay in that version, so a review made with an older version can point at what scored it.
The routes in `app/(public)/model/` are one line each over `components/app/model/`.

- **Not tied to one version of the model.** `buildBrowseModel()`
  (`lib/app/frameworks/browse.ts`) builds the pages from the definition: a section is a
  top-level part of the file, every field a record has is shown, and a link is a declared
  reference (or a field named after a kind, such as a move's `appeal`) whose id resolves.
  A section, kind or field a later version adds appears with no code change.
- **The words around the records** are `components/app/model/presentation.ts`: titles,
  intros, labels and which sections come first. Every entry is optional and has a
  fallback, and none counts records; counts are read from the version shown. Keep it that
  way: copy that names the model's current parts goes stale when the model changes.
- **Cached per version, rendered per request.** The `(public)` layout reads request
  headers (maintenance mode), so these pages cannot be statically generated without a
  layout of their own (which maintenance mode would not cover) or turning on Cache
  Components for the whole app. Both were judged worse than this (t-63). A
  published version never changes, so its model is cached by version id for the life of
  the process (`materialise()`, and the built pages in `load.ts`); only "which version is
  latest" is read per request. A version shows the moment it is published, with nothing to
  revalidate. Search engines get the same server-rendered HTML either way.
- **The culture switch** applies as in the API: off, the `culture` section is not on the
  index and its page is a 404.
- `/about` is the product's rationale and the lineage of the idea, in
  `components/app/marketing/about-page.tsx` (ledger row 27). It reads no model, so it
  never goes stale when the model changes.

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
- `scoring.adjustment_bounds` that are malformed ([below](#adjustment-bounds-d5));
- a file that is not JSON.

The reference fields follow the model's own spec, `meta.reference_rules`, and are
declared in `lib/app/frameworks/howdoesthisland/definition.ts`. Model 0.5.0 is
refused: it has 38 unresolved references, an export fault fixed in 0.5.1.

## Adjustment bounds (D5)

A project may adjust a version's weights (the appeal mix and the priority dimensions)
only within bounds **the version declares**, in `scoring.adjustment_bounds`. They are
versioned data, not a policy in code (owner ruling, 2026-11-22, t-72): a bound is a claim
about that version's weights, so it lives beside them, and an adjustment a review
recorded stays checkable against the limits it was made under.

```json
"scoring": {
  "adjustment_bounds": {
    "weights": { "ethos": 0.1, "pathos": 0.05 },
    "priority_dimensions": { "add": 2, "remove": 1 }
  }
}
```

- **`weights.<appeal>`**: how far a project may move that appeal's weight from the
  content type's, either way, as a share of the mix (`0.1` is ten points), from 0 to 1.
  An appeal left out may not move.
- **`priority_dimensions.add` / `.remove`**: how many of the version's **core**
  dimensions (`dimensions[]`, never a lens or an extra dimension) a project may add to,
  or take off, a content type's priority dimensions. Left out, none.
- **A version without the block allows no adjustment.** 0.5.1 declares none, so projects
  can adjust nothing until a later version publishes bounds (t-73).
- **The import checks it strictly**: a misspelt appeal or key, a negative or fractional
  bound, a weight bound over 1, or an empty block is refused. The engine reads it with
  the same schema (`adjustmentBoundsSchema` in `engine/model.ts`).
- **The catalogue serves the bounds** (`request.adjustment`, null for none) so the project
  page can offer the choice. The bounds say how far a customer may move a weight; they
  never include a weight or a content type's priorities, which stay the model's IP.

Rubrics, prompts and ids are never adjustable, by anyone but a new version. How the engine
applies an adjustment is in [`engine.md`](./engine.md#a-projects-weighting-d5-t-72).

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

**The model is HowDoesThisLand's IP** (owner ruling, 2026-11-22, t-67). What makes it work
(rubrics, weights, formulas, caps, detection patterns, reviewer instructions) is never
served to the public. The whole model and its kinds are for platform admins only; a
caller building reviews reads the catalogue. In Sunrise's envelope, rate limited by the
`/api/v1` catch-all rule. Who may call each route is `lib/app/frameworks/api/route-auth.ts`.

| Route                                                        | Who                       | Serves                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/frameworks`                                     | a session or `assess` key | Every framework with a published version, and those versions, most recently published first.                                                                |
| `GET /api/v1/frameworks/{slug}`                              | a session or `assess` key | One framework and its versions, with `latestVersion`.                                                                                                       |
| `GET /api/v1/frameworks/{slug}/versions/{version}/catalogue` | a session or `assess` key | The ids and names a review's `context` takes and a result names, moves, perspectives and levers included (the definition's `catalogue()`). Never the model. |
| `GET /api/v1/frameworks/{slug}/versions/{version}`           | platform admins           | The whole model, materialised from the records. `meta.sourceSha256` is the imported file's checksum.                                                        |
| `GET /api/v1/frameworks/{slug}/versions/{version}/{kind}`    | platform admins           | One kind's records (`red_flag`, `lever`, …), in model order. A nested kind's `meta.parents` maps parents.                                                   |

- **Reports read the model in process**, not over HTTP: the web report, a share link and
  the PDF all go through `loadModelDocument()` (`lib/app/reports/pdf/print-source.ts`).
  The report parses only the fields it shows, so the rest never reaches the browser.
  `GET /api/v1/shared-reports/{token}`, which needs no sign-in, answers with the
  version's catalogue, never the model.
- **Bump `catalogueShape`** on the definition when the catalogue's fields change: it is
  part of the catalogue's ETag.
- **The catalogue is built field by field** (`lib/app/frameworks/howdoesthisland/catalogue.ts`),
  so a field a later version adds is not served until someone adds it there on purpose.
  A test checks it carries none of 0.5.1's rubrics, patterns, scoring text or reviewer
  instructions.
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
`meta.omitted`, the catalogue leaves out the countries, and the `culture_*` kinds are 404. Nothing
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

## The model on the public site (`/model`)

The model is HowDoesThisLand's IP (owner ruling, 2026-11-22): the site explains it, and
never publishes it. `/model` ("How a review works"), a page per chapter and
`/model/sources` render **the explainer** (`lib/app/explainer/`), a companion written by
hand as copy. They never read the model.

- **`chapters.ts`**: chapters of groups of entries, each in plain words with a summary,
  an explanation, sometimes an example, and its sources. No rubric, weight, formula,
  threshold, detection pattern or reviewer instruction, no counts of the model's parts,
  and no version number. A test checks the first and last against 0.5.1.
- **A pointer** on an entry names the model concept it explains (`{ kind, id }`, or
  `section` for a top-level part). It is never shown; a test fails when the model loses
  it, so a model change that leaves the explainer wrong is caught.
- **`sources.ts`**: who, what, when and why each source matters, for a reader meeting it
  for the first time, with a stable link (an encyclopedia entry or a DOI). Cited from the
  explainer and from `/about`; a test checks every citation resolves.
- **The pages** (`components/app/model/explainer-pages.tsx`) are guided reading: each
  chapter top to bottom, entries opening in place, sources in a popover. All of it is
  server-rendered, folded detail included, with a title, description and canonical URL
  per page, and every page in the sitemap (ledger row 25).
- The culture review is left out while its switch is off in production.
- `/about` is the product's rationale and the lineage of the idea, in
  `components/app/marketing/about-page.tsx` (ledger row 27).

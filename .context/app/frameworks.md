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

# 3. Publish it. From here it can never change.
npx tsx --env-file=.env.local scripts/app/frameworks/publish.ts howdoesthisland 0.5.1
```

Exit codes: `0` done, `1` refused (every problem is printed), `2` bad usage.

**Run both against every database**, development and each deployed one. No seed
runs them, so a database nobody imported into has no model.

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

## Checking it

```bash
npx tsx --env-file=.env.local scripts/app/smoke-framework-store.ts
```

Imports and publishes 0.5.1 against the dev database at `multi` (a no-op when already
done), checks a changed file is refused, and reads the model back from inside a
workspace that is not the install org.

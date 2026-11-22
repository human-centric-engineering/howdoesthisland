# Projects

A project holds the background of one piece of a workspace's work: a client, a
product or a campaign (t-70, `f-projects`). It has a **brief**, in the author's own
words, and the **defaults** a review in it takes, so nobody restates the type of
copy and the audience on every review. Context documents (t-74) and the AI
reviewers reading the brief (t-75) build on it. Code is `lib/app/projects/`.

## What a project holds

| Field       | What it is                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`      | Up to 120 characters.                                                                                                                       |
| `brief`     | `{ offer, audience, voice, markets, goals }`, each optional, up to 2,000 characters. The visible words are **brief** and **tone of voice**. |
| `defaults`  | `{ context?, profile? }`: who the copy is for, as `POST /api/v1/assessments` takes `context`, and a profile name.                           |
| `overlay`   | Its weighting (t-72): how it shifts the framework's appeal mix and priority dimensions, within the version's bounds. `null` for none.       |
| `framework` | The framework its reviews are scored with, fixed when it is made, because the defaults are that framework's ids.                            |
| `archived`  | Archived rather than deleted.                                                                                                               |

A project is the **workspace's**, not its maker's: any member may read, change or
archive one (`Project` is `not-personal` in `lib/app/owner-classification.ts`).
`createdByUserId` has a hand-written FK to `user`, SET NULL, with its drift probe.
The table is tenant-owned (`orgId`, `org_isolation`). Projects are in the org
export, and in the subject export of the person who made them.

## The routes

All take a browser session, or an API key with the **`projects`** scope. Another
workspace's id answers 404, as a missing one does.

| Route                          | Does                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `POST /api/v1/projects`        | Make one. 201.                                                                                  |
| `GET /api/v1/projects`         | List, newest first. Archived ones only with `archived=true`. Paginated, with each review count. |
| `GET /api/v1/projects/{id}`    | Read one.                                                                                       |
| `PATCH /api/v1/projects/{id}`  | Change `name`, `brief`, `defaults` or `overlay` (each replaced whole), or `archived`.           |
| `DELETE /api/v1/projects/{id}` | Archive it. Its reviews keep their link; `PATCH { archived: false }` restores it.               |

## Defaults

- **Checked when written**, against the latest published version of the project's
  framework: an unknown type of copy, audience option or profile is 400
  `DEFAULTS_INVALID`, with each problem's path (`defaults.context.contentType`). A
  culture default is refused while the culture switch is off, as a review's is.
- **Stored as given**, not as the engine fills them in, so what they leave out still
  takes the version's own defaults.
- **A review in a project** (`POST /api/v1/assessments` with `projectId`) takes the
  project's defaults under its own fields. The request wins field by field, and where
  both give an object (`audience`, `culture`) key by key within it, so naming one
  audience option keeps the project's others (`mergeContext`). `profile` or `judges`
  in the request wins over the project's profile. The merged context is checked
  against the version the review runs with, so defaults a later version no longer has
  answer 400 `CONTEXT_INVALID`.
- A review names its project on the content and assessment rows (`projectId`, FK,
  SET NULL) and in the API's view of it. `GET /api/v1/assessments?projectId=` lists
  one project's reviews. A review kept nowhere (`store: false`) takes the defaults
  and records nothing.

## Weighting (D5, t-72)

A team writing for one client often knows the reader better than the framework's
averages, so a project may shift the appeal mix and the priority dimensions. **How far is
the version's**: its `scoring.adjustment_bounds`
([`frameworks.md`](./frameworks.md#adjustment-bounds-d5)). **A version without bounds
allows no adjustment**, and 0.5.1 declares none.

```json
{
  "weights": { "ethos": 0.08 },
  "priorityDimensions": { "add": ["kai_call"], "remove": ["pat_stakes"] }
}
```

- **`weights`**: added to the content type's appeal weights, as a share of the mix, before
  the mix is rebalanced to 100%. **`priorityDimensions`**: core dimensions made a priority,
  or no longer one, whatever the type of copy.
- **Checked when written**, against the latest published version, as the defaults are:
  400 `OVERLAY_INVALID` with each problem's path (`overlay.weights.ethos`,
  `overlay.priorityDimensions.add.0`) for an unknown key or id, a move past a bound, too
  many ids, or any overlay at all while the version declares no bounds.
- **Stored as the engine checked it**: a zero or an empty list is dropped, and an overlay
  left empty is none. `overlay: null` clears it, with no check. In the column, none is
  `{}`, which the API answers as `null`: SQL `NULL` would need a runtime Prisma import
  `lib/app/**` may not make.
- **A review in the project is scored with it**, stored or `store: false`. It is checked
  again against the version the review runs with, so a review on a version whose bounds do
  not allow it is 400 `OVERLAY_INVALID`, marked `fromProjectOverlay`. The judges' prompts,
  the effective weights and the appeal scores all read the adjusted mix.
- **Every review records what it used**: `Assessment.overlay` (null for none), in the API's
  view of the assessment and of a `store: false` run, and named on the report's cover
  ("Weighting, adjusted for its project"), share links included. The run reads it from the
  row, so a re-driven run scores as the first did.

Refusals for a review in a project: 404 `PROJECT_NOT_FOUND` (none in this
workspace), 409 `PROJECT_ARCHIVED` (restore it first), 400
`PROJECT_FRAMEWORK_MISMATCH` (the request names another framework), 400
`OVERLAY_INVALID` (its weighting does not fit this version, above).

## The pages

`/projects` and `/projects/[id]` (t-71), protected through `lib/app/protected-routes.ts`
and in the signed-in nav. Code is `app/(protected)/projects/` and `components/app/projects/`.

- **`/projects`** lists the workspace's projects, newest first, from one
  `GET /api/v1/projects?limit=100` call; `?archived=true` lists archived ones too. More
  than 100 says "the newest 100 of N". "New project" asks for a name, makes it and opens
  its page.
- **`/projects/[id]`** edits the name, the brief and the defaults with one `PATCH`, and
  archives or restores. It reads the project, then the framework's latest version, then
  that version's catalogue: the pickers offer the catalogue's ids, the same version the
  API checks defaults against. Each picker starts on **No default**, which sends nothing.
- **Culture**: the reader's and writer's culture pickers (Anywhere, the engine's `global`,
  then the catalogue's countries), and the culture reviewer set,
  appear only when the catalogue lists countries, which it does only with the culture
  switch on, or while the project has a culture stored, so one the switch now refuses is
  seen rather than dropped.
- **The `archetype` audience setting is not offered.** The catalogue lists it, but the
  engine leaves it out of a context (`MODS` in `engine/model.ts`) and refuses a default
  naming it; the **Reader** picker sets the context's own `archetype`.
- **Weighting** (t-72) is its own card, saved on its own, and appears **only when the
  version in use declares bounds**. It offers only the appeals the bounds let move, in
  points with their limit, and the core dimensions as checkboxes, up to the number the
  bounds allow. A project still holding a weighting the version no longer allows sees it
  described, told that its reviews are refused until it is removed, and a Remove button.
- **AI reviewers** offers `quick`, the version's `judge_catalogue` groups and `full`. A
  group also runs the four appeals, which the field's help says.
- **Nothing stored is dropped unseen.** A stored default the version no longer has stays
  selected, marked "not in this version", and an audience setting the version lacks keeps
  a picker of its own, so saving sends it and is refused with `DEFAULTS_INVALID` until it
  is changed; each refused default is shown under its picker. An empty role or culture (the
  engine's "none") reads as No default. A stored
  context in a shape the pickers cannot read starts them all on No default, and the page
  says saving replaces it.

## The demo seed

`app-howdoesthisland/002-demo-usage` makes two projects in the demo workspace,
`demo-launch` and `demo-help-centre`, which its reviews are in. Before t-70 it wrote
those ids with no project behind them; the migration (`20261122100000_app_project`)
clears such ids before adding the foreign keys.

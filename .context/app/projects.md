# Projects

A project holds the background of one piece of a workspace's work: a client, a
product or a campaign (t-70, `f-projects`). It has a **brief**, in the author's own
words, and the **defaults** a review in it takes, so nobody restates the type of
copy and the audience on every review. Its **background documents** (t-74) and the AI
reviewers reading the brief and passages from them (t-75) build on it. Code is `lib/app/projects/`.

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
  left empty is none. `overlay: null` (or `{}`) clears it, with no check. In the column, none is
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

## Background documents (t-74, D18)

A project's documents (a positioning paper, a brand guide, last year's campaign)
live in the workspace's **knowledge base**, core's `AiKnowledgeDocument`, which
chunks and embeds them; `ProjectDocument` links each to the project
(`lib/app/projects/documents.ts`). The visible words are **background
documents**; the code and API say `documents`.

| Route                                                 | Does                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/projects/{id}/documents`                 | List, oldest first, each with its knowledge row's `status`, read live.                                                                                                                     |
| `POST /api/v1/projects/{id}/documents`                | Add one from `{ url }` or `{ file: { name, base64 } }`, with an optional `title`. 201; the same text already in the project answers 200 with its link, renamed to `title` if one is given. |
| `DELETE /api/v1/projects/{id}/documents/{documentId}` | Remove it. `knowledgeDocumentDeleted` says whether the knowledge row went too.                                                                                                             |

- **Adding is synchronous**, as core's upload is: intake reads the file or page
  (`lib/app/intake/`, with a 200,000-character cap rather than a review's 40,000),
  then `uploadDocument` chunks and embeds it before the answer. The route allows
  300 seconds. A per-user sub-cap of 20 adds in ten minutes applies, since each
  add embeds. A project holds at most 50, and an archived one takes none (409
  `PROJECT_ARCHIVED`, as a review is refused). A read that cannot be embedded is 502
  `DOCUMENT_NOT_INDEXED`, and the failed knowledge row this call made is deleted,
  since nobody here can see or retry it, unless a racing add has already linked it.
  Text the project already holds is answered from its link before the cap and
  without embedding again. A row core's dedupe hands back from another workspace (it reads by
  hash alone, and row isolation is off at `single`) is never linked: the add is
  refused as `DOCUMENT_NOT_INDEXED`, without saying why. A file's or page's own
  title is cut to 200 characters, as a given one is bounded.
- **Status is not stored on the link.** It is the knowledge row's
  (`processing`, `ready`, `failed`, `pending_review`, `cleaning`), read with the
  list in one query, so a document core re-processes later reads as such. A stored
  copy would only ever have said `ready`, because the link is made once indexing
  is done. The page re-reads the list every few seconds while any is `processing`,
  for at most five minutes; `pending_review` and `cleaning` wait on an admin, so
  are not polled. Re-adding text the project holds says so on the page.
- **Whether this app's upload made the knowledge row** (`createdByUpload`).
  `uploadDocument` deduplicates by content hash and returns an existing ready row,
  or a racing upload's, without saying which. The service reads the ids with the
  text's hash before the call: a row among them was reused. A row new since then
  counts as this upload's only if it names this user as uploader and this file
  name, which tells it from a racing upload by core's knowledge page or another
  project. What is left is the same person uploading the same file through core's
  page and this app at once, counted as the app's.
- **Removing a link** deletes the knowledge row only when an upload by the app
  made it, no other link to it remains, no agent is granted it directly, and it
  carries no tag (an admin's mark on it, and how agents are granted documents in
  bulk), and it is not still `processing` (another add may be embedding it).
  Otherwise only the link goes. When the link holding
  `createdByUpload` goes while others remain, the flag moves to one of them, so
  the last link out still knows. One serializable transaction, retried on a clash.
- `knowledgeDocumentId` has a hand-written FK to `ai_knowledge_document`,
  **CASCADE**, so a document deleted through core's knowledge page takes its links;
  `addedByUserId` one to `user`, SET NULL. Both have drift probes. Links are in the
  org export and in the subject export of the person who added them; the text is
  in the knowledge base's own sections of both.
- **Not here:** embedding spend is recorded in core's cost log against the
  workspace but is not charged CopyCredits or held against the monthly budget.

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
- **Background documents** (t-74) is its own card: each document with where it came
  from and its status, a file picker and a page address to add one, and a remove
  button. The one being added shows as being read until the API answers.
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

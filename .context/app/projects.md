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
| `PATCH /api/v1/projects/{id}`  | Change `name`, `brief` or `defaults` (each replaced whole), or `archived`.                      |
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

Refusals for a review in a project: 404 `PROJECT_NOT_FOUND` (none in this
workspace), 409 `PROJECT_ARCHIVED` (restore it first), 400
`PROJECT_FRAMEWORK_MISMATCH` (the request names another framework).

## The demo seed

`app-howdoesthisland/002-demo-usage` makes two projects in the demo workspace,
`demo-launch` and `demo-help-centre`, which its reviews are in. Before t-70 it wrote
those ids with no project behind them; the migration (`20261122100000_app_project`)
clears such ids before adding the foreign keys.

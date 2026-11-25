# Comparisons

Choosing between drafts (two subject lines, two versions of a proposal) means
reviewing each the same way and reading the results together. A comparison does
that: 2–5 drafts, reviewed with one framework version, context, project and set
of AI reviewers, read back with each draft's difference from the best on every
appeal. Built in t-87 (f-compare, app-plan §9). The editor's verdict on which
draft lands better (t-88) and the side-by-side page (t-89) build on it.

## The API

| Route                             | What it does                                                                |
| --------------------------------- | --------------------------------------------------------------------------- |
| `POST /api/v1/comparisons`        | Review 2–5 drafts the same way. 202 at once; the reviews run as any review. |
| `GET /api/v1/comparisons`         | The workspace's comparisons, newest first; `page`, `limit`, `projectId`.    |
| `GET /api/v1/comparisons/{id}`    | One comparison: each draft's state and scores, and the per-appeal compare.  |
| `DELETE /api/v1/comparisons/{id}` | Delete the comparison. Its drafts' reviews stay.                            |

All four take a browser session or an API key with the `assess` scope, and are
the workspace's: another workspace's id is a 404.

The body is `{ drafts, profile?, judges?, framework?, version?, context?,
projectId? }`. `drafts` is 2–5 of `{ text, label? }` (pasted copy; a label of
up to 80 characters, "Subject line A"). Fewer or more is a 400
`VALIDATION_ERROR`. The rest are a review's options
(`POST /api/v1/assessments`), given once: they are resolved once
(`resolveReviewOptions` in `lib/app/assessments/api/service.ts`, the same code a
single review uses), so every draft gets the same version, the same context with
the project's defaults applied, the same overlay and the same judges. A refusal
of an option is the review's (`CONTEXT_INVALID`, `PROFILE_UNKNOWN`,
`PROJECT_ARCHIVED`, …). A draft whose text is empty or too long refuses the
whole set (`CONTENT_EMPTY`, `TEXT_TOO_LONG`), with the draft's place in
`drafts` as `details.position`. A file or a page is not taken:
drafts are pasted.

## Each draft is an ordinary review

Each draft becomes a stored review: in the workspace's history, titled with its
label, opened as its own report, cancelled or deleted as any review is. The set
(`AssessmentSet`, kind `COMPARISON`) records what they shared (version, profile,
judges, context, project) and who started it; its members
(`AssessmentSetMember`) hold each draft's place, label and review.

Nothing schedules the drafts beyond that. They are queued with `enqueueAssessments`
and started as any stored review; past the workspace's three running places
(`RUNNING_PER_WORKSPACE`) they wait queued, and each run that ends starts the
next (`run.ts`), with the recovery job as the backstop. Five drafts in a
workspace with three places all end final (tested).

Every draft's content and review, the set and its members are written in one
transaction, after every check has passed: a set is stored whole or not at all.

## What the read compares

A comparison's state is read from its drafts', never stored:

| State       | When                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------- |
| `running`   | Any draft is queued or running.                                                             |
| `completed` | Every draft completed.                                                                      |
| `failed`    | Fewer than two drafts were scored: nothing to compare.                                      |
| `partial`   | Otherwise: a draft failed, was cancelled, scored with an AI reviewer missing, or is purged. |

Each draft carries its review's `status`, `overall` and `band`, and in the
single read its score on each appeal (`appeals`, `null` until scored). A draft
is scored once its review is `completed` or `partial`.

`appeals` on the comparison is empty until two drafts are scored. Then, per
appeal in the framework's order: every draft's `score` and `delta` (its score
less the best, so `0` for the leader and negative for the rest; `null` for one
not scored), and `leaders`, the positions with the best score, more than one on
a tie. The appeals and their scores are the framework's
(`FrameworkEngine.appealScores`), read from each review's stored result; for
this one, `ethos`, `pathos`, `logos` and `kairos` from `result.scores`. A
version no code runs any more lists its drafts with no appeals to compare.

The list (`GET /api/v1/comparisons`) carries each comparison's state and its
drafts' states and scores, from one query, not the per-appeal compare.

## The budget and the per-user cap

**The budget is checked for every draft together.** The estimate is one
review's times the drafts (`assertReviewFits` with a count), and the hold is
taken under the workspace's lock for all of them at once
(`reserveComparisonBudget`, `lib/app/usage/budget.ts`), one hold per draft. A
workspace that cannot cover every draft is refused 402 `INSUFFICIENT_CREDITS` or
`BUDGET_EXCEEDED` ("This comparison would cost about …"), and nothing is stored.
Once the drafts are stored, the holds are released and each queued review holds
its place in the budget as any does. Each is still checked again as it is
claimed (t-53), so a draft that waited while other spend landed can end `failed`
with the budget's `errorCode`, and the comparison reads `partial`.

**Each draft counts as a review** against the per-user cap on reviews that call
AI reviewers (`AI_ASSESSMENTS_PER_MINUTE`). The route takes the budget holds
first, so a set the locked budget check refuses counts none. It then checks
there is room for every draft and counts them all with no await between, so two
requests cannot both take the last of the room, and a set the cap refuses (429
`RATE_LIMIT_EXCEEDED`) counts none and releases its holds. Drafts that call no AI reviewer (the `quick` profile) count nothing and
hold no budget.

Each draft is charged in CopyCredits as its review ends, as any review is.

## Deleting and purging

- **Deleting a comparison** deletes the set and its drafts' places. Their
  reviews stay in the workspace's history.
- **Deleting a draft's review** (`DELETE /api/v1/assessments/{id}`) leaves its
  place in the set: the member's link is `ON DELETE SET NULL`, and the draft
  reads as `purged`, its label kept. The set is not failed for it; with fewer
  than two drafts scored, it reads `failed`.
- **The retention purge** (`lib/app/retention/purge.ts`) does the same to a
  review past the content window. It deletes a comparison only once it is past
  the window itself and none of its drafts has a review left. A comparison
  inside the window, or with a draft reviewed inside it, is kept and reads what
  is left.

## Data

| Model                 | Holds                                                          | On delete                                            |
| --------------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| `AssessmentSet`       | kind, project, version, profile, judges, context, who and when | the org's cascade; `createdByUserId` → user SET NULL |
| `AssessmentSetMember` | the set, its position, label and review                        | with its set; its review SET NULL                    |

Both are tenant-owned (`org_isolation`). The maker's FK is hand-written, with a
drift probe (`lib/app/db-drift.ts`). The subject export gives a person the
comparisons they started, each with its drafts (their reviews are in their
`assessments`); the org export gives both tables.

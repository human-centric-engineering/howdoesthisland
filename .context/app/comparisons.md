# Comparisons

Choosing between drafts (two subject lines, two versions of a proposal) means
reviewing each the same way and reading the results together. A comparison does
that: 2–5 drafts, reviewed with one framework version, context, project and set
of AI reviewers, read back with each draft's difference from the best on every
appeal, and the editor's verdict on which draft lands better. Built in t-87
(f-compare, app-plan §9), with the verdict in t-88, and the page that shows
it in t-89 (below).

## The API

| Route                             | What it does                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `POST /api/v1/comparisons`        | Review 2–5 drafts the same way. 202 at once; the reviews run as any review.                      |
| `GET /api/v1/comparisons`         | The workspace's comparisons, newest first; `page`, `limit`, `projectId`.                         |
| `GET /api/v1/comparisons/{id}`    | One comparison: each draft's state and scores, the per-appeal compare, and the editor's verdict. |
| `DELETE /api/v1/comparisons/{id}` | Delete the comparison. Its drafts' reviews stay.                                                 |

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

### A draft that is a review you already have (t-84)

A draft may instead be `{ assessmentId, label? }`: a review in the workspace,
which joins the set as it is. It is not reviewed, held, counted against the cap
or charged again. This is how the report's rewrite drawer compares a rewrite
with its original (`.context/app/rewrites.md`) without paying for the original
twice. A set still needs at least one draft as text, and names a review at most
once (400 `VALIDATION_ERROR` otherwise). Comparing only reviews you already have
is not offered: no caller needs it, and a set with no new review has no run
whose end starts its verdict.

The review must compare like for like (`reusedReviews` in
`lib/app/comparisons/service.ts`), each refusal carrying the draft's
`details.position`:

- **In this workspace.** Otherwise 404 `ASSESSMENT_NOT_FOUND`.
- **Not ended unscored.** A `failed` or `cancelled` review is 409
  `REVIEW_NOT_COMPARABLE`, `details.reason: 'not_scored'`. A `partial` one
  joins, and is shown but not weighed by the verdict, as any partial draft is.
- **Reviewed the way the set is.** Its version, judges, context, overlay and
  project must equal what the set's options resolve to now. Any that differ is
  409 `REVIEW_NOT_COMPARABLE`, `details.reason: 'options_differ'`, with them in
  `details.differs` (`version`, `judges`, `context`, `weights`, `project`). The
  JSON fields are compared ignoring key order (`jsonEquals`), since Postgres
  stores `jsonb` in its own order. The usual cause is a project whose defaults
  or weights changed after the review: its scores would not compare with a new
  review's.

A review still queued or running joins as it is, and its run's end starts the
verdict, as any member's does.

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
drafts' states and scores, from one query, not the per-appeal compare. It
carries the verdict's `status` and the `draft` it chose, not its reasons.

## The editor's verdict

Scores per appeal say where drafts differ, not which to send. Once every
draft's review has ended, the editor reads the finished reviews and says which
draft lands better with this reader, and why, the way it writes a review's
summary (`lib/app/comparisons/verdict.ts`).

`verdict` on the single read:

| Field                             | Holds                                                              |
| --------------------------------- | ------------------------------------------------------------------ |
| `status`                          | `waiting`, `running`, `completed`, `failed` or `skipped`.          |
| `draft`                           | The position of the draft that lands better, once `completed`.     |
| `why`                             | Two or three sentences on why it lands better with this reader.    |
| `appeals`                         | The appeals that decide it, most telling first: `{ appeal, why }`. |
| `reason`                          | Why there is none (below).                                         |
| `model`, `costUsd`, `completedAt` | The call's model and cost, and when the verdict ended.             |

**When it runs.** Once every draft is final (or purged) and at least two
completed. A `partial` draft was reviewed by fewer AI reviewers than the
others, so it is not shown to the editor: weighing it beside the rest would
not be like for like. With fewer than two completed, the verdict is `skipped`
with `reason` `too_few_completed`. A comparison whose drafts call fewer than
two AI reviewers (`quick`, or one judge) gets none either (`too_few_judges`,
decided when it is made, nothing held): the editor writes no summary for such
a review, and a paid call to weigh them is not what a writer asking for a
cheap review chose. Comparisons made before verdicts read `predates_verdicts`.

**What the editor is shown.** Each completed draft, named by its place
(`draft_1` is position 0) with its label: its scores and band, each judge's
summary, the editor's own summary of it when there is one, the strengths the
judges marked and the red flags, and its text, cut at 12,000 characters (each
was read whole by its own review). Then the audience and the project's brief
as it is now, as a rewrite reads it; not each draft's passages, which were
found for its own text. The engine builds the request and checks the reply
(`FrameworkEngine.buildVerdictRequest`, `validateVerdictReply`), so another
framework writes its own. The reply is refused whole, spending the call's one
retry, when it names a draft it was not shown or an appeal the framework does
not have, or gives no reason or no appeal; an appeal given twice keeps its
first. The prompt is new: the prototype has none.

**Started by** the end of each draft's run (`run.ts`), a cancel that ends a
queued draft, assessment recovery giving up on a draft, and the recovery tick (`app:comparison-verdict-recovery`, every
15 minutes per workspace), which starts any due verdict that has none: one
whose last draft ended in a process that died first, or by a delete. Starting
claims it (`WAITING` → `RUNNING`, matching the attempt count it read), so of
two starters one runs it; a verdict already ended, or running under a live
lease, is left alone.

**It survives the process ending.** The lease is renewed while the call
runs. One whose lease ran out, and whose attempt began more than 15 minutes
ago (longer than any call can live: two attempts at the approved entry's
timeout), lost its process: recovery claims it again and asks again, up to
three starts. Waiting out that lifetime keeps a live call whose renewals
failed from running beside a second one, or landing cost rows after the
verdict was charged. What earlier attempts spent is kept on the comparison
(`verdictCostUsd`) as it is claimed again or set to wait, so the budget check
counts it before the verdict is charged. Past them it ends `failed`, `reason` `lost`.
A failure that passes (`rate_limited`, `provider_error`) goes back to
`waiting`, its code in `reason`, and the recovery tick asks again while it has
starts left. Any other failure ends `failed` with the call's code
(`malformed`, `over_budget`, …), or `internal_error`.

**Budget.** The verdict's estimate is checked and held with the drafts' at
POST: a workspace that can cover the drafts but not the verdict beside them is
refused whole (402). It is the median of the workspace's last 20 verdicts to
end that cost something, or with none what this one can cost at most at
the editor's price, its request built from each draft's free quick scan (the
reviews do not exist yet: low by what the judges add, and the output ceiling
dominates). The first budget hold carries it (`BudgetHold.extraUsd`); once
stored, the comparison holds it (`verdictHeldUsd`) in every check while its
verdict is `waiting` or `running`, and the hold stops carrying it in the same
commit, so no check counts it twice.

**Charge.** The write that ends the verdict charges its cost rows (tagged
`comparisonId`, `editor: 'verdict'`, no `assessmentId`, so no draft's charge
counts them) in the same transaction, under `comparison-verdict:<id>`: once,
covering every attempt's rows. A call that ends after its verdict was claimed
again does not charge; the attempt that ends it does. A call whose comparison
was deleted under it charges, since nothing else will.

**What it can miss.** A call whose process died mid-call wrote no cost row,
though the provider may have billed it: that attempt is not charged, as a
review's editor summary in a run that died is not. And a verdict whose ending
could not be written twice is left `running` until its lease runs out, then
asked again: the first answer is paid for and lost.

## The budget and the per-user cap

**The budget is checked for every draft it reviews together.** A draft that
is an existing review (t-84) is not counted here or below. The estimate is one
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
AI reviewers (`AI_ASSESSMENTS_PER_MINUTE`). A set without room is refused (429
`RATE_LIMIT_EXCEEDED`) before it holds any budget. Otherwise the route takes the
budget holds before counting any draft, so a set the locked budget check refuses
counts none. It then checks the room again and counts every draft with no await
between, so two requests cannot both take the last of the room; a set refused
then counts none and releases its holds. Drafts that call no AI reviewer (the `quick` profile) count nothing and
hold no budget.

Each draft is charged in CopyCredits as its review ends, as any review is.

## Deleting and purging

- **Deleting a comparison** deletes the set and its drafts' places. Their
  reviews stay in the workspace's history. A verdict whose call is still
  running charges itself as it ends. One whose process was lost (and a
  verdict purged with its comparison) is charged by the recovery tick once its
  cost rows have been quiet an hour, from when the comparison was made (its
  rows carry it): nothing else can charge it once the row is gone.
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

| Model                 | Holds                                                                                                                  | On delete                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `AssessmentSet`       | kind, project, version, profile, judges, context, who and when; the verdict, its state, hold, lease, attempts and cost | the org's cascade; `createdByUserId` → user SET NULL |
| `AssessmentSetMember` | the set, its position, label and review                                                                                | with its set; its review SET NULL                    |

Both are tenant-owned (`org_isolation`). The maker's FK is hand-written, with a
drift probe (`lib/app/db-drift.ts`). The subject export gives a person the
comparisons they started, each with its drafts and its verdict (their reviews
are in their `assessments`), without the verdict call's lease, hold and
attempt count; the org export gives both tables.

## The page

`/compare/[id]` (`app/(protected)/compare/[id]/page.tsx`, t-89) shows one
comparison: a column per draft, by its label or its place ("Draft 2"), with its
overall score and band, then a row per appeal. The draft with the best score on
an appeal is marked Best (each of them, on a tie), and the rest say how far
behind they are. Above it, the editor's verdict: the draft that lands better,
why, and the appeals that decide it; or, while it is still to come, failed or
skipped, what that means. A draft that failed, was cancelled, or whose review
was deleted keeps its column and says so; a partial one shows its scores and
says the editor leaves it out of the verdict. Each draft links to its own
report.

It is read from `GET /api/v1/comparisons/{id}` alone, nothing per draft. While
a draft runs or the verdict is `waiting` or `running`, the page reads it again
every four seconds (`components/app/compare/use-comparison.ts`), not while the
tab is in the background, and stops once both have ended. It reads rather than
streams: the verdict has no stream, so a stream per draft
(`use-review-events.ts`) would still leave the verdict to be read this way, and
five streams would take most of a browser's six connections to the site.

**Finding one again** (t-90). `/compare` (`app/(protected)/compare/page.tsx`)
lists every comparison in the workspace, newest first, 20 a page (`?page=`),
and `/home` shows the latest three under Recent comparisons, with a link to
the rest and a Comparisons button beside Review some copy. A row is named by
its drafts ("Subject A · Draft 2"), links to `/compare/{id}`, and says which
draft the editor found lands better, "Still to come", or "No verdict". Both
read one `GET /api/v1/comparisons` call (`comparisonListEndpoint`), whose rows
carry their drafts' scores and the verdict's choice, so no row reads its
comparison again (`components/app/compare/comparison-list.tsx`). `/home`'s
filters are the reviews' and leave the comparisons as they are, and its empty
desk shows only with no review and no comparison. A comparison started from
the workbench whose reply could not be read points there.

**Starting one.** The `/assess` workbench's Compare drafts tab takes 2–5
pasted drafts, each with an optional name, and the reader settings and AI
reviewers beside them, given once (`assess-draft.ts`). Starting it posts to
`POST /api/v1/comparisons` and opens the comparison's page. With the quick scan
alone the tab says the editor will give no verdict (`too_few_judges`).

# Batches

A content team checking every page of a site, or a CMS checking every draft
before it publishes, used to send one review per call and track each one. A
batch takes many texts or pages in one call, reviews them all the same way,
answers its progress in one read, and sends one event when the last one ends.
Built in t-101 (f-batch-webhooks, app-plan §21).

A batch is a comparison's set (`.context/app/comparisons.md`) with more members
and no verdict: the same `AssessmentSet` and `AssessmentSetMember` rows, kind
`BATCH`. Each item is an ordinary review, in the workspace's history, opened as
its own report.

## The API

| Route                         | What it does                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `POST /api/v1/batches`        | Review 1 to `APP_BATCH_MAX_ITEMS` texts or pages the same way. 202 at once.                |
| `GET /api/v1/batches`         | The workspace's batches, newest first, each with its counts; `page`, `limit`, `projectId`. |
| `GET /api/v1/batches/{id}`    | One batch: its state, counts by state, and each item's state, score and review id.         |
| `DELETE /api/v1/batches/{id}` | Delete the batch. Its items' reviews stay, and any still running carry on.                 |

All four take a browser session or an API key with the `assess` scope, and are
the workspace's: another workspace's id is a 404. Contracts:
`lib/app/api/registry.ts`; code: `lib/app/batches/`.

The body is `{ items, profile?, judges?, framework?, version?, context?,
projectId? }`. Each item is `{ text, label? }` or `{ url, label? }`, a label of
up to 80 characters. The rest are a review's options, given once and resolved
once (`resolveReviewOptions`), as a comparison's are. A refusal of an option is
the review's (`CONTEXT_INVALID`, `PROFILE_UNKNOWN`, `PROJECT_ARCHIVED`, …). A
pasted text that is empty or too long refuses the whole batch (`CONTENT_EMPTY`,
`TEXT_TOO_LONG`), with the item's place in `items` as `details.position`. A file
is not taken.

### How many items

`APP_BATCH_MAX_ITEMS` (`lib/app/env.ts`): a whole number from 1 to 100, 10 when
unset. Staging runs at 10, production at 100. It is read as each request is
parsed (`batchMaxItems()` in `lib/app/batches/limits.ts`), so the schema the
contract publishes says "at most 100" and the setting narrows it. No items, or
more than the setting, is 400 `VALIDATION_ERROR`.

## Refused whole

Before anything is written: the options, every pasted text, then the credits and
monthly budget for **every item together** (`assertReviewFits` with the item
count, then `reserveSetBudget` under the lock, as a comparison's drafts are). A
workspace that cannot cover all of them stores none: 402 `INSUFFICIENT_CREDITS`
or `BUDGET_EXCEEDED`. The estimate comes from the workspace's own history of
reviews, not from the text, which is why a batch of pages can be checked before
any page is read.

Then every item's content and review, the set and its members are written in one
transaction (`enqueueAssessments`).

## A page is fetched when its own review starts

Fetching every address in the request would take minutes for a large batch, and
one slow site would sink the call. So a page is never fetched by the request.
Its `Content` row is stored with the address (`sourceKind: 'URL'`,
`sourceUrl`) and **no text**. Its run fetches it once it is claimed and past the
budget check (`fetchPendingPage` in `lib/app/assessments/run.ts`), then writes
the text, its hash and its word count under the lease, before the quick scan or
any judge reads it.

**Nothing reads a review's text before its fetch has succeeded.** That is held
three ways:

- **The database.** `Content.text`, `textSha256` and `wordCount` are nullable,
  and the `app_content_text_pending_fetch` CHECK constraint allows them null only
  together and only for a page with an address. It is probed by
  `npm run db:drift-check` (`lib/app/db-drift.ts`).
- **The types.** A nullable text is `string | null` to every reader, so the
  compiler named each one. The run fetches first; the early quick scan returns
  nothing (and does not remember the nothing); a review's read answers `text:
null` and `wordCount: null`; a rewrite, a comparison and a report each refuse
  a review with no text, which is never one that was scored.
- **Its state.** A page not yet fetched is `queued` or `running`, and one that
  could not be read is `failed`.

A page that cannot be read fails **that item alone**, with intake's code as the
review's `errorCode` (`FETCH_FAILED`, `FETCH_TIMEOUT`, `URL_NOT_ALLOWED`,
`TEXT_TOO_LONG`, `NO_TEXT`, `CONTENT_EMPTY`, …) and the reason in `error`. It is
not retried: the same page would most likely fail again. Nothing was spent on
it, and nothing is charged. The fetch is `fetchPage`, the same SSRF-guarded fetch
a single review makes in its request (`.context/app/intake.md`).

A page's title is its label when it has one, and otherwise the page's own title
once fetched. Its `sourceUrl` becomes where the redirects ended.

## Places

A workspace runs three reviews at once (`RUNNING_PER_WORKSPACE`). A batch starts
at most that many of its items; every run that ends starts the workspace's next
queued review (`startNextQueued`), and the recovery job is the backstop. Starting
every item at once would only have the rest of the claims refused.

**A batch takes the places nobody else is waiting for.** When a place frees, the
next review to start is the workspace's oldest in no batch, then its oldest batch
item, by id on a tie (`inTurn` in `lib/app/assessments/run.ts`). The recovery
job re-drives stalled reviews in the same order. A batch is bulk work its caller follows by its event; a
review pasted in the workbench, or a comparison's draft, is someone waiting. So a
person who pastes one review after a 100-page batch waits for one place to free,
not for 97 batch items. A batch only waits while the workspace is busy with work
people are waiting for.

**Written in one transaction.** Every item's content and review, the set and its
members go in together, two inserts an item. The transaction's timeout grows with
the count (`severalTransaction` in `lib/app/assessments/enqueue.ts`): a
comparison's 15 seconds, and a quarter-second more for each review past five,
about 39 seconds for a hundred. Measured on the dev database, a hundred items of
about 12,000 characters each write in under 150ms.

## The per-user allowance

Every item counts against **`BATCH_ITEMS_PER_HOUR`** (200) per user, not the
10-a-minute cap a single review and a comparison's drafts count against
(`AI_ASSESSMENTS_PER_MINUTE`). That cap would refuse any batch over 10 items;
counting a whole batch as one request would let a runaway script queue thousands
of reviews an hour. 200 an hour is two full batches, about what a workspace works
through three at a time. A `quick` batch counts too: it calls no model, but each
item is still a queued run, and each page a fetch the server makes for the caller.

Room is checked before the budget is held and again after. The items are counted
once the batch is stored (`onStored`), so a batch refused at any step, the write
included, counts none: 429 `RATE_LIMIT_EXCEEDED` when there is no room. Two
batches checked at the same moment can between them pass the allowance by one
batch; it is an allowance, not a ledger.

## No verdict

A batch asks the editor nothing. It is born with `verdictStatus: SKIPPED`,
`verdictReason: 'not_asked'`. The verdict machinery only takes `WAITING` sets,
so it never starts, recovers or holds budget for one.

## What the read says

`GET /api/v1/batches/{id}` (`lib/app/batches/views.ts`):

- **`status`**, worked out from the items', never stored: `running` while any
  is queued or running; then `completed` when every item completed, `failed`
  when none was scored, and `partial` otherwise.
- **`total`** and **`counts`**: how many items are in each state, `purged`
  included.
- **`items`**, in the order sent: `position`, `label`, `assessmentId`,
  `status`, `source: { kind, url }`, `overall`, `band` and `errorCode`.

The list carries each batch's `total` and `counts`, not its items, which may be
a hundred.

## `app.batch.finished`

Sent once every item is final or purged, through the same outbox as the other
events (`sendBatchFinished` in `lib/app/events/notify.ts`,
`.context/app/webhooks.md`). It carries `eventId` (`batch:<id>`), `batchId`,
`status`, `projectId`, `total`, `counts` and `items: [{ position,
assessmentId, status, overall, band }]`: no labels and no page addresses.

## Deleting and purging

Deleting a batch deletes the set and its items' places; their reviews stay in
the workspace's history. **Its items that have not started are cancelled**, and
those running finish (`cancelAssessment` with `queuedOnly`). Deleting is the one
way to stop a batch short of cancelling each item, and an item left queued would
run and be charged for work its caller abandoned, as a review in no batch, ahead
of reviews people are waiting for. Deleting or purging a review leaves its item's place,
read as `purged`, and the batch is not failed for it. The retention purge takes
the set once it is past the content window and none of its items has a review
left, as it does a comparison's.

## Checking it

- `tests/unit/app/api/v1/batches/routes.test.ts`: the routes end to end over the
  stateful fake, with the real run, places, outbox, verdict recovery and
  retention purge. The cap and its setting; refused whole with 402, nothing
  stored; each page fetched only once its review is claimed, with the request
  answered while the fetch still waits; a page that fails to load, one too long
  and a failed judge each failing only their item; more items than places, all
  ending final; born settled and never taken by the verdict machinery;
  `app.batch.finished` once, after the last item, and from the sweep when its
  send was lost; a purged item read as purged; the list, 404s and delete.
- `tests/unit/lib/app/env.test.ts`: `APP_BATCH_MAX_ITEMS` parses 1 to 100 and
  refuses anything else at boot.
- `npm run smoke:batch` (`scripts/app/smoke-batch.ts`): a `quick` batch of more
  items than places against the dev database, with a page that cannot be
  fetched and one that can (needs the network). Checks the constraint, the
  fetched text written by its run, every item ending and the event stamped.
  Calls no model.

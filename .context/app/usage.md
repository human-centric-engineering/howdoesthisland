# Usage

A workspace's reviews, AI reviewer calls and spend this calendar month, by
project and in total, against its monthly AI budget (t-48, `f-usage`). Its CopyCredits balance, and what reviews were charged this month, are in `credits` (t-57, [credits.md](./credits.md)).

- **API:** `GET /api/v1/usage` — a browser session, or an API key with the
  `reports` scope. Declared in the route registry, so it is in the OpenAPI
  document and on `/developers`.
- **Page:** `/usage`, linked from the signed-in nav. A thin shell over the
  route (`components/app/usage/usage-summary.tsx`).
- **Service:** `getMonthUsage()` in `lib/app/usage/service.ts`; the wire shape
  is `lib/app/usage/wire.ts`.

## Where the figures come from

| Figure            | Source                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Month             | Midnight UTC on the first (Sunrise's `utcMonthStart`), the month every budget is counted in.                                                                                                                                                                                                                                                               |
| Spend (total)     | Sunrise's org cap read, `getOrgCapState(orgId).spent` (`getMonthToDateOrgSpend` when no budget is set): every `AiCostLog` row of the org this month. The page and the budget gate read the same number: the total is cached for 10 seconds, the budget for 30, in both.                                                                                    |
| Budget            | `Org.settings.quotas.monthlyBudgetUsd` through the same read; `null` when none is set. New workspaces start at $10. Since t-57 this is a safety ceiling, not the allowance: reviews are paid for in CopyCredits ([credits.md](./credits.md)), and $10 is a testing value.                                                                                  |
| Spend by line     | The same cost rows, put on a line by their metadata: `assessmentId` → that review's project; `ephemeral: true` → kept nowhere, unless a calibration run wrote it (`calibrationRunId`); anything else (a deleted review's calls, a calibration run's, non-review AI use) → other, whose spend is the total less the rest.                                   |
| Reviews           | Stored assessments created this month, by `projectId`, whatever became of them (a cancelled or refused one counts); for kept-nowhere runs, the distinct `ephemeralRun` tags on their judge and editor cost rows (written from t-48); a run refused after only its project-context searches (t-75) spent counts no review, though its spend is on the line. |
| AI reviewer calls | The `attempts` on each judge or editor cost row, so a retried judge counts twice, as it is billed.                                                                                                                                                                                                                                                         |

What is **not** counted as a review: one since deleted (its spend stays, under
other), a kept-nowhere run that called no judge (a quick profile writes no cost
row), and a kept-nowhere run from before t-48 (its rows carry no run tag).

Reviews are dated by when they were created, spend by when it was billed. A
review created just before midnight UTC on the first whose judges were billed
after it shows its spend in the new month and its review in the old.

Projects are shown by id until `f-projects` adds the model and its names.

## Refused before it starts

Since t-58 a review is checked against the workspace's **CopyCredits** first,
then its monthly budget, the safety ceiling. The credit check is this same
machinery measured against the balance: 402 `INSUFFICIENT_CREDITS`, figures in
whole credits, and what is held back also counts what the reviews in flight
have spent so far, since they are charged only as they end. Its rules, the
charge and the overdraft bound are in
[`credits.md`](./credits.md#the-check-before-a-review-starts). The rest of
this section is the budget's.

A review that would pass the budget is refused before any judge is called,
stored or `store: false` (t-49, `assertReviewFits()` in
`lib/app/usage/budget.ts`, called last in `prepareAssessment`, and again by
`reserveReviewBudget()` as the request takes its hold, below). It is 402
`BUDGET_EXCEEDED`: nothing is stored, and a request refused by the first check
is not charged to the per-user cap.
`details` carries `estimateUsd`, its `basis`, `remainingUsd`, `inFlightUsd`,
`limitUsd` and `usagePage` (`/usage`); the remedy is an admin raising the
budget.

It refuses when nothing is left, or when the estimate is more than what is.
What is left is the budget less this month's spend, less `inFlightUsd`: what
the workspace's reviews in flight, stored or not, are yet to spend, so a
request does not count on budget a review already accepted will use. A judge is settled
once it answered or failed for good; one that failed with `rate_limited` or
`provider_error`, which a re-drive runs again, is not.

| In flight                             | Held back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QUEUED` or `RUNNING`                 | What it is yet to call, at this request's rate: a judge for each slot not yet settled, and the editor allowance for a review the editor runs on. Not its estimate less what it has spent: a re-drive calls an unsettled judge again at a full judge's cost, and the editor again, while a re-driven judge's row carries its first attempt's spend on. A retryable failure in this run is held as one being retried, since the rows cannot tell them apart, and the editor until the review is final. Judges it settled last month are reused, not called again. Held even with its lease run out: recovery runs it again. |
| `CANCELLED`, lease still live         | The larger of its unsettled judges (at most 4, the judges a run calls at once) at this request's rate, and its editor allowance: after a cancel either judges are still landing or the editor is mid-call, never both, and a retried failure cannot be told from a final one. An upper bound, for the lease's life, which the run renews until they have landed.                                                                                                                                                                                                                                                          |
| A request's hold (below)              | Its judges at this request's rate, and the editor allowance for a stored review the editor will run on. A `store: false` run is held at all its judges until it ends: it records none as they land.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `CANCELLED`, lease lapsed             | What it spent (`costUsd`), against the credits only: not yet charged until the recovery job clears the lease. Nothing yet to spend, so nothing against the cap. Only one made since charging began (the workspace's first credit entry, and within `CHARGE_SWEEP_MS`); older ones predate the charge.                                                                                                                                                                                                                                                                                                                     |
| `CANCELLED`, lease cleared; any other | Nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Requests arriving together

A request stores its review only once intake has fetched the page or read the
file (seconds), and a `store: false` one never does, so a check alone would let
requests sent together each pass on the same remainder (t-50). So the check
and a **hold** on the request's estimate are made in one transaction, under a
per-workspace advisory lock (`pg_advisory_xact_lock`): a request checked
behind another sees its hold in `inFlightUsd`. The route takes the hold
(`holdReviewBudget`) only after the place check and the per-user cap, so a
request refused 429 for either never holds budget another request is refused
402 for. The transaction waits up to 10s for a connection and runs for up to
15s, so the back of a burst queues for the lock rather than timing out; one
that still times out is refused 429 `RATE_LIMIT_EXCEEDED`, to try again, rather
than passed unheld. It holds a pooled connection while it waits, so a burst for
one workspace can take every connection the instance has (10 by default, 1 with
`DATABASE_POOL_MAX=1`) and its other queries wait behind it. A `store: false`
request is estimated and held without the editor allowance: the editor never
runs on it. The hold's check reuses the cost per
judge the first check read; only the cap and what is in flight are read again.
A request that passes the first check and is refused 402 here, having lost the
lock's race to a request sent with it, has been counted against the per-user
cap.

| Request        | Holds until                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Stored         | Its review is stored, whose row is then held in its place. Both count for a moment, never neither. |
| `store: false` | Its run ends, since it has no row (t-51).                                                          |
| Either         | However it ends before then: intake failing, the caller gone.                                      |

A hold is an `app_budget_hold` row (`BudgetHold`): the judge count and whether
the review is stored, under a lease renewed while it is held. One whose
process died stops counting when its lease runs out, and the next check in the
workspace deletes it. A check that cannot take the lock or write the hold in
time refuses nothing, as one that cannot read the history.

Every read the check makes runs on each non-quick request, the first time
before the per-user limiter, so each has an index serving its filter and order:
`app_assessment` `(orgId, profile, status, createdAt)` and
`(orgId, status, createdAt)`, `app_judge_run` `(orgId, status, createdAt)`,
`app_budget_hold` `(orgId, leaseExpiresAt)`, and Sunrise's `ai_cost_log`
`(orgId, createdAt)` for the `kept-nowhere` tier's bounded read.

The estimate is a cost per judge × the judges the request calls, plus an
editor allowance when the editor will run (2 judges or more). The cost per
judge, from the workspace's own history:

| Basis          | Cost per judge                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile`      | The median judge spend (cost less the editor's) per judge over the last 20 `COMPLETED` reviews of the same profile, given at least 3. Never for a `custom` judge list.                                                                                                                                                                                                                                     |
| `judges`       | The median `costUsd` of the workspace's last 100 `SUCCEEDED` judge runs.                                                                                                                                                                                                                                                                                                                                   |
| `kept-nowhere` | No stored judge run: the median spend of the judges of the workspace's `store: false` reviews (t-51), from their cost rows summed by `ephemeralRun` and `judge`. A judge whose row carries an `error` is left out, as are calibration runs' rows. Read from the workspace's last 500 cost rows, at most 100 judges: no index reaches into the rows' metadata, so the read is bounded rather than filtered. |
| `none`         | No history: `0`, so any positive remainder is enough.                                                                                                                                                                                                                                                                                                                                                      |

A rewrite's estimate has bases of its own, `rewrites` and `ceiling` (t-86), in
the same `details.basis` field: see "What it costs" in
[`rewrites.md`](./rewrites.md#what-it-costs).

The editor allowance is the median of what the reviews that tier read (the
profile's, or else the workspace's last 20 completed) spent beyond their judge
runs, over those the editor ran on: its call is on no judge run. The
`kept-nowhere` tier has none: the editor never runs on those reviews.

Per judge, so a profile whose judge list differs between frameworks or
versions is scaled to the request. Only reviews that completed feed the first
tier: a review cut short spent less than a review costs. A review calling no
judge (the quick profile) is never refused. No budget set, a budget that
cannot be read, or history that cannot be read refuses nothing; the
install-wide cap is left to the per-judge gate (`run-judge.ts`), which stays
the backstop for spend that lands between the check and the judges.

## Checked again when it is claimed

A stored review can wait in the queue (the workspace's running limit) while
other spend lands, so the run checks it again when it claims it (t-53,
`budgetRefusal()` with the review's id and creation time, from `run.ts`). The
estimate and what is left are worked out as above, except that `inFlightUsd`
holds back only the reviews in flight created before it. Not itself, which is
not yet to spend on top of itself, and not those after it: each of those was
admitted with this one held back already, so older reviews come first.
Holding back both ways would let two reviews claimed together each refuse on
the other's account, and neither run where one fitted. A later review that is
already running is not held, and the per-judge gate is left to catch it. Of
the holds, only `store: false` runs that began before it count: a stored
request's hold is a later review once stored, and until its request releases
it, may be this review's own.

A refused review is finished `FAILED` before any judge is called:

| Field          | Holds                                                        |
| -------------- | ------------------------------------------------------------ |
| `error`        | Why, with the figures: the 402's message without its remedy. |
| `errorCode`    | `INSUFFICIENT_CREDITS` or `BUDGET_EXCEEDED`.                 |
| `errorDetails` | The 402's `details`: the estimate, its basis and figures.    |

The API answers all three on the read and the list, and `errorCode` on the
events stream's `assessment_done`. The report page says the review was not
started for the budget and links `/usage`. Its place is freed and the next
queued review starts, and is checked in turn.

Only a review with no judge run yet is checked. A re-drive has already spent
on its judges, which a refusal would throw away; the per-judge gate ends it
`PARTIAL` with what it has. A check that cannot read the cap or the history
refuses nothing, as at the request.

## Demo usage for development

`prisma/seeds/app-howdoesthisland/002-demo-usage.ts` writes a month of usage
(about $5.80 of $10) into its own workspace, `usage-demo`, marked as the
demo's in `settings.app.usageDemo`, and makes every human platform admin its
owner. It does nothing when `NODE_ENV` is `production`
unless `SEED_DEMO_USAGE=true`: the rows are made-up spend that would count
towards a real install's global budget.

The figures are dated this month, so they read as zero once the month turns.
Re-running replaces them (the unit deletes the demo workspace's reviews and
cost rows first) and leaves its budget as it is: the $10 is set only when the
workspace is made. The runner skips a unit whose source is unchanged, so to run
it again, delete its history row and seed:

```sql
DELETE FROM seed_history WHERE name = 'app-howdoesthisland/002-demo-usage';
```

```bash
npm run db:seed
```

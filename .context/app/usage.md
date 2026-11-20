# Usage

A workspace's reviews, AI reviewer calls and spend this calendar month, by
project and in total, against its monthly AI budget (t-48, `f-usage`).

- **API:** `GET /api/v1/usage` — a browser session, or an API key with the
  `reports` scope. Declared in the route registry, so it is in the OpenAPI
  document and on `/developers`.
- **Page:** `/usage`, linked from the signed-in nav. A thin shell over the
  route (`components/app/usage/usage-summary.tsx`).
- **Service:** `getMonthUsage()` in `lib/app/usage/service.ts`; the wire shape
  is `lib/app/usage/wire.ts`.

## Where the figures come from

| Figure            | Source                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Month             | Midnight UTC on the first (Sunrise's `utcMonthStart`), the month every budget is counted in.                                                                                                                                                                                                                             |
| Spend (total)     | Sunrise's org cap read, `getOrgCapState(orgId).spent` (`getMonthToDateOrgSpend` when no budget is set): every `AiCostLog` row of the org this month. The page and the budget gate read the same number: the total is cached for 10 seconds, the budget for 30, in both.                                                  |
| Budget            | `Org.settings.quotas.monthlyBudgetUsd` through the same read; `null` when none is set. New workspaces start at $10 (D6).                                                                                                                                                                                                 |
| Spend by line     | The same cost rows, put on a line by their metadata: `assessmentId` → that review's project; `ephemeral: true` → kept nowhere, unless a calibration run wrote it (`calibrationRunId`); anything else (a deleted review's calls, a calibration run's, non-review AI use) → other, whose spend is the total less the rest. |
| Reviews           | Stored assessments created this month, by `projectId`, whatever became of them (a cancelled or refused one counts); for kept-nowhere runs, the distinct `ephemeralRun` tags on their cost rows (written from t-48).                                                                                                      |
| AI reviewer calls | The `attempts` on each judge or editor cost row, so a retried judge counts twice, as it is billed.                                                                                                                                                                                                                       |

What is **not** counted as a review: one since deleted (its spend stays, under
other), a kept-nowhere run that called no judge (a quick profile writes no cost
row), and a kept-nowhere run from before t-48 (its rows carry no run tag).

Reviews are dated by when they were created, spend by when it was billed. A
review created just before midnight UTC on the first whose judges were billed
after it shows its spend in the new month and its review in the old.

Projects are shown by id until `f-projects` adds the model and its names.

## Refused before it starts

A review that would pass the budget is refused before any judge is called,
stored or `store: false` (t-49, `assertReviewWithinBudget()` in
`lib/app/usage/budget.ts`, called last in `prepareAssessment`). It is 402
`BUDGET_EXCEEDED`: nothing is stored and the per-user cap is not charged.
`details` carries `estimateUsd`, its `basis`, `remainingUsd`, `inFlightUsd`,
`limitUsd` and `usagePage` (`/usage`); the remedy is an admin raising the
budget.

It refuses when nothing is left, or when the estimate is more than what is.
What is left is the budget less this month's spend, less `inFlightUsd`: what
the workspace's stored reviews in flight are yet to spend, so a request does
not count on budget a review already accepted will use. A judge is settled
once it answered or failed for good; one that failed with `rate_limited` or
`provider_error`, which a re-drive runs again, is not.

| In flight                          | Held back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `QUEUED` or `RUNNING`              | What it is yet to call, at this request's rate: a judge for each slot not yet settled, and the editor allowance for a review the editor runs on. Not its estimate less what it has spent: a re-drive calls an unsettled judge again at a full judge's cost, and the editor again, while a re-driven judge's row carries its first attempt's spend on. A retryable failure in this run is held as one being retried, since the rows cannot tell them apart, and the editor until the review is final. Judges it settled last month are reused, not called again. Held even with its lease run out: recovery runs it again. |
| `CANCELLED`, lease still live      | The larger of its unsettled judges (at most 4, the judges a run calls at once) at this request's rate, and its editor allowance: after a cancel either judges are still landing or the editor is mid-call, never both, and a retried failure cannot be told from a final one. An upper bound, for the lease's life, which the run renews until they have landed.                                                                                                                                                                                                                                                          |
| `CANCELLED`, lease gone; any other | Nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

It covers reviews already stored: requests arriving together each see none of
the others, and the per-judge gate is left to catch them.

Every read the check makes runs on each non-quick request, before the
per-user limiter, so each has an index serving its filter and order:
`app_assessment` `(orgId, profile, status, createdAt)` and
`(orgId, status, createdAt)`, `app_judge_run` `(orgId, status, createdAt)`.

The estimate is a cost per judge × the judges the request calls, plus an
editor allowance when the editor will run (2 judges or more). The cost per
judge, from the workspace's own history:

| Basis     | Cost per judge                                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile` | The median judge spend (cost less the editor's) per judge over the last 20 `COMPLETED` reviews of the same profile, given at least 3. Never for a `custom` judge list. |
| `judges`  | The median `costUsd` of the workspace's last 100 `SUCCEEDED` judge runs.                                                                                               |
| `none`    | No history: `0`, so any positive remainder is enough.                                                                                                                  |

The editor allowance is the median of what the reviews that tier read (the
profile's, or else the workspace's last 20 completed) spent beyond their judge
runs, over those the editor ran on: its call is on no judge run.

Per judge, so a profile whose judge list differs between frameworks or
versions is scaled to the request. Only reviews that completed feed the first
tier: a review cut short spent less than a review costs. A review calling no
judge (the quick profile) is never refused. No budget set, a budget that
cannot be read, or history that cannot be read refuses nothing; the
install-wide cap is left to the per-judge gate (`run-judge.ts`), which stays
the backstop for spend that lands between the check and the judges.

Not done:

- A queued stored review is not checked again when it is claimed.
- `store: false` reviews leave no assessment or judge-run rows, so they feed
  no estimate (a workspace that only sends those estimates `0`) and are not
  held back while in flight.

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

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
| Spend (total)     | Sunrise's org cap read, `getOrgCapState(orgId).spent` (`getMonthToDateOrgSpend` when no budget is set): every `AiCostLog` row of the org this month. The page and the budget gate read the same number, cached for 10 seconds in both.                                                                                   |
| Budget            | `Org.settings.quotas.monthlyBudgetUsd` through the same read; `null` when none is set. New workspaces start at $10 (D6).                                                                                                                                                                                                 |
| Spend by line     | The same cost rows, put on a line by their metadata: `assessmentId` → that review's project; `ephemeral: true` → kept nowhere, unless a calibration run wrote it (`calibrationRunId`); anything else (a deleted review's calls, a calibration run's, non-review AI use) → other, whose spend is the total less the rest. |
| Reviews           | Stored assessments created this month, by `projectId`; for kept-nowhere runs, the distinct `ephemeralRun` tags on their cost rows (written from t-48).                                                                                                                                                                   |
| AI reviewer calls | The `attempts` on each judge or editor cost row, so a retried judge counts twice, as it is billed.                                                                                                                                                                                                                       |

What is **not** counted as a review: one since deleted (its spend stays, under
other), a kept-nowhere run that called no judge (a quick profile writes no cost
row), and a kept-nowhere run from before t-48 (its rows carry no run tag).

Projects are shown by id until `f-projects` adds the model and its names.

## Demo usage for development

`prisma/seeds/app-howdoesthisland/002-demo-usage.ts` writes a month of usage
(about $5.80 of $10) into its own workspace, `usage-demo`, marked as the demo's in `settings.app.usageDemo`, and makes every human
platform admin its owner. It does nothing when `NODE_ENV` is `production`
unless `SEED_DEMO_USAGE=true`: the rows are made-up spend that would count
towards a real install's global budget.

The figures are dated this month, so they read as zero once the month turns.
Re-running replaces them, and leaves the demo's budget as it is (the $10 is set only when the workspace is made) (the unit deletes the demo workspace's reviews and
cost rows first). The runner skips a unit whose source is unchanged, so to run
it again, delete its history row and seed:

```sql
DELETE FROM seed_history WHERE name = 'app-howdoesthisland/002-demo-usage';
```

```bash
npm run db:seed
```

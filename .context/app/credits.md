# CopyCredits

What a workspace pays for reviews by the AI judges with (f-credits, t-57). It
stands in for billing until Sunrise ships it, and is shaped so billing can sell
credits later. The rulings are the planning decisions that superseded D6 and D7
(2026-11-20, in the Hub journal).

## The two limits, and what each is for

| Limit                                                  | Job                                                                         | Where                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------ |
| **CopyCredits**                                        | What people buy. A review needs enough of them before it starts (t-58).     | `lib/app/credits/`, table `app_credit_entry`     |
| **Monthly spending limit** (`quotas.monthlyBudgetUsd`) | A safety ceiling on one workspace's AI spend in a month, whatever the path. | Sunrise's `spend-caps.ts`, checked per paid call |

- A new workspace starts with **0 credits** and the **$10** monthly limit
  (`WORKSPACE_MONTHLY_BUDGET_USD`).
- **$10 is a testing value**, there to stop overspending while we test. The
  production value is the owner's call at launch (f-launch, l1).
- The limit must stay **set**: Sunrise reads no limit as unlimited.
- A platform admin raises a workspace's limit on its admin page
  (`PATCH /api/v1/admin/orgs/[id]`). A grant that leaves the balance worth more
  than the limit leaves this month answers with `capWarning`, because the
  limit, not the credits, would then stop the workspace's reviews.

## The rate

`CREDITS_PER_USD = 100` in `lib/app/credits/rate.ts`: to begin with, 100
credits ≈ $1 of LLM tokens. A cost converts with `creditsForUsd()`, which rounds
up to a whole credit so a real cost is never free. Every conversion goes through
that file. The price list replaces `creditsForUsd()` and nothing else.

## The ledger

`CreditEntry`, append-only. The balance is the sum of `amount`, and there is no
stored balance to drift.

| Kind     | Written by                    | Amount                | `reference`         |
| -------- | ----------------------------- | --------------------- | ------------------- |
| `GRANT`  | a platform admin, with reason | positive              | none                |
| `ADJUST` | a platform admin, with reason | either way, never `0` | none                |
| `REDEEM` | a code redeemed (t-60)        | positive              | `redemption:<id>`   |
| `CHARGE` | a review that ended (t-58)    | negative              | `assessment:<id>` … |

- `(kind, reference)` is unique, so one redemption or review is credited or
  charged once. Write through `recordCreditEntry(entry, tx)` inside the
  caller's own transaction.
- A wrong entry is corrected by another, never edited.
- `actorUserId` is SET NULL on erasure, so the workspace keeps its ledger.

**Who may change credits:** platform admins only, on `/admin/credits` or
`POST /api/v1/admin/credits/{id}/entries`. A workspace owner cannot grant
themselves credits. The route tests check that an org OWNER is refused.

**Where people see them:** `/usage` and `GET /api/v1/usage` (`credits`: balance
and this month's charges).

## Paths that spend AI money, besides reviews

From t-57's audit (2026-11-20). Credits gate **reviews** only, so every other
path that bills a workspace must be unreachable by a customer, or charge
credits too.

| Path                                                         | Reachable by a customer?                                                                                      | Disposition                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/api/v1/assessments/**` (reviews)                        | yes                                                                                                           | **Gated by credits** (t-58).                                                                                                                                               |
| `app/api/v1/admin/orchestration/**` and the rest of `/admin` | **yes today.** At `multi`, a workspace OWNER or ADMIN administers their own org, and every signup is an OWNER | **t-64:** platform admins only, through the fork's authorization policy. Upstream: sunrise#1309.                                                                           |
| `POST /api/v1/chat/stream`                                   | any member, on the org's `public` or `invite_only` agents                                                     | Unreachable once t-64 lands: only platform admins create agents, and the judges are `internal`.                                                                            |
| `POST /api/v1/webhooks/trigger/[slug]`                       | any member, with a self-minted `webhook` key                                                                  | Runs any active published workflow in the org, so nothing to run once only platform admins make workflows. t-64 confirms this, or narrows the scopes a non-admin may mint. |
| `embed/chat/stream`, `embed/speech-to-text`                  | anyone with an embed token                                                                                    | Tokens are minted in the admin area, so platform admins only after t-64. t-64 confirms a token cannot target a judge.                                                      |
| `POST /api/v1/mcp`                                           | an MCP key holder                                                                                             | Keys are minted in the admin area, so platform admins only after t-64. Customer MCP comes with f-mcp, which charges credits.                                               |
| `inbound/[channel]/[slug]`, approval tokens, schedules       | external senders and token holders, on admin-built triggers and workflows                                     | Platform admins build these after t-64.                                                                                                                                    |
| `POST /api/v1/scan`                                          | anyone                                                                                                        | **No AI call** (deterministic). Behind a switch and a code or account (t-61).                                                                                              |

Until t-64 merges, only the monthly limit bounds the admin paths.

# CopyCredits

What a workspace pays for reviews by the AI judges with (f-credits, t-57). It
stands in for billing until Sunrise ships it, and is shaped so billing can sell
credits later. The rulings are the planning decisions that superseded D6 and D7
(2026-11-20, in the Hub journal).

## The two limits, and what each is for

| Limit                                                  | Job                                                                                        | Where                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| **CopyCredits**                                        | What people buy. A review needs enough before it starts, and is charged as it ends (t-58). | `lib/app/credits/`, table `app_credit_entry`     |
| **Monthly spending limit** (`quotas.monthlyBudgetUsd`) | A safety ceiling on one workspace's AI spend in a month, whatever the path.                | Sunrise's `spend-caps.ts`, checked per paid call |

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

## The check before a review starts

t-58, in `lib/app/usage/budget.ts`, the same check that holds the monthly
budget (§19: the estimate, the holds for reviews in flight and requests
arriving together, the advisory lock, and the check again when a queued
review is claimed). It checks the credits first, then the cap.

- **What is left** is the balance less what the workspace's reviews in flight
  have spent so far and are yet to spend, compared in dollars at
  `CREDITS_PER_USD`. The spent part is the one change beyond "what is left":
  the cap's monthly spend already counts it, but the balance does not until
  the review is charged as it ends.
- **Refused** 402 `INSUFFICIENT_CREDITS` when the balance is `0` or below,
  nothing is left, or the estimate is more. `details`, in whole credits:
  `estimateCredits` (rounded up), `basis`, `balanceCredits`, `heldCredits`
  (rounded up), `remainingCredits` (rounded down), `usagePage`. The message
  says credits come from a review code or from HowDoesThisLand.
- **The cap still refuses** 402 `BUDGET_EXCEEDED` when the credits cover a
  review but the month's limit does not. `BUDGET_EXCEEDED` keeps its meaning,
  so a new code was added rather than the old one changed (decided in t-58):
  a caller can tell "buy credits" from "an admin must raise the limit".
- A balance that cannot be read is not checked (logged), as a cap that cannot
  be: the other bound and the per-judge gate still apply.
- A `quick` review calls no model and is never refused or charged.

## The charge

`lib/app/credits/charge.ts`. A review that ends is charged for its recorded
cost rows (`AiCostLog`, every billed attempt included), at `creditsForUsd()`,
rounded up to a whole credit. One that spent nothing writes no entry.

| Review                     | Charged by                                                                                                                                                                                            | `reference`             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Completed, partial, failed | the write that ends it (`finish()`, the last attempt's failure), in the same transaction                                                                                                              | `assessment:<id>`       |
| Cancelled while running    | the run's last write once its judges in flight land (`freePlace`), in the same transaction                                                                                                            | `assessment:<id>`       |
| Cancelled, never claimed   | the cancel itself                                                                                                                                                                                     | `assessment:<id>`       |
| Cancelled, its lease out   | the recovery job, clearing the lapsed lease in the same transaction (the cancel does not: the run may be alive, its renewals failing)                                                                 | `assessment:<id>`       |
| Given up on                | the recovery job's give-up write                                                                                                                                                                      | `assessment:<id>`       |
| Deleted, not yet charged   | the delete, in its transaction, even while a run holds it (that run's process may be gone)                                                                                                            | `assessment:<id>`       |
| `store: false`             | the request once the run ends, however it ends, before its hold is released                                                                                                                           | `ephemeral-run:<runId>` |
| `store: false`, left over  | the recovery job, once the run's rows are an hour quiet (its charge failed, or it died)                                                                                                               | `ephemeral-run:<runId>` |
| A rewrite (t-81)           | the write that ends it, even once its row is gone or recovery has ended it; the delete of its review while it runs; the rewrite recovery job once its lease runs out ([`rewrites.md`](./rewrites.md)) | `rewrite:<id>`          |

- **Once.** The insert skips a duplicate `(kind, reference)` (ON CONFLICT DO
  NOTHING), so finishers that race write one entry. A stored review is never
  claimed again once final, so its one charge covers every attempt's rows,
  re-drives and recoveries included. `npm run smoke:credit-charge` races
  eight finishers against the database.
- **Held or charged, never neither.** Charging in the write that ends a
  review means the check sees it either in flight, holding back what it has
  spent, or in the balance. A cancelled review whose run died is held back
  for what it spent until the recovery job charges it, and the purge leaves
  it until then. A `store: false` run whose charge failed keeps its hold for
  an hour and twenty minutes, past the recovery job's charge. The balance is read after what
  is in flight, so a review charged between the two is counted twice, never
  not at all.
- **Only since charging began.** No review made before its workspace's
  first credit entry is charged (`chargeStoredReview`): a review starts only
  on a positive balance, so every review since charging began was made after
  that entry, and one made before it, still in flight at the deploy, ran
  before reviews were charged. The recovery job, the check's hold and a
  delete also leave a cancelled review alone once it was cancelled more than
  `CHARGE_SWEEP_MS` (a day and an hour) ago. A charge the recovery job
  cannot make is logged and tried again next tick; the rest of its pass goes
  on.
- **Not yet charged, on delete:** `QUEUED` or `RUNNING`, or `CANCELLED` with
  its lease still set (since charging began). A final review is not charged by
  its delete: it was charged as it ended, or ended before reviews were charged.
- **In the write that ends it, deliberately.** A charge that fails rolls the
  end back with it, so a review is never final and uncharged; the run hands
  it back to the queue as any database failure does.
- **What it can miss:** a cost row that lands after the charge, from a run
  that lost its lease while another finished the review, or after a delete or
  a lapsed cancel lease, or from a `store: false` run after an hour's quiet.
  At most `JUDGES_IN_FLIGHT` calls each time, still bounded by the monthly
  cap. The recovery job charges at most `RECOVERY_BATCH` of each kind a tick.

## Overdraft

A review that passed the check costs what it costs: it is never cut short
for credits, and is charged in full as it ends, so the balance can go below
zero. The bound: by at most what the reviews in flight cost beyond their
estimates, since each started only with a positive remainder covering its
estimate, and by up to a credit for each of them, since the check compares
dollars and each review's charge is rounded up to a whole credit. At most `RUNNING_PER_WORKSPACE` (3) run at once, and the monthly cap
bounds what they spend. With no history the estimate is `0`, so a workspace's
first review starts on any positive balance and can take it below zero by up
to that review's cost. Below zero, every review is refused until an admin
adds credits; the per-judge gate stays as the backstop.

## Free review codes

t-59, `lib/app/credits/codes/`, table `app_review_code`. A code gives the
workspace that redeems it `creditsPerRedemption` credits, up to
`maxRedemptions` times, until `expiresAt`. Redeeming it is t-60
([below](#redeeming-a-code)), which writes a redemption row and a `REDEEM`
entry. What is used of a code is the count of its redemption rows.

| Kind of code    | `count` | `maxRedemptions` |
| --------------- | ------- | ---------------- |
| Personal        | 1       | 1                |
| QR card         | 1       | N                |
| Batch for a rep | N       | 1                |

- **Install-level.** `ReviewCode` is `globalConfig`: no `orgId`, made by
  platform admins and redeemed into whichever workspace redeems it. The write
  routes declare `writesSharedSettings`, so at `multi` an admin mints and
  revokes from the install org (a session in another org gets 403 `FORBIDDEN`,
  reason `shared_settings_install_org_only`).
- **The code.** Twelve characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no
  `0`/`O`, `1`/`I`/`L`), about 59 bits, shown as `ABCD-EFGH-JKMN`. Stored
  canonical (upper case, no dashes). `normaliseCode()` reads what someone
  typed, in any case, with or without dashes or spaces.
- **Stored, not hashed (t-59 decision).** The admin page shows every code's
  link and QR, to reprint a card or resend a personal code, and a hash cannot
  give that back. What a stolen code is worth is bounded: its credits, its
  redemptions left, its expiry, and revoking it. The subject export leaves the
  code out of a maker's copy: it is a credential, not data about them. It
  leaves out the idempotency key too, which may carry a lead's id.
- **The link** is `NEXT_PUBLIC_APP_URL` + `/redeem?code=<code>`; the QR
  encodes it (`uqr`, error correction M, four-module margin). The page draws
  it in the browser and downloads it as SVG or a PNG of about 1,000px.
- **Status**, in this order: `revoked`, `expired`, `used-up`, `active`.
- **Revoking** sets `revokedAt` once; the row stays, and credits a code
  already gave stay given.
- **Creator** (`createdByUserId`): hand-written FK to `user`, SET NULL, drift
  probe in `lib/app/db-drift.ts`; the codes a person made are in their subject
  export.

### The issuing API

`POST /api/v1/admin/codes` (platform admin, session or `admin` API key)
mints `count` codes alike, with a `campaign` label. It is shaped for ConQuest
to mint a code for a qualified lead later; that wiring is not built.

- **`idempotencyKey`** makes a retried call mint once. The same key and body
  answer **200** with the codes first minted (`replayed: true`); a new mint
  answers **201**. The same key with a different body is **409** `CONFLICT`.
  A retry is validated like a first call, so one sent after `expiresAt` has
  passed is refused 400: give a code more life than the caller retries for.
  `(idempotencyKey, batchIndex)` is unique, so two calls racing with one key
  mint once: the loser reads back the winner's codes.
- **Keys are install-wide**, not per caller: a key another caller already
  used answers with its codes, or 409. Send keys unique to the caller: the
  form sends 128 random bits; an integration should prefix its own ids
  (`conquest:lead-123`).
- The admin form keeps a request's key until it is answered, so saving the same form again after a failed answer cannot mint twice while the
  page stays open (a reload or a search starts afresh, so its message says to
  check the list first); a changed form is a
  new request with a new key.
- `GET /api/v1/admin/codes?q=` lists the newest 200, by campaign or code;
  `DELETE /api/v1/admin/codes/{id}` revokes.

### Redeeming a code

t-60, `lib/app/credits/codes/redeem.ts`, table `app_review_code_redemption`.

**The code row is never written by a redemption.** A code is shared config
(`globalConfig`), which only platform admins change, and Sunrise's
shared-settings check (`scripts/ci/shared-settings-writes.ts`) refuses a
customer route that writes one. A redemption is the workspace's, so the count
lives with the redemptions: t-59's stored `redemptionCount` was dropped for
it (decided in t-60). One source of truth, as the ledger is for the balance.

- **Never more than the maximum.** A redemption takes the next `slot`, the
  code's row count, only while that is below `maxRedemptions`.
  `(codeId, slot)` is unique, so of redemptions racing for one slot one
  inserts and the rest fail on the index; each tries again in a new
  transaction, and takes the next slot or finds
  the code used up. Distinct slots each below the maximum cannot number more
  than it.
- **No one turned away while uses are left.** A try loses its slot only when
  another redemption commits, so a redeemer loses at most `maxRedemptions`
  times before finding the code used up. The retries are bounded by that, not
  by a fixed count a crowd at an event could exhaust (t-60 review; an earlier
  cap of 20 and its 503 `CODE_BUSY` were dropped).
- **Once per person per code.** `(codeId, userId)` is unique.
- **Credited where it is counted.** The redemption and its `REDEEM` entry
  (`redemption:<id>`) are one transaction, with the balance read in it.
- **Uses never come back.** No redemption row is deleted, so slots stay dense.
  The code FK is RESTRICT; the workspace and the person are SET NULL on
  erasure (the person's FK is hand-written, drift probe in
  `lib/app/db-drift.ts`). A workspace deleted after redeeming a personal code
  does not make it redeemable again, and the person still cannot redeem it
  twice.
- `npm run smoke:redeem-codes` races eight people for a three-use code and one
  person pressing six times, at `multi`, then erases them and the workspace.

**The routes.** Both take the code in the body, as typed, so it is never in a
logged URL.

| Route                       | Who                                         | Answers                                                                                                                                              |
| --------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/codes/check`  | anyone                                      | `status`: `active` (credits, expiry), `expired`, `used-up`, `revoked`, or `unknown`                                                                  |
| `POST /api/v1/codes/redeem` | a session, or a key with the `assess` scope | the credits, the balance after, the workspace; 404 `CODE_UNKNOWN`, 410 `CODE_EXPIRED` / `CODE_USED_UP` / `CODE_REVOKED`, 409 `CODE_ALREADY_REDEEMED` |

**What a refusal says.** A real code says which of expired, used up or
revoked it is: knowing a real code cannot be used is worth nothing to someone
guessing. Anything malformed or not found is `unknown`, alike, so a guess
learns nothing about why it missed.

**Guessing.** A code is about 59 bits, so the caps stop a script hammering the
lookup, not a guesser:

- the `redeem` proxy rule (`lib/app/rate-limit.ts`), keyed on IP,
  `CODE_ATTEMPTS_PER_MINUTE_PER_IP` (120) across the page and both routes. It is
  the looser of the two because a QR card is handed out at events, where a room
  scanning together shares one address, and one person's way through takes
  several requests (raised from 30 in t-60's review). A page load counts only
  when it carries a code: the header links to the bare page and Next prefetches
  it on every public page, so counting those let a room browsing behind one
  address spend the allowance before anyone entered a code (t-66). The skip
  reads the URL, not a prefetch header, so no header gets a real attempt past
  it;
- per person in the redeem handler, `REDEEM_ATTEMPTS_PER_MINUTE_PER_USER` (10),
  every attempt counted, a malformed one too.

**The page, `/redeem?code=…`** (`app/(public)/redeem/page.tsx`): the link and
QR land here.

- No code: a box to type one into (a plain GET form back to the page).
- Not redeemable: which, as above, and a box for another.
- Signed out: what it gives, and **Create an account** / **Sign in**, each with
  `callbackUrl=/redeem?code=…`, so the person comes back here. The sign-up form
  carries the callback through email verification and OAuth (a carried edit,
  ledger row 22; sunrise#1315).
  - A verification link that fails (expired, used) comes back here with
    better-auth's `?error=`, not to the platform's verification page; the
    panel then says so, and that signing in sends a new link.
  - **Known limit:** a verification email sent again from the platform's pages
    (`/verify-email`, the login form) carries no callback, so it lands on the
    landing route. The code's own link still works once the person is
    verified. Part of sunrise#1315.
- Signed in: what it gives, and one press that redeems into the active
  workspace, then the balance and where to go next. A press, not a
  redemption on load, so the person sees what they add, and a link opened by
  anything else redeems nothing (decided in t-60). Or, if they already have,
  says so, ahead of the code's own state: someone who used a personal code's
  one redemption is told they have it, not that it is used up.

**Privacy.** The rows are in the person's subject export (`codeRedemptions`)
and the workspace's org export.

## Paths that spend AI money, besides reviews

From t-57's audit (2026-11-20). Credits gate **reviews** only, so every other
path that bills a workspace must be unreachable by a customer, or charge
credits too.

| Path                                                         | Reachable by a customer?                                                                                                         | Disposition                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/api/v1/assessments/**` (reviews)                        | yes                                                                                                                              | **Gated by credits** (t-58).                                                                                                                                                                                                                                                                                                                                                             |
| `app/api/v1/admin/orchestration/**` and the rest of `/admin` | **no.** Sunrise's default would let a workspace OWNER or ADMIN administer their own org at `multi`, and every signup is an OWNER | **Closed by t-64:** `lib/app/authorization.ts` lets only platform admins administer, at every `withAdminAuth` route, the admin layout and the maintenance bypass. Upstream: sunrise#1309.                                                                                                                                                                                                |
| `POST /api/v1/chat/stream`                                   | any signed-in member, or a self-minted key of **any** scope (see below), on the org's `public` or `invite_only` agents           | **Harmless (t-64).** Only platform admins create agents or change an agent's visibility, and platform agents (the judges) are held at `internal` by the reconcile (`PLATFORM_AGENT_BASELINE`). A workspace has no agent this route will run.                                                                                                                                             |
| `POST /api/v1/webhooks/trigger/[slug]`                       | any member, with a self-minted `webhook` key                                                                                     | **Harmless (t-64).** It runs an active, published workflow in the key's org, and workflows are made only by admin routes (platform admins now) and the install-org seed. Provisioning a workspace reconciles agents, not workflows. Scopes left as they are.                                                                                                                             |
| `embed/chat/stream`, `embed/speech-to-text`                  | anyone with an embed token                                                                                                       | **Harmless (t-64).** The one place a token is minted is `POST /api/v1/admin/orchestration/agents/[id]/embed-tokens` (`withAdminAuth`, platform admins now), and no seed makes one. `resolveEmbedToken` does not check visibility, so a platform admin must not mint one for a judge.                                                                                                     |
| `POST /api/v1/mcp`                                           | a workspace MCP key holder (made from settings by an OWNER or ADMIN, t-95), or an admin-made key                                 | The app's tools spend through the review path: `assess_draft` charges credits as `POST /api/v1/assessments` does (t-92, [`mcp.md`](./mcp.md)). **Exposure is install-wide**: `McpExposedTool` has no org, so exposing a core tool (`search_knowledge_base`, `run_workflow`, `call_external_api`) gives it to every workspace key, spending outside credits. Expose only the app's tools. |
| `inbound/[channel]/[slug]`, approval tokens, schedules       | external senders and token holders, on admin-built triggers and workflows                                                        | Harmless: only platform admins build these (t-64).                                                                                                                                                                                                                                                                                                                                       |
| `POST /api/v1/scan`                                          | anyone while its switch is on: signed out, the scores only; a member or an `assess` key, the full result                         | **No AI call** (deterministic). A code is ignored (t-68).                                                                                                                                                                                                                                                                                                                                |

Every path above is also bounded by the workspace's monthly AI budget (`lib/app/workspaces/provision.ts`).

### Self-service API keys (t-64)

Any signed-in user can mint a key with core's scopes (`chat`, `knowledge`,
`webhook`, `analytics`) at `POST /api/v1/user/api-keys`. Only `webhook` is
ever checked, at the webhook trigger. `withAuth` accepts a key of any scope
on a route that names none, so a `chat` key reaches the same `withAuth` routes
as its owner's session. That spends nothing: the AI routes it reaches are
consumer chat and the webhook trigger above, and a workspace has no agent or
workflow there for them to run. So the scopes a non-admin may mint are left
unchanged. Narrowing them becomes necessary the day a workspace can have a
`public` agent or a published workflow.

### Core org routes a workspace owner still reaches

These ask `canRead`, not `canAdminister`, so t-64 leaves them open on purpose.
The default admits an org's OWNER or ADMIN to their own org there, and none of
them spends: the roster (`/api/v1/orgs/[id]/members`, which `/settings/workspace`
uses), core's org invitations, and support-access grants (consent for HCE to
enter the workspace).

**Support access has no customer screen.** Its API
(`/api/v1/orgs/[id]/support-grants`) still admits a workspace OWNER or ADMIN, but
the only screen that calls it was `/admin/support-access`, which t-64 closes.
Until a section under `/settings/workspace` calls it, a workspace cannot grant
HCE support access from the product.

# Rewrites

A review says what to change; a rewrite is the draft that does it. The editor
rewrites a finished review's text, streaming the draft as it writes, and the app
keeps it. Built in t-81 (f-rewrite, app-plan §8.2). The report's drawer (t-82),
the placeholders as fields (t-83) and reviewing a rewrite as a comparison (t-84)
build on it.

## The API

| Route                                 | What it does                                                        |
| ------------------------------------- | ------------------------------------------------------------------- |
| `POST /api/v1/rewrites`               | Rewrite a finished review. Answered once it ends, or streamed.      |
| `GET /api/v1/rewrites?assessmentId=…` | A review's rewrites, newest first.                                  |
| `GET /api/v1/rewrites/{id}`           | One rewrite: the draft as last saved while it runs, then the whole. |

All three take a browser session or an API key with the `assess` scope. The
body is `{ assessmentId, focus?, stream? }`:

- **`focus`**: `balanced` (the default) or an appeal (`ethos`, `pathos`,
  `logos`, `kairos`). The framework names them (`engine.rewriteFocuses()`), so
  another framework would have its own. Any other is a 400 whose
  `details.focus` lists them.
- **`stream: true`** answers Server-Sent Events: `rewrite` (the row,
  `running`), `rewrite_text` for each piece as it is written, then
  `rewrite_done` (the row, `completed` or `failed`). Without it, the answer is
  the row once it ends.

Only a `completed` or `partial` review can be rewritten. Anything else, or a
review whose framework version can no longer be run, is a 409
`ASSESSMENT_NOT_REWRITABLE`. A `store: false` review has no row to rewrite
from.

A rewrite that fails after it started answers `failed`, with the editor's
`errorCode` (`refused`, `truncated`, `provider_error`, `over_budget`,
`rate_limited`, `agent_inactive`, `model_not_approved`, `lost` for one whose
process died, `internal_error`) and the draft it had written by then.

## What the editor reads

The prompt is the prototype's `rewritePrompt()`, ported to
`lib/app/frameworks/howdoesthisland/engine/rewrite.ts` behind the engine's
`buildRewriteRequest`. It carries the target mix and scores, the weakest appeal
(or the focus), the audience, the content type's watch-outs, the balance
findings, the misused levers, and up to 16 of the review's recommendations.
Each has its move and, when the AI reviewer wrote it, its suggested wording.

Three things differ from the prototype:

- **The duty this reader needs** is the one the review's target weights
  highest (`primaryDutyOf`). The prototype took the one weighted exactly 40,
  which held only while the primary duty's weight was 40 (BRIEF §5).
- **The project's context** is given as background to write with, fenced as
  the judges' is (D21). That is the passages the review's AI reviewers read
  (stored on the review) with the project's brief **as it is now**, so a brief
  written after the review reaches the rewrite. The documents are not searched
  again: that would cost a search per rewrite and could give passages the
  judges never saw. A review whose project has gone keeps the brief it stored.
- **The content and the context are data**, and the prompt says so.

A fact only the writer knows is left as a `[placeholder in square brackets]`,
as in the prototype. t-83 turns those into fields.

## How it runs

`lib/app/rewrites/service.ts`:

1. **Checked**: the review is the workspace's and finished, the focus is the
   framework's, and the prompt builds. Nothing is written or held yet.
2. **Held**: the `RUNNING` row is written inside the budget check's
   transaction, under the workspace's lock (`reserveRewriteBudget`). The row is
   the hold: its `heldUsd` (the estimate, below) counts in every later check
   until it ends, reviews' and rewrites' alike.
3. **Called**: `streamAgent` (`lib/app/judges/run-judge.ts`) makes the call
   with the same checks as a judge's: the binding, the editor's approved list,
   the budget gate, the agent's rate limit and its privacy scope. The cost rows
   are written the same way. It asks for little thinking (`reasoningEffort:
'low'`), and its ceiling is sized from the text's length (`rewriteMaxTokens`),
   so the longest text's reply fits the editor's cap. A stream is not retried:
   what it streamed has already been shown.
4. **Kept on its own**: the call runs under `keepRunningAfterResponse`, not as
   part of the response, so a reader that stops listening does not stop it.
   Every `DRAFT_SAVE_MS` (5s) it saves what it has written and renews its
   lease. A save that finds the row gone (its review was deleted) stops the
   call.
5. **Ended**: one write, `COMPLETED` with the draft or `FAILED` with the reason
   and what was written, and the charge in the same transaction.

Under `pseudonymise`, the provider manager restores the placeholders in each
piece before the rewrite sees it, including one split across two pieces
(`tests/unit/lib/app/judges/run-judge-pseudonymise.test.ts`).

## What it costs

A rewrite is charged in CopyCredits for what its call cost, once it ends,
under the reference `rewrite:<id>` (`chargeRewrite`). Its cost rows carry
`editor: 'rewrite'` and `rewriteId`, and no `assessmentId`: a review is
charged once, when it ends, and a rewrite comes after.

**The estimate** the check holds is the median cost of the workspace's last 20
completed rewrites (`basis: "rewrites"`), or `0` with none (`basis: "none"`),
as for a workspace's first review. The editor's summary spend is no guide: a
summary writes a few sentences, a rewrite the whole text. The refusals are a
review's (402 `INSUFFICIENT_CREDITS`, `BUDGET_EXCEEDED`, `details` the same),
worded for a rewrite.

**What it can miss.** Spend that lands after the charge: a call still running
when its review is deleted (the delete charges what its rows record by then,
and the call stops at its next save), or one whose review is purged by the
retention window while it runs. The monthly cap still bounds both.

## When the process dies

The rewrite keeps `RUNNING` with its lease running out. The rewrite recovery
job (`app:rewrite-recovery`, every 15 minutes per workspace,
`lib/app/rewrites/recover.ts`) fails it (`errorCode: lost`), keeping its saved
draft, and charges its cost rows in the same transaction. Until then it holds
its estimate. A call that died before the provider answered wrote no cost row,
so it is charged nothing.

## Limits

- `REWRITES_PER_MINUTE` (10) per user, across sessions and keys: a
  handler-level sub-cap, as for reviews that call judges.
- The route's `maxDuration` is 310s, over the editor's longest timeout.

## Data

`Rewrite` (`app_rewrite`) is tenant-owned (`org_isolation`). Its FK to its
assessment cascades, so a delete or the retention purge takes it. Its maker's
FK to `user` is hand-written, SET NULL, with a drift probe. The subject and
org exports carry rewrites without the lease or the hold.

## Checking it against the database

`npm run smoke:rewrite-charge` (free, no AI call) runs in a fresh workspace
as the restricted app role. It checks that a running rewrite's estimate is
held by the next check, that a rewrite refused for credits writes no row, that
recovery fails and charges a lost one once, from its own cost rows only, and
that deleting the review takes its rewrites. It cleans up after itself.

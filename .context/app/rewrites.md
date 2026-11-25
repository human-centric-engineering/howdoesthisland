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
process died, `timed_out` for one whose call ran past `REWRITE_CALL_MS`,
`internal_error`) and the draft it had written by then.

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
   As the call starts, once its checks have passed, the row keeps what it is
   priced from (`callStart`: the agent, provider, model, the prompt's token
   count and the framework version, `lib/app/rewrites/call-start.ts`). It
   saves what it has written and renews its lease as soon as it has the
   first piece, then every `DRAFT_SAVE_MS` (5s). A save that finds the row
   gone (its review was deleted) stops the call.
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
rewrites that ended and cost something, failed ones too (`basis: "rewrites"`).
The editor's summary spend is no guide: a summary writes a few sentences, a
rewrite the whole text.

With none, it is what this request can cost at most (`basis: "ceiling"`, t-86):
its prompt (the editor's instructions and the request, counted by the model's
tokeniser) and its whole output ceiling (`rewriteMaxTokens(text)`, never above
the approved entry's or the agent's), at the editor's price at its binding
(`streamCeilingUsd`). So it scales with the text, and several first rewrites
asked for together cannot each pass on a remainder that covers one. It is
priced at the model's list rate, so near the most rather than a bound: a call
served at a priority tier or writing to the prompt cache is billed above list.
A first rewrite is charged what it cost, usually much less. It is
`0` (`basis: "none"`) only when that is nothing: a local or unpriced model, or
an editor that would refuse the call before it spent.

A workspace's first review still holds `0` (`basis: "none"`): this changed
rewrites only. The refusals are a
review's (402 `INSUFFICIENT_CREDITS`, `BUDGET_EXCEEDED`, `details` the same),
worded for a rewrite.

**Charged by the call, whatever became of its row.** A streamed call writes its
cost row only when it ends, so a charge made while it runs finds nothing and
writes no entry: the delete of its review (which takes the rewrite, and stops
the call at its next save), or recovery ending one whose saves failed past its
lease. The call's own end charges again, after its cost row lands, under the
same reference, so it is charged once whoever gets there first. A live call
whose row recovery ended `lost` sets it `RUNNING` again at its next save, and
its ending replaces recovery's. The retention
purge leaves a review alone while one of its rewrites runs.

**A call stopped part-way** (its signal, a save that failed, a dropped
connection, or running past `REWRITE_CALL_MS`, 750s after its row was written,
on any host) reports no usage, since a provider reports it in a stream's last
event. One that had answered at all is recorded at an estimate: the prompt and
what it streamed, counted by the model's tokeniser, its row tagged
`estimated: true`. Thinking is not counted, so the estimate is low, never
high. One stopped before any reply is recorded at nothing.

## The report's drawer

The web report's **Rewrite** action (`components/app/report/report-actions.tsx`)
opens a drawer, `rewrite-drawer.tsx`, built in t-82. It is in the report's
actions, so the PDF and a shared link, which render the report alone, never
show it.

- **Focus**: balanced, or one of the review's appeals (`rewrite-focuses.ts`,
  from the report's own appeal names), each with its `<FieldHelp>`.
- **Writing**: `POST /api/v1/rewrites` with `stream: true`, read with
  `fetch` and `parseSseBlock` (`rewrite-client.ts`). Each `rewrite_text` is
  added to the draft as it arrives.
- **Earlier rewrites**: opening the drawer reads the review's list (one call,
  each row with its draft), and any of them reopens. One still `running` is
  read again (`GET /api/v1/rewrites/{id}`, every 3s) until it ends.
- **A dropped stream starts nothing.** The rewrite carries on, and is charged,
  on the server however the reader goes, so a second `POST` would be a second
  charge. With the first event's row in hand, the drawer follows that rewrite,
  and the draft shown only grows while it runs: the stored draft is saved every
  few seconds, so it can be behind what streamed. When the stream dropped
  before its first event, the drawer reads the list again and follows the
  newest running rewrite of the focus asked for that was not listed before the
  request and is no older than it (`startedSince`; a minute's slack for clock
  skew). Someone else starting the same focus on the same review in that
  minute would still match: nothing on the row says who started it. Otherwise
  it says the connection dropped. Closing the drawer mid-draft stops only the
  reading: the rewrite is listed, writing, on the next open.
- **The list** is each read laid under the rows the drawer has seen since
  (`mergeRewrites`), so a read that lands after a rewrite started does not
  hide it, and only the latest read's answer is shown.
- **Copy** copies the draft. **Review this draft** reads the review
  (`GET /api/v1/assessments/{id}`) and starts a review of the draft with the
  same model version, reader context, project and AI reviewers (a quick review
  is reviewed quickly again: `judges` takes at least one), then opens it. In
  t-84 that becomes a comparison with the original.
- **Refusals** show beside the button pressed, with `<SaveError>`. Credit and
  budget refusals use the assess page's `refusalOf`, with the usage link; the
  rate limit is worded for rewrites, without blaming the reader, since a burst
  of the workspace's requests answers it too (`rewriteRefusalOf`). A review of
  the draft refused for a retired model version says so, rather than to reload
  (`reviewDraftRefusalOf`): the draft is reviewed with its original's
  version. A rewrite that started and then failed shows the server's `error`
  and keeps what it wrote.

## When the process dies

The rewrite keeps `RUNNING` with its lease running out. The rewrite recovery
job (`app:rewrite-recovery`, every 15 minutes per workspace,
`lib/app/rewrites/recover.ts`) fails it (`errorCode: lost`), keeping its saved
draft, and charges its cost rows in the same transaction. Until then it holds
its estimate. One whose process was alive after all charges itself as it ends
(above).

Recovery leaves a rewrite that kept its call (`callStart`) alone until it is
`REWRITE_LIFETIME_MS` (800s, the route's `maxDuration`) old. The call stops
itself at `REWRITE_CALL_MS` (750s) on any host, writing its own cost row, so a
rewrite recovery prices has a call that has stopped and will write no row
after the estimate. One that kept no call is ended once its lease runs out:
there is nothing to price, and no call to wait for.

A pass claims a rewrite first (a lease of its own, `CLAIM_MS`), then writes
any estimate, then ends and charges it in one transaction that matches only
its claim. A save from a call that lived after all, or another pass, changes
the claim, and the pass leaves the row. The estimate is written with no
transaction open, so a pass needs one connection at a time. A pass that fails
part-way leaves its claim to run out; the next finds its estimate and charges
it without another. An estimate write that fails is left for the next pass
too, for an hour (`PRICING_RETRY_MS`), unless the agent it names is gone
(every pass would be refused): that one, or one still failing after the hour,
is ended uncharged, and logged. A pass takes its batch from the rewrites due,
so young ones that kept a call never keep a due one waiting.

**One account of a call** (`settleRewriteCostRows`). Whatever charges a
rewrite (recovery, or its call as it ends) first leaves it one account of its
call: should the call's own cost row have landed beside recovery's estimate (a
process that stalled past the lifetime, then recovered), the estimate is
removed; should two passes each have written one, the later goes. So neither
the charge nor the monthly cap counts a call twice. One already charged at the
estimate stays charged at it (one reference): low, never high. Each pass also
settles again the rewrites it ended `lost` in the last day, for a call whose
own row landed after recovery ended it, and which never ended itself.

**Priced when it left no row** (t-85). A streamed call writes its cost row only
as it ends, so one whose process died part-way through the stream (the platform
cut it off, or the server stopped) left none, though the provider billed it.
When a lost rewrite has no cost row of its own, recovery writes the one the call
would have written had it been stopped there (`recordStoppedStream`): the
prompt's token count it kept (`callStart`) and its saved draft counted by the
model's tokeniser, at its binding's price, tagged `estimated: true` and
`error: "lost"`. Then it charges it, once, as any other. The monthly cap sees
the row too.

**What it can miss.**

- **A rewrite with no saved draft is charged nothing.** The provider may not
  have answered (it died before the call's checks passed, or while the model
  was still thinking). As for a stopped call, a reply that is not known to
  have started is not charged.
- **The estimate is low.** Thinking is not counted, and nor is what it wrote
  after its last save (up to 5s of it). As for a stopped call: low, never
  high.
- **A call whose process stalls past the lifetime** and then writes its own
  cost row, after recovery charged its estimate, is charged the estimate (one
  reference). Its estimate is removed when the call ends, so the cap counts
  only its own row.
- **A rewrite that kept no `callStart`** (that write failed, and is logged) is
  charged nothing, as before t-85. Recovery logs one that saved a draft, since
  the provider answered it.
- **A review's judge call** that dies with its process is still missed: this
  changed rewrites only.

## Limits

- `REWRITES_PER_MINUTE` (10) per user, across sessions and keys: a
  handler-level sub-cap, as for reviews that call judges.
- `REWRITE_CALL_MS` (750s) stops a call still running then, on any host:
  long enough for the editor's largest reply (32,768 tokens) at 45 tokens a
  second, after the budget lock's wait (10s). Nothing else bounds a stream on
  a long-running server; the provider's timeout covers the connection only.
- The route's `maxDuration` is 800s, the most Vercel allows (Pro, fluid
  compute), leaving 50s for the call's cost row before recovery may price it
  (`REWRITE_LIFETIME_MS`). A plan with a lower ceiling cuts a long rewrite off
  sooner; recovery ends and charges it.

## Data

`Rewrite` (`app_rewrite`) is tenant-owned (`org_isolation`). Its FK to its
assessment cascades, so a delete or the retention purge takes it (the purge
not while it runs). Its maker's
FK to `user` is hand-written, SET NULL, with a drift probe. The subject and
org exports carry rewrites without the lease or the hold.

## Checking it against the database

`npm run smoke:rewrite-charge` (free, no AI call) runs in a fresh workspace
as the restricted app role. It checks that a running rewrite's estimate is
held by the next check, that a rewrite refused for credits writes no row, that
recovery fails and charges a lost one once, from its own cost rows only, that
one that died mid-stream with no cost row is priced from its `callStart` and
draft and charged once, that one that died with no draft is charged nothing,
and that deleting the review takes its rewrites. It cleans up after itself.

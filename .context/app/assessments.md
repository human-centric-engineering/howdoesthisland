# Assessments

An assessment scores one text against one framework version: the quick scan,
then the judges its profile chose, put together by the engine's `assemble()`.
It runs as a job, so it survives a judge failing and a process dying. Design:
[`planning/app-plan.md`](./planning/app-plan.md) §8.2 and §9.

The library is `lib/app/assessments/`. The API on it (t-24) is in
`lib/app/assessments/api/` and the routes under `app/api/v1/scan/` and
`app/api/v1/assessments/`; see [The API](#the-api) below. Each route is
declared in the registry ([`api.md`](./api.md)).

## The rows

All four are the workspace's: each carries `orgId` and the `org_isolation`
policy, and a member's erasure clears their id and leaves the rows.

| Model        | Table             | Holds                                                                                                                 |
| ------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Content`    | `app_content`     | The text as intake produced it, its source and checksum. Kept so a run can be re-driven, until retention.             |
| `Assessment` | `app_assessment`  | The version, profile, the judges it resolved to, the context, the state, the lease, the result and cost.              |
| `JudgeRun`   | `app_judge_run`   | One judge's outcome: model, cost, tokens, timing, or the failure and its code.                                        |
| `JudgeReply` | `app_judge_reply` | A succeeded run's validated reply and its drops. Its own row because retention deletes it sooner than the run (t-26). |

`createdByUserId` (both) and `apiKeyId` are plain strings with hand-written
`SET NULL` FKs and drift probes, so core's `User` and `AiApiKey` are not
edited. `JudgeRun`'s model column is `modelName`: a field called `model`
matches the reserved-tier test's declaration pattern.

## Using it

```ts
// Inside the workspace's tenant context (a request's guard, or runAsOrg).
const { assessmentId } = await enqueueAssessment({
  content: { text, sourceKind: 'TEXT' },
  frameworkVersionId, // a published version, resolved by the caller
  profile: 'full', // or 'quick', a catalogue group, or a list of slots
  context, // validated by the caller
  requestedVia: 'API',
  userId,
});
startAssessmentInBackground(assessmentId); // or: await runAssessment(assessmentId)
```

`enqueueAssessment` refuses with an `AssessmentInputError` before storing
anything: `content_empty`, `content_too_long` (over 40,000 characters, never
truncated), `version_not_found` (no published version with that id) or
`profile_unknown`. It drops NUL characters, which Postgres refuses in a text
column. It wakes the maintenance tick (`noteMaintenanceWork`).

`runJudges` (`fan-out.ts`) is the judge fan-out on its own, with no rows, for
a run that keeps nothing (`store: false`). Passed `ephemeral: true`, each
judge's cost row carries `ephemeral: true` and no `assessmentId`.

The text checks (`content_empty`, `content_too_long`, NUL dropped) are
`assessableText()` in `text.ts`, shared by enqueue, the run that keeps
nothing and the quick scan.

The context is checked against the version by the engine's
`parseContext()` before anything is stored: its ids (content types,
archetypes, roles, audience options, countries) are the version's.
Anything left out takes the prototype's `DEFAULT_CTX`; an empty `role`,
`reader` or `writer` means none. An unknown country is refused, though the
engine itself would read it as a global reader, so a typo is not scored
silently. With the culture switch off, `culture` is refused.

## The run

`QUEUED` → `RUNNING` → `COMPLETED` | `PARTIAL` | `FAILED`, or `CANCELLED`
from either of the first two.

- **The lease.** A run claims the assessment with a fresh token and a lease
  90 seconds ahead, renewed every 30 while it runs. Every later write is
  conditional on that token and on `RUNNING`, so a run that lost its lease or
  was cancelled writes nothing more to the assessment.
- **The claim** succeeds only for this workspace's `QUEUED` or `RUNNING` assessment with no
  live lease, fewer than three attempts, and fewer than three other live runs
  in the workspace. The count and the claim are one serializable transaction.
  A fourth assessment stays `QUEUED`. When a run ends, however it ends, it
  starts the workspace's oldest queued assessment itself.
- **Judges** run at most four at once. Each `JudgeRun` row is written as the
  judge lands, in one transaction with an update of the assessment under the
  run's token. A run that lost its lease therefore stores nothing over its
  successor's rows. Its late judge is still in the cost log.
- **A run starts only judges with no row yet**, plus those whose row failed
  with `rate_limited` or `provider_error`, which are about the moment. A judge
  that runs again keeps its earlier attempts, tokens and cost on its row.
- **Cost.** Each judge's spend is added to the assessment's `costUsd` in the
  transaction that saves it, so the total is right however the run ends,
  cancelled and given-up runs included.
- **A failed judge** (any `JudgeRunError`: over budget, refused, malformed…)
  keeps a `FAILED` row with its code, and with what it was billed when it
  reached the provider. Its dimensions fall back to the quick scan, and the
  assessment ends `PARTIAL`. A slot the engine no longer runs (culture's,
  with the switch turned off after the assessment was queued) fails the same
  way, as `slot_unavailable`, without being called.
- **An error that is not a judge's** (the database failing part-way) puts the
  assessment back to `QUEUED` with no lease and a note in `error`, to be
  re-driven. On its last attempt it is `FAILED` at once, with that note. A
  claim that fails is logged, and the assessment is left as it was.
- **`FAILED`** is for a version that can no longer be run, a text the engine
  cannot score (its quick scan or `assemble()` threw, which would throw
  again), and an assessment that ran out of attempts. `error` says which.
- **Cancel** (`cancelAssessment`) sets `CANCELLED` and keeps the lease. The
  run asks before each judge starts, so no further judge is called. Judges
  already in flight finish and their rows are saved, since their cost is
  already spent. Only the run that held the token saves them. The cancelled
  run keeps its place in the workspace's limit until they have landed.
- **Privacy.** The run is one privacy scope (`assessment:<id>`), and each
  judge's call sits in its agent's scope inside it (`runJudge`), so each
  agent's privacy mode applies to its call.
- **The editor's summary** (`editor.ts`, t-25). Once the result is assembled,
  a run that asked for two judges or more, at least one of which answered
  and was merged (a result still in `quick` mode is skipped as
  `no_judge_answered`), asks the editor what the writer should do first: a `verdict` of two or
  three sentences, up to three `changes`, each naming one of the result's
  recommendations by id (`rec_1` is `result.recommendations[0]`), and what
  `works`. It goes through the judges' own call path under the `editor` role
  ([`judges.md`](./judges.md#running-a-judge)). The result carries it as
  `result.editor`: `{ status: 'written', summary, dropped, model, costUsd }`,
  `{ status: 'skipped', reason }` (`too_few_judges`, `no_judge_answered`), or
  `{ status: 'failed', errorCode, model, costUsd }`, where `errorCode` is a
  judge call's code or `internal_error` for anything else the step threw (the
  engine refusing to build the request, the agent read failing); the message
  is logged, not stored. **A failed editor never changes the status**: the
  assessment is `COMPLETED` (or `PARTIAL`, from its judges) without a summary. Its spend is added to `costUsd` as it lands, under
  the same guard as a judge's. A `store: false` run asks no editor yet.

The limits are constants in `limits.ts` until f-usage measures them.

## The recovery job

`app:assessment-recovery` runs every 15 minutes, once per workspace
(`lib/app/jobs.ts`). It is the backstop, not what drives the queue: a request
starts its own run, and a run that ends starts the next. The 15 minutes match
the signup sweep's, so the job does not shorten how long the maintenance
tick's idle gate (#442) lets a scale-to-zero database sleep. A run whose
process died is therefore taken over within about 15 minutes. It finds `QUEUED` and `RUNNING` assessments with no live
lease. Those that have had three runs are marked `FAILED`. Up to three of the
rest are claimed one at a time (`beginAssessment`), so their claims do not
conflict, and run as described above.

The pass does not wait for the runs it starts. Per-workspace jobs run one
workspace after another, so a long run would hold up every other workspace's
pass. Each run is handed to `keepRunningAfterResponse`, which keeps the
tick's invocation alive until the run ends. A run killed part-way leaves a
lease that runs out, and a later tick takes the run over, at the cost of an
attempt.

It is idempotent: a second pass finds every row final or held by a live
lease.

## Retention

A workspace has two windows (D10, t-26), both stored in `Org.settings.app`
through the one writer of the `app` key (`lib/app/workspaces/app-settings.ts`),
which leaves core's slices and the signup marker as they were:

| Window        | Key                             | Default             | Range  | Deletes                                    |
| ------------- | ------------------------------- | ------------------- | ------ | ------------------------------------------ |
| Content       | `retention: { days }`           | none: keep for good | 1–3650 | Content and its assessments (runs cascade) |
| Judge replies | `judgeReplyRetention: { days }` | 30 days             | 1–365  | `JudgeReply` rows; the runs stay           |

`GET /api/v1/workspaces/{id}/settings` answers both, the reply default filled
in (or `null` for an unreadable stored reply window, below). `PATCH` takes either key or both: a window sets it, `null` clears it
(content kept for good, replies back to 30 days), a key left out is
unchanged. Both need a browser session as the workspace's `OWNER` or `ADMIN`,
or a platform admin.

**Neither is core's `settings.retention`.** That slice governs core's own
history (executions, cost logs, evaluations, webhooks) and its sweep knows
nothing of these tables. A settings page that shows both must say which is
which.

`app:retention-purge` (`lib/app/retention/purge.ts`) runs daily, once per
workspace: the windows are in days, so a row goes at most a day late. The
interval is a minimum kept in process memory, so a restart runs it again
sooner, which is harmless. Each pass:

- with a content window, deletes the assessments made before it (their judge
  runs and replies cascade), then the content made before it that no
  assessment is left on; content a newer assessment still uses stays until
  that one ages out;
- always, deletes judge replies older than the reply window. The assessment's
  assembled `result` is what is read once it is final, and the run keeps its
  status, model, cost, tokens and timing.

`QUEUED` and `RUNNING` assessments are skipped, and so are their judges'
replies, because a re-driven run reads its finished judges' replies back. So is
a `CANCELLED` one that may still have judges in flight, since they can land on
it after the cancel. Its lease is no guide (a cancelled run stops renewing it),
so one is taken once its judges have all landed (the lease cleared) or an hour
after the cancel (`CANCEL_GRACE_MS`, past any judge's timeout and retries). A succeeded run found with no reply on a re-drive is counted
as a failed judge rather than called again, so the workspace is not billed
twice. A window that does not parse is never purged on: for content that is no
window, and for replies `GET` answers `judgeReplyRetention: null` and no reply
is deleted until it is set again. The 30-day default could be shorter than what
was stored. The pass is idempotent.

Replies stored before the `app_judge_reply` table were copied into it dated at
the migration, so each gets the full window from deploy rather than being
purged on the first boot.

An assessment's cached report PDFs (t-31) go before its row, and the row stays
for the next pass if storage refuses (`report.md`, "A PDF must not outlive its
review").

Shares, rewrites and comparison sets do not exist yet. Each task that adds
one says what purging an assessment does to it.

## The API

| Route                                     | Who                            | What                                                                                                     |
| ----------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/scan`                       | anyone, 30/min per IP          | The quick scan of pasted text. Deterministic, no AI, nothing stored.                                     |
| `POST /api/v1/assessments`                | session, or key with `assess`  | Assess `{ text }`, `{ url }` or `{ file: { name, base64 } }`.                                            |
| `GET /api/v1/assessments`                 | same                           | The workspace's assessments, newest first; `page`, `limit`, `status`.                                    |
| `GET /api/v1/assessments/{id}`            | same                           | One assessment: its copy (`text`), its judges and, once final, its result.                               |
| `GET /api/v1/assessments/{id}/events`     | same                           | Progress as Server-Sent Events.                                                                          |
| `POST /api/v1/assessments/{id}/cancel`    | same                           | Cancel a queued or running one; 409 `ASSESSMENT_FINAL` if it is not.                                     |
| `DELETE /api/v1/assessments/{id}`         | same                           | Delete it, its judge runs and replies, and its text (unless another assessment shares it).               |
| `GET /api/v1/assessments/{id}/report.pdf` | session, or key with `reports` | The report as a PDF, rendered once and then cached; 409 `REPORT_NOT_READY` without one. See `report.md`. |

Each route's docblock lists its error codes. A few rules hold across them:

- **The version.** `framework` defaults to HowDoesThisLand, `version` to its
  latest published one. A retired version is readable but runs nothing new
  (404 `FRAMEWORK_VERSION_NOT_FOUND`).
- **Profiles.** `profile` is `quick` (no judges), `full` (the default) or a
  catalogue group (`core`, `craft`, …); `judges` is an explicit list instead.
  Both resolve through `engine.activeJudgeSlots`. Giving both is a 400.
- **`wait`.** Without it the run starts after the response, which is a 202.
  With it the run is claimed in the request and awaited for `WAIT_BOUND_MS`
  (60 s): 200 with the result if it ends, else 202 and the run carries on under
  `after()` (`maxDuration` 300). One the workspace cannot start yet (three
  running) is watched for the bound instead.
- **`store: false`** is synchronous only (`wait: false` with it is a 400). It
  runs the quick scan and `runJudges` with no rows, so no `Content`,
  `Assessment` or `JudgeRun` is written; only the judges' cost rows, marked
  `ephemeral`. The answer has `stored: false` and no id. A text the
  framework cannot score (its quick scan or `assemble()` throwing) is 422
  `NOT_SCORABLE`, with what the judges had spent in `details.costUsd`: the
  stored run's `failed`, with no row to record it on.
- **Another workspace's id** is 404, not 403, on every `{id}` route: every
  read names the org the guard entered, so an id is not confirmed to an
  outsider. Within a workspace, any member may read, cancel or delete.
- **Limits.** `AI_ASSESSMENTS_PER_MINUTE` (10) assessments that call judges per
  user, whatever the way in, `store: false` included; `quick` is not counted,
  nor is a request refused for its version, context, profile or pasted text
  (`prepareAssessment` runs first), nor one whose judges resolve to none. A `store: false` caller that goes away
  starts no further judge.
  A handler-level limiter (`api/limiter.ts`) under the proxy's section cap. The
  scan's 30/min per IP is the `scan` rule in `lib/app/rate-limit.ts`.
- **URLs need an account (D14).** The scan takes pasted text only; a `url` or
  `file` there is 401 `ACCOUNT_REQUIRED`.
- **The scan needs no workspace.** It reads only the framework tables, which
  are shared config, so it works with no session and no org at `multi`.

### Events

`GET …/{id}/events` polls the assessment and its judge runs every `POLL_MS`
(1 s), so it sees every judge whichever process runs the assessment: a
request's `after()`, another instance, or the recovery job. A stream opened
late first replays the judges already landed. Each event is the SSE
`event:` name and the `data:` payload's `type`:

| Event                | When                                                             |
| -------------------- | ---------------------------------------------------------------- |
| `assessment_status`  | First, the state found; then each change, after its judges.      |
| `assessment_judge`   | A judge landed, or landed again on a re-drive.                   |
| `assessment_done`    | Final, with `overall`, `band`, `costUsd`, `error`. Then it ends. |
| `assessment_gone`    | Deleted while followed. Then it ends.                            |
| `assessment_timeout` | Still going after `EVENTS_MAX_MS` (5 min). Open it again.        |

A cancelled run's judges that were in flight land after `cancelled`. The
stream waits for them, until the run gives up its lease (or the lease runs
out), so their `assessment_judge` events come before `assessment_done`, and
its `costUsd` includes them.

## Checking it

```bash
npx tsx --env-file=.env.local scripts/smoke/assessment.ts
```

At `TENANCY_MODE=multi` (see [`dev-environment.md`](./dev-environment.md)),
with framework 0.5.1 published and `OPENAI_API_KEY` set. In a fresh
workspace it runs two judges on a baseline case (a few cents), completes a
simulated dead run through the recovery job, and checks that a second
workspace reads none of it. It erases both workspaces afterwards.

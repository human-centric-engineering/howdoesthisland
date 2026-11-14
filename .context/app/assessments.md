# Assessments

An assessment scores one text against one framework version: the quick scan,
then the judges its profile chose, put together by the engine's `assemble()`.
It runs as a job, so it survives a judge failing and a process dying. Design:
[`planning/app-plan.md`](./planning/app-plan.md) §8.2 and §9.

The library is `lib/app/assessments/`. The API (`/api/v1/assessments`, t-24)
is built on it and is not here yet.

## The rows

All three are the workspace's: each carries `orgId` and the `org_isolation`
policy, and a member's erasure clears their id and leaves the rows.

| Model        | Table            | Holds                                                                                                     |
| ------------ | ---------------- | --------------------------------------------------------------------------------------------------------- |
| `Content`    | `app_content`    | The text as intake produced it, its source and checksum. Kept so a run can be re-driven.                  |
| `Assessment` | `app_assessment` | The version, profile, the judges it resolved to, the context, the state, the lease, the result and cost.  |
| `JudgeRun`   | `app_judge_run`  | One judge's outcome: model, cost, tokens, the validated reply and its drops, or the failure and its code. |

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
`profile_unknown`. It wakes the maintenance tick (`noteMaintenanceWork`).

`runJudges` (`fan-out.ts`) is the judge fan-out on its own, with no rows, for
a run that keeps nothing (`store: false`).

## The run

`QUEUED` → `RUNNING` → `COMPLETED` | `PARTIAL` | `FAILED`, or `CANCELLED`
from either of the first two.

- **The lease.** A run claims the assessment with a fresh token and a lease
  90 seconds ahead, renewed every 30 while it runs. Every later write is
  conditional on that token and on `RUNNING`, so a run that lost its lease or
  was cancelled writes nothing more to the assessment.
- **The claim** succeeds only for a `QUEUED` or `RUNNING` assessment with no
  live lease, fewer than three attempts, and fewer than three other live runs
  in the workspace. The count and the claim are one serializable transaction.
  A fourth assessment stays `QUEUED` for the recovery job.
- **Judges** run at most four at once. Each `JudgeRun` row is written as the
  judge lands. A run starts only judges with no row yet.
- **A failed judge** (any `JudgeRunError`: over budget, refused, malformed…)
  keeps a `FAILED` row with its code. Its dimensions fall back to the quick
  scan, and the assessment ends `PARTIAL`.
- **`FAILED`** is for what the run cannot carry on past: the version can no
  longer be run, or an error that is not a judge's. `error` says which.
- **Cancel** (`cancelAssessment`) sets `CANCELLED`. The run asks before each
  judge starts, so no further judge is called. Judges already in flight
  finish and their rows are saved, since their cost is already spent.
- **Privacy.** The run is one privacy scope (`assessment:<id>`), and each
  judge's call sits in its agent's scope inside it (`runJudge`), so each
  agent's privacy mode applies to its call.

The limits are constants in `limits.ts` until f-usage measures them.

## The recovery job

`app:assessment-recovery` runs every minute, once per workspace
(`lib/app/jobs.ts`). It finds `QUEUED` and `RUNNING` assessments with no live
lease. Those that have had three runs are marked `FAILED`. Up to three of the
rest are re-driven through `runAssessment`, which reruns only the judges with
no row. A judge that already failed keeps its failure.

It is idempotent: a second pass finds every row final or held by a live
lease. The pass waits for the runs it starts. A tick killed mid-run leaves a
lease that runs out, and a later tick takes the run over, at the cost of an
attempt.

## Checking it

```bash
npx tsx --env-file=.env.local scripts/smoke/assessment.ts
```

At `TENANCY_MODE=multi` (see [`dev-environment.md`](./dev-environment.md)),
with framework 0.5.1 published and `OPENAI_API_KEY` set. In a fresh
workspace it runs two judges on a baseline case (a few cents), completes a
simulated dead run through the recovery job, and checks that a second
workspace reads none of it. It erases both workspaces afterwards.

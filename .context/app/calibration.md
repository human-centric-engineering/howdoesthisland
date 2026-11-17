# Calibration

How often do the judges agree with what a careful reader expects? The calibration set
answers that. It is a fixed list of texts, each with the results it should get, run
against the quick scan and the nine judges. The design is
[`planning/app-plan.md`](./planning/app-plan.md) §6 (`f-calibration`) and D9. This page
covers the set (t-36), the runner and the publish gate (t-37).

## The set

`lib/app/frameworks/howdoesthisland/data/eval-0.5.1.json`, written against model 0.5.1.
It was brought up from the prototype's 0.4.0 set (`prototype/howdoesthisland_eval_set.json`,
left as it was), and `meta.changes_from_0_4_0` lists what changed. Read it through
`calibrationSetSchema` in `lib/app/calibration/schema.ts`. Never import it from `prototype/`,
which `prototype-guard.test.ts` forbids.

A case gives the text its context: `content_type`, plus `audience` (archetype, role and any
audience modifier, by id) and optionally `culture` (reader and writer country ids, or
`global`). `caseContext()` turns that into the engine's context; run it with the culture
switch on. Do not port the prototype's `caseCtx()` for this, because it dropped the
case's culture. A culture expectation needs a reader country: `global` is what the engine
uses when none is named, so the schema refuses it. Under `expect`:

| Expectation               | Checks                   | Passes when                                                         |
| ------------------------- | ------------------------ | ------------------------------------------------------------------- |
| `appeals`, `overall`      | the four appeal judges   | the score's band is the one expected (`near`: one band away)        |
| `flags_present/absent`    | red flags                | each expected flag is found, and each absent one is not             |
| `primary_duty`            | the lenses judge         | the assessment's primary duty matches (null: not checked)           |
| `groups.<group>.band`     | craft, audience, culture | the group score's band is the one expected                          |
| `groups.<group>.low/high` | the same judges          | the dimension scores 1 or below (`low`) or 3 or above (`high`)      |
| `levers`                  | the influence judge      | each named lever has the status expected (present, misused, absent) |

The bands are the set's three, not the report's five: low 0–44, mid 45–70, high 71–100
(`band3` in the engine).

`recommend_dimensions` and `balance_rules` are carried from 0.4.0 and are not scored. The
prototype never scored them, and what a careful reader expects of a recommendation list
is not something a run can check.

## Changing it

Changing the set is a PR, and the expectations are reviewed in that PR (D9). The 0.4.0
note asking for two reviewers no longer applies. Before opening it, run both of these.
The tests are the check that counts. `validate_refs.py` predates 0.5.1 and checks only the
0.4.0 fields: it does not read roles, audience modifiers, cultures, group dimensions or
levers, so a clean run from it alone proves little.

```bash
python3 prototype/tools/validate_refs.py \
  lib/app/frameworks/howdoesthisland/data/model-0.5.1.json \
  lib/app/frameworks/howdoesthisland/data/eval-0.5.1.json
npx vitest run tests/unit/lib/app/calibration
```

The tests hold the set to what a run needs:

- each of the nine judges is checked by at least six cases (`judgeCoverage`);
- every id resolves, the context going through the engine's own `parseContext`;
- the paired cases stay comparable (same audience for ev19 and ev20, same text and audience for ev22 and ev24, read in Japan and the US);
- the prompt-injection cases (ev25, ev26) are expected to score the way an honest reading would;
- the bands in `meta.bands` are the ones the engine's `band3` scores with.

Some cases come in pairs that only make sense together, so keep both halves when you edit
one. ev19 and ev20 give the same pension facts, pitched for an adviser and for a novice.
ev22 and ev24 are the same email, read in Japan and in the US.

## Running it

```bash
npm run calibrate -- --mode quick --version 0.5.1
npm run calibrate -- --mode ai --version 0.5.1
```

The version must be imported (draft or published). The set is the one written for it,
`data/eval-<version>.json`. No flag picks another, because an AI run is what lets a
draft publish. A set whose `meta.model` is not the version, or that names an id the
version does not have, is refused before anything runs, and so is `ai` mode on a version
with no judges to run.

- **quick** puts every case through the quick scan and `assemble`. It is free and
  deterministic, so two runs of one version always agree.
- **ai** puts every case through the version's full judge profile (`runJudges`,
  ephemeral) and assembles the replies. No Assessment row is written. The calls run in the
  install org and count against its budget, and each `AiCostLog` row carries
  `metadata.calibrationRunId`. A run costs 26 cases × 9 judges. A judge that fails falls
  back to the quick scan for its part, as in an assessment, and is counted in
  `totals.judgeFailures`.

Cases always run with the culture switch on, whatever the deployment's switch is, because
the set has culture expectations.

Each run is a `CalibrationRun` row, owned by the install org and written in the system
scope (`lib/app/calibration/store.ts`): the version and its `sourceSha256`, the set's
version, the mode, the provider and model each judge answered with, the totals, each case's
scored checks, and the cost. The command prints the totals beside the last run of the same
mode (against any version), with every check whose result changed, worse ones first
(`compare.ts`). A check whose expected value changed between the two runs' sets is not
counted as changed.

Before a run is stored, the set is checked against the version: its model version, the
ids it names, every case's context, and (for an AI run) that the version has judges. A set
that does not fit, or a retired version, is refused with nothing stored and nothing spent.
A run is stored `RUNNING` when it starts, then `COMPLETE` with its results or `FAILED`
with `error` and what its judges had cost so far. `totals` and `rows` are null until it is complete. Only a complete run is
read back for comparing or for the gate, so a run that is still going, or one that died,
never counts. A run is compared with the newest complete run of its mode stored _before
it started_, so the comparison printed when it finishes matches the one the admin page
shows, even when two runs overlap.

While a run is running, the process running it touches its `heartbeatAt` every
`HEARTBEAT_MS` (30s). A `RUNNING` run whose beat is older than `STOPPED_AFTER_MS` (2
minutes) is **stopped**: the process went away (a deploy, a serverless time limit, a
Ctrl-C). Nothing rewrites the row; it just stops counting as running. A long CLI run keeps
beating, so it is not taken for stopped however long it takes. Each beat also records what
the run's judges have cost so far, so a stopped run still shows what it spent by its last
beat.

**Only one AI run of a version runs at a time**, from the CLI or the page. `startRun`
takes a transaction-scoped advisory lock on the version, looks for an AI run of it that is
still beating, and throws `CalibrationRunningError` if there is one. Two starts at once
cannot both pass the check.

| Module       | Does                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `score.ts`   | scores one case's expectations (`ok`/`near`/`miss`), and sums them                                     |
| `run.ts`     | `scoreSet` runs the cases; `startCalibration` checks, stores and starts; `runCalibration` waits for it |
| `compare.ts` | the change from the previous run                                                                       |
| `store.ts`   | the table's only writer; reads JSON back through Zod                                                   |
| `wire.ts`    | the JSON shapes, with no database import (the route registry uses them)                                |
| `gate.ts`    | the publish gate                                                                                       |
| `cli.ts`     | the command behind `scripts/app/calibrate.ts`                                                          |
| `sets.ts`    | the sets bundled for the routes                                                                        |
| `admin.ts`   | what the admin page lists, and starting a run from it                                                  |

`agreement` is every `ok` over every check. `near` does not count as agreement.

## The admin page

`/admin/frameworks` (platform admins only) lists every version, drafts included, with
its calibration snapshot and its runs. Each run shows its agreement overall and for
appeals, groups, flags and duties, with the change from the run before it of the same
mode. Pick a run to see what changed and every case's misses. The page reads
`GET /api/v1/admin/frameworks`. It starts runs with
`POST /api/v1/admin/frameworks/howdoesthisland/versions/<v>/calibration-runs`
`{ mode }`, which records the caller as `startedByUserId` on the run and on each judge
call's cost row. Publishing is still done from the command line.

- **Quick** is waited for, and answers 201 once it is complete.
- **AI** answers 202 once the run is stored, and carries on under `after()`
  (`maxDuration` 300), as an assessment does. The page reads the list again every few
  seconds while a run is running. A second AI run of a version that is still running is
  answered 409 `CALIBRATION_RUNNING`.
- **A run whose beat has stopped is shown as `stopped`**, two minutes after its process
  went away, and it stops blocking the next AI run. **A whole AI run can take
  longer than a serverless function is allowed to live**, because the 26 cases run
  one after another. On Vercel, start AI runs from the CLI or a long-running server.

The routes cannot read `data/eval-<v>.json` from disk, because a Vercel function holds
only the files the bundler traced. So each set is imported in `sets.ts`, and
`tests/unit/lib/app/calibration/sets.test.ts` fails on any `eval-*.json` that is not
listed there.

## The publish gate

`publishVersion` takes a gate and asks it before a draft is published. The app's gate
(`calibrationGate`) refuses a draft unless it has an AI run of it that is:

- of the file as it is now (the run's `sourceSha256` is the version's: a draft
  re-imported since is different content), and
- complete (no judge failed, and at least one check scored).

On publish the newest such run's snapshot is copied into `FrameworkVersion.calibration`:
`{ runId, ranAt, agreement, setVersion, checks, judgeModels }`. `ranAt` is when the run
finished (`finishedAt`), since a run is stored when it starts. The publish write is
conditioned on the same `sourceSha256`, so a re-import between the check and the write
does not publish uncalibrated content.

0.5.1 was published before the gate existed, and the gate does not apply to it
retroactively (a planning ruling). It is listed in `UNGATED_VERSIONS`, pinned to the
sha256 of the file as published, so a new database still publishes that file from a draft,
with no snapshot, and a different file under the same number is gated. Never add a version to that list.

## Parity with the prototype

Quick mode on the prototype's own 0.4.0 cases gives exactly the totals the prototype's
`calibrate()` gives: 42 appeals in band and 27 near of 72, 27 of 27 flags, and 5 of 15
primary duties. `tests/unit/lib/app/calibration/parity.test.ts` holds it there, against
`tests/fixtures/app/calibration/prototype-0.4.0.json`. To re-record that file, which you
only need to do if a prototype file changes (the test says so):

```bash
npx tsx scripts/app/calibration/record-prototype.ts
```

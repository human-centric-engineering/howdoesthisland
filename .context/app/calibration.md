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
`data/eval-<version>.json`, or `--set <file>`. A set whose `meta.model` is not the version,
or that names an id the version does not have, is refused before anything runs.

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
(`compare.ts`).

| Module       | Does                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| `score.ts`   | scores one case's expectations (`ok`/`near`/`miss`), and sums them         |
| `run.ts`     | `scoreSet` runs the cases; `runCalibration` checks, runs, stores, compares |
| `compare.ts` | the change from the previous run                                           |
| `store.ts`   | the table's only writer; reads JSON back through Zod                       |
| `gate.ts`    | the publish gate                                                           |
| `cli.ts`     | the command behind `scripts/app/calibrate.ts`                              |

`agreement` is every `ok` over every check. `near` does not count as agreement.

## The publish gate

`publishVersion` takes a gate and asks it before a draft is published. The app's gate
(`calibrationGate`) refuses a draft unless it has an AI run of it that is:

- of the file as it is now (the run's `sourceSha256` is the version's: a draft
  re-imported since is different content), and
- complete (no judge failed).

On publish the newest such run's snapshot is copied into `FrameworkVersion.calibration`:
`{ runId, ranAt, agreement, setVersion, checks, judgeModels }`. The publish write is
conditioned on the same `sourceSha256`, so a re-import between the check and the write
does not publish uncalibrated content.

0.5.1 was published before the gate existed, and the gate does not apply to it
retroactively (a planning ruling). It is listed in `UNGATED_VERSIONS`, so a new database
still publishes it from a draft, with no snapshot. Never add a version to that list.

## Parity with the prototype

Quick mode on the prototype's own 0.4.0 cases gives exactly the totals the prototype's
`calibrate()` gives: 42 appeals in band and 27 near of 72, 27 of 27 flags, and 5 of 15
primary duties. `tests/unit/lib/app/calibration/parity.test.ts` holds it there, against
`tests/fixtures/app/calibration/prototype-0.4.0.json`. To re-record that file, which you
only need to do if a prototype file changes (the test says so):

```bash
npx tsx scripts/app/calibration/record-prototype.ts
```

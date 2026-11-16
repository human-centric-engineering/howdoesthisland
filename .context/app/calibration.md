# Calibration

How often do the judges agree with what a careful reader expects? The calibration set
answers that. It is a fixed list of texts, each with the results it should get, run
against the quick scan and the nine judges. The design is
[`planning/app-plan.md`](./planning/app-plan.md) §6 (`f-calibration`) and D9. This page
covers the set. The runner and the publish gate come with t-37 and will be added here.

## The set

`lib/app/frameworks/howdoesthisland/data/eval-0.5.1.json`, written against model 0.5.1.
It was brought up from the prototype's 0.4.0 set (`prototype/howdoesthisland_eval_set.json`,
left as it was), and `meta.changes_from_0_4_0` lists what changed. Read it through
`calibrationSetSchema` in `lib/app/calibration/schema.ts`. Never import it from `prototype/`,
which `prototype-guard.test.ts` forbids.

A case gives the text its context: `content_type`, plus `audience` (archetype, role and any
audience modifier, by id) and optionally `culture` (reader and writer country ids, or
`global`). Under `expect`:

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

`recommend_dimensions` and `balance_rules` are carried from 0.4.0 and the prototype never
scored them. Whether the runner does is for t-37 to decide.

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

- every id it names exists in the model (`danglingReferences`);
- each of the nine judges is checked by at least six cases (`judgeCoverage`);
- every culture case names a reader culture (the schema refuses one that does not);
- the prompt-injection cases (ev25, ev26) are expected to score the way an honest reading would;
- the bands in `meta.bands` are the ones the engine's `band3` scores with.

Some cases come in pairs that only make sense together, so keep both halves when you edit
one. ev19 and ev20 give the same pension facts, pitched for an adviser and for a novice.
ev22 and ev24 are the same email, read in Japan and in the US.

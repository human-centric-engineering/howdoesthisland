# The engine baseline

The app's scores all come from the prototype's engine, `prototype/src/engine.js`:
the free quick scan, and the fallback used when a judge fails. The port of that
engine (f-engine, e2) must not change a score by accident. The baseline is what
it is checked against: what the prototype's engine outputs today, recorded as
fixtures.

## What is recorded

`tests/fixtures/app/engine-baseline/` holds one canonical JSON file per case:

- `eval/ev01.json` … `ev18.json`: the 18 eval cases, with the context built by
  the prototype's own `caseCtx`.
- `corpus/<text>-<n>.json`: 12 texts, each read under 4 contexts, which makes 48
  pairs. Between them they cover every content type, archetype, exec role and
  audience option in 0.5.1, and reader cultures across the Lewis spread. That
  includes a reader id the model does not have, which falls back to global. A
  writer culture is unset in some pairs, the same as the reader in some, and
  different from it in others. Two texts have `İ` ahead of a sentence that
  `locate()` finds only case-insensitively, so its offset shift shows up.
- `manifest.json`: the sha256 of `engine.js`, the model and the eval set the run
  read, and the list of cases.

Each case holds its input, `quickScan()`, the synthetic judge outputs, and
`assemble()` twice. `assemble.quick` is called with no judge outputs, which is
the quick-scan path. `assemble.full` is called with the synthetic outputs, which
is the merge path.

The synthetic judge outputs (`scripts/app/baseline/synthetic.ts`) are not
plausible judgements. They are built from the model's ids and a fixed hash to
reach the branches the port has to reproduce:

- a score sent as a string, and one out of range;
- a quote for each `locate()` path;
- and in each list, an id that does not exist.

`judgePrompt`, `validJudgeOutput`, `rewritePrompt`, `calibrate` and `toApi` are
not recorded. They belong to f-judges, f-rewrite, f-calibration and
f-assessments.

## Re-recording

```bash
npx tsx scripts/app/baseline/record.ts
```

The recorder copies the engine and the two JSON files into a temporary
directory, then imports the engine from there. `prototype/` stays as delivered,
and nothing outside it imports from it. `tests/unit/lib/app/prototype-guard.test.ts`
fails if anything does.

The run is deterministic, so re-running it must leave `git status` clean. If it
does not, the engine, the model or the corpus changed, and the diff names the
cases that moved.

## Comparing a port

Compare the port's output to a case file on `JSON.stringify` terms, with keys
sorted (`scripts/app/baseline/canonical.ts`):

- a property whose value is `undefined` is absent;
- an `undefined` array slot, and `NaN`, are `null`.

A difference the port means to make, such as the `locate()` offset fix, should
appear as a listed difference against the case that shows it. Do not re-record
the baseline to absorb it.

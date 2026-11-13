# The engine

The engine scores a text against a version of a framework. For HowDoesThisLand it is the
prototype's `engine.js`, ported as typed modules (t-13). It is checked against the
baseline the prototype recorded ([`engine-baseline.md`](./engine-baseline.md)).

## Getting one

```ts
const def = getFrameworkDefinition(slug); // lib/app/frameworks/registry.ts
const model = await materialise(repo, def, versionId);
const engine = def.createEngine(model);

const quick = engine.quickScan(text, ctx); // free, deterministic
const result = engine.assemble(text, ctx, quick, judgeOutputs, source);
```

- **`FrameworkEngine`** (`lib/app/frameworks/engine.ts`) has `quickScan` and `assemble`
  only. §8.2 lists six methods, and each of the other four arrives with the feature that
  implements it (`judgeSlots`, `buildJudgeRequest` and `outputSchema` with f-judges,
  `rewriteRequest` with f-rewrite). That way no method is a stub.
- **The model is never written.** `createEngine` checks the materialised model against
  the fields the engine reads, then indexes it (`engine/model.ts`). It throws a
  `ZodError` naming the field when one is missing. The parsed copy is frozen, and it is
  cached per model object, so a published version is indexed once.
- **`assemble` with no judge outputs is the quick-scan result.** That is also what
  stands in when a judge fails. It drops ids the model lacks and coerces a judge's
  score, as the prototype did. Validating a judge's reply is j2's (f-judges).

## The modules

`lib/app/frameworks/howdoesthisland/engine/`. Each follows its prototype function, so a
diff against `prototype/src/engine.js` stays readable.

| Module          | From the prototype                                                    |
| --------------- | --------------------------------------------------------------------- |
| `text.ts`       | `wordCount`, `splitSentences`, `syllables`, the regex cache, `locate` |
| `craft.ts`      | `craft()`                                                             |
| `model.ts`      | `createEngine`'s lookup maps, typed and checked                       |
| `culture.ts`    | `cultureProfile`, `lewisLabel`, `culturePositions` and the cues       |
| `quick-scan.ts` | `quickScan`, `extraScan`                                              |
| `scoring.ts`    | `effectiveWeights`, `fnTarget`, `appealScore`, balance, appeal share  |
| `assemble.ts`   | `assemble`, `libraryRecs`, `dedupeFlags`                              |

Not ported here: the judge prompts, `validJudgeOutput`, `rewritePrompt`, `calibrate` and
`toApi` (see the porting map, app-plan §3).

## Where it differs from the prototype

Each difference is listed against the baseline cases that show it, in
`tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-differences.ts`. The test
fails on any difference not listed there, and on any listed difference that has gone.

- **`locate()` offsets** (BRIEF §5). The prototype searched `text.toLowerCase()` and
  returned offsets into that copy. Each earlier `İ` became two code units there, so
  every offset after it was off. The port maps a match back into the text. In the
  baseline, this moves the judge highlights in the İstanbul and İzmir texts.
- **The duty a reader needs** (BRIEF §5). `primaryDuty(ctx)` takes the highest-weighted
  duty. The prototype's `rewritePrompt()` looked for the duty weighted exactly 40.
  `rewritePrompt` belongs to f-rewrite, so nothing in the baseline shows this change.
- **The red-flag penalty's stray score.** The prototype's quick scan tried to lower a
  dimension's score for each red flag it found. It looked up `f.dimension` on the found
  flag, which has no such field, so every penalty landed on a score called `"undefined"`
  (NaN) and no real score moved. That outcome matches the model's own v1 rule
  (`scoring.red_flags`: flags "do not reduce scores"). So the port keeps every score as
  it was and drops the stray score and note. Whether flags should lower scores is a
  model question, and changing it would change scores.
- **Judge output validation** (BRIEF §5) is j2's, in f-judges.

## The culture switch (D11)

`def.createEngine(model)` reads `isCultureEnabled()` when it makes the engine. With the
switch off:

- `ctx.culture` is never read, and the reader counts as a global audience, so culture no
  longer shifts the appeal weights;
- there are no `cul_*` scores, notes, highlights, dimensions or recommendations. The
  culture group has no score and no judge summary, and `culture` is `null` in both the
  quick scan and the result;
- a culture dimension named by any judge is dropped, the same as an unknown id.

The text's formality is still measured, because craft's tone score uses it.

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

for (const slot of engine.activeJudgeSlots(profile)) {
  const request = engine.buildJudgeRequest(slot, text, ctx, projectContext);
  // the runtime (t-19) makes the call with request.prompt, request.schema, …
  const checked = engine.validateJudgeReply(slot, JSON.parse(reply), text);
  if (checked.ok) outputs[group] = checked.output; // and keep checked.drops
}
const result = engine.assemble(text, ctx, quick, outputs, source);
```

- **`FrameworkEngine`** (`lib/app/frameworks/engine.ts`) has `quickScan`, `assemble` and
  the judge methods (f-judges): `activeJudgeSlots`, `buildJudgeRequest`, `outputSchema`
  and `validateJudgeReply`. `rewriteRequest` arrives with f-rewrite, so no method is a
  stub.
- **The judge slots are the definition's, not the engine's.** `judges.slots` on the
  framework definition is the one list (each slot is a platform agent, see
  [`judges.md`](./judges.md)); `activeJudgeSlots` only picks which of them run.
- **The model is never written.** `createEngine` checks the materialised model against
  the fields the engine reads, then indexes it (`engine/model.ts`). It throws a
  `ZodError` naming the field when one is missing. The parsed copy is frozen, and it is
  cached per model object, so a published version is indexed once.
- **`assemble` with no judge outputs is the quick-scan result.** That is also what
  stands in when a judge fails. It drops ids the model lacks and coerces a judge's
  score, as the prototype did. A reply from a real judge goes through
  `validateJudgeReply` first (below).

## The modules

`lib/app/frameworks/howdoesthisland/engine/`. Each follows its prototype function, so a
diff against `prototype/src/engine.js` stays readable.

| Module              | From the prototype                                                    |
| ------------------- | --------------------------------------------------------------------- |
| `text.ts`           | `wordCount`, `splitSentences`, `syllables`, the regex cache, `locate` |
| `craft.ts`          | `craft()`                                                             |
| `model.ts`          | `createEngine`'s lookup maps, typed and checked                       |
| `culture.ts`        | `cultureProfile`, `lewisLabel`, `culturePositions` and the cues       |
| `quick-scan.ts`     | `quickScan`, `extraScan`                                              |
| `scoring.ts`        | `effectiveWeights`, `fnTarget`, `appealScore`, balance, appeal share  |
| `assemble.ts`       | `assemble`, `libraryRecs`, `dedupeFlags`                              |
| `prompts.ts`        | `audienceText`, `contentBlock`, `judgePrompt`                         |
| `validate-reply.ts` | `validJudgeOutput`, replaced by post-validation                       |

Two have no prototype function. `judge-schemas.ts` builds each judge's strict reply
schema, and `judges.ts` decides which judges a profile runs and builds each call.

Not ported here: `rewritePrompt`, `calibrate` and `toApi` (see the porting map, app-plan
§3).

## The judges' side

- **Profiles.** `activeJudgeSlots(profile)` takes `quick` (none), `full` (every judge the
  engine can run), a group from the version's `judge_catalogue` (that group plus the
  four appeals, which are `always`), or an explicit list of slots (exactly those, once
  each). It returns slots in the version's order, and throws `JudgeProfileError` for a
  name or slot the version lacks.
- **Prompts are the prototype's, byte for byte**, for every baseline case and slot
  (`baseline-prompts.test.ts`). What a judge is told is versioned with the model (D17)
  and is what calibration measures, so change one only as a listed difference. A
  project's context, when given, follows the audience block, fenced and framed as the
  author's background, not instructions.
- **Strict schemas.** `outputSchema(slot)` is the reply's JSON Schema in OpenAI's strict
  subset, with the version's ids as enums, so a reply cannot name a dimension, move,
  flag, perspective or lever the version lacks. A judge with no red flags has no
  `red_flags` field, since strict mode refuses an empty enum. A test walks every schema
  against the strict rules and limits.
- **Post-validation.** `validateJudgeReply(slot, reply, text)` is still needed, because
  a provider may ignore the schema. It drops unknown ids, clamps scores to their scale,
  drops a quote it cannot find in the text (a highlight or red flag goes with its quote),
  and holds lists to the judge's `max_highlights` and `max_recommendations`. Each drop is
  recorded by path and reason. It refuses only a reply that is not an object, or one
  that lacks its core list (`dimension_scores`, or `perspectives` for influence).
- **Limits.** Each request carries interim `maxTokens` and timeout hints for its shape
  (`JUDGE_LIMITS`), under its agent's ceiling ([`judges.md`](./judges.md)). k3 measures
  them.

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
- **`mode`.** The prototype called a result `full` when its judge outputs had any key. The
  port counts only replies it used: a key with no reply, or a culture reply with culture
  off, leaves the result `quick`. Nothing in the baseline shows this change.
- **Judge output validation** (BRIEF §5). The prototype's `validJudgeOutput` checked only
  that a reply had an array. `validateJudgeReply` checks it against the version and the
  text (above). The prompts themselves are unchanged.

## The culture switch (D11)

`def.createEngine(model)` reads `isCultureEnabled()` when it makes the engine. With the
switch off:

- `ctx.culture` is never read, and the reader counts as a global audience, so culture no
  longer shifts the appeal weights;
- there are no `cul_*` scores, notes, highlights, dimensions or recommendations. The
  culture group has no score and no judge summary, and `culture` is `null` in both the
  quick scan and the result;
- a culture dimension named by any judge is dropped, the same as an unknown id;
- the judges' prompts name no reader or writer culture, `full` runs no culture judge, and
  asking for it by name or by its group is refused.

The text's formality is still measured, because craft's tone score uses it.

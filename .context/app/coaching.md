# Coaching

A review says what is missing: proof from someone like the reader, a cost in
the reader's terms, a reason to act now. Only the writer knows those facts, and
most writers don't know which ones they need until someone asks. Coaching is
the step between a review and a rewrite that asks them (f-coached-rewrite,
Path 2 of the rewrite).

This page starts with the first part, **a review's gaps** (t-108): the list of
missing facts, each with a question for the writer. The conversation that asks
them (t-110), the facts it keeps (t-109) and the worked example's exchange
(t-112) add their sections as they land.

## A review's gaps

| Route                               | What it does                                                     |
| ----------------------------------- | ---------------------------------------------------------------- |
| `GET /api/v1/assessments/{id}/gaps` | A finished review's gaps, strongest first, each with a question. |

It takes a browser session or an API key with the `assess` scope. It answers
`{ assessmentId, gaps }`, and each gap is:

| Field      | What it holds                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | Stable for the same review, and what an answer is keyed to: a topic (`customer-proof`), `placeholder-<rewrite id>-p1` (a later rewrite numbers its own from `p1`), `recommendation-4` or `brief-offer`. |
| `missing`  | What is missing, in a few words.                                                                                                                                                                        |
| `question` | What to ask the writer, about their own situation, never about the model.                                                                                                                               |
| `why`      | Why it matters, in a sentence.                                                                                                                                                                          |
| `found`    | What the review said about it in its own words (a recommendation's issue, a note), strongest first, for the coach to quote. Empty when it said nothing usable.                                          |
| `sources`  | Every place in the report that asks for it, by the report's own numbering: a placeholder's rewrite and id, a recommendation's or note's number, a low appeal's id, a brief field.                       |

Errors: 404 `NOT_FOUND` for a review not in this workspace (another
workspace's id reads the same), and 409 `ASSESSMENT_NOT_FINISHED` for one still
queued or running, or one that ended with no result (failed, or cancelled).

**No AI call.** The list is computed from what the report shows
(`buildReportView`, read through `loadReport` like every report), the review's
rewrite that finished last, and its project's brief as it is now. It costs nothing,
writes nothing, and reads the same every time. The coach (t-110) rewords the
questions conversationally; this gives it what to ask and in what order.

### Where gaps come from

In order of strength, which is the order of the list (ties keep the report's
own order):

1. **The placeholders of the rewrite that finished last.** Each `[ADD: …]` the editor left
   (`parsePlaceholders`, `lib/app/frameworks/placeholders.ts`) is a gap, asked
   in its own words. The editor has already said it cannot go on without it.
2. **Recommendations whose suggested rewrite leaves a slot**, by impact: high,
   then medium, then low, read as the report reads it (`High` is high). A slot
   is a part in brackets:
   `We [result, with a number] for [a named client like her] last year.` It is
   a fact the reviewer could not supply. A citation (`[1]`), `[sic]` or a link
   is text, not a slot. A recommendation with no slot (cut a superlative,
   shorten a sentence) is a change the rewrite can make alone, so it is not a
   gap.
3. **Notes on weaknesses**, where the weakness needs a fact. A note on polish,
   structure or clarity does not.
4. **Appeals that scored low** (below 40, the model's Weak band) and have no
   gap yet: one gap each, from the appeal's weakest part that needs a fact. A
   gap one low appeal gives counts for the next, so two that share a fact are
   asked it once.
5. **The project's empty brief fields**, last: offer, audience, voice, markets,
   goals. Only for a review in a project.

**One fact, one gap.** Each part of the model that needs a fact maps to one of
a dozen topics (`TOPIC_OF` and `TOPICS` in `lib/app/coaching/gaps.ts`), and a
topic is asked once however many sources point at it. The worked example's
draft has a recommendation and two notes all asking for a customer like Sarah;
they make the one `customer-proof` gap, which lists all three as sources.

A placeholder is its own gap, never merged into a topic. Its label is the
editor's free text, and telling that `a customer like Sarah's` asks for the
same fact as `customer-proof` would take an AI call. The coach can see both
and ask once.

A recommendation with a slot, on a part of the model that has no topic, is
still a gap. It is asked in the review's own words: the suggestion, and what
goes in its brackets.

**At most 15 gaps** (`MAX_GAPS`). The conversation's turn cap bounds what it can
ask anyway.

### What is already known is not asked

A gap the writer has already answered is dropped. For now that means the
project's brief: a filled field drops its own gap, and the audience drops the
`reader` topic (who the reader is), whichever source raised it. A field holding
only spaces counts as empty. A brief that does not parse is read as no project:
nothing is dropped and no brief field is asked for, and a warning is logged.
Once facts are saved (t-109), they will drop gaps too.

### The model stays private

The questions are the app's own words, written per topic. Text taken from the
review (a recommendation's issue, a note, a placeholder's label) is used only
when it carries none of the model's ids and none of the words in
`MODEL_TERMS` (rubric, weighting).

The ids (`modelVocabulary`) are those of its appeals, dimensions, moves,
levers, red flags, lenses, duties, groups and judges, but only the id-shaped
ones, with an underscore or a digit: `eth_borrowed`, `mv_specific_testimonial`,
`judge_ethos`. An id that is a plain word (`audience`, `move`, `ethos`) is shown
in the report as a name, so it is not private, and banning it would drop a
writer's fact that happens to use the word ("what would move your audience").
`MODEL_TERMS` is kept as short for the same reason: a fact may mention a
product's weight, formula or dimensions. The app's own templates are held to the
wider list (dimensions, weights, formula, levers, judges as well) by their test.

A `found` entry that carries one is left out. A placeholder or a recommendation
that would have to be asked in such words is not asked at all.
Topics are keyed by the app's own names, never the model's, so a gap's `id`
reveals nothing either.

**When a model changes.** `TOPIC_OF` names the 0.5.x dimensions. A version that
renames one fails `tests/unit/lib/app/coaching/gaps.test.ts`, which checks that
every mapped dimension exists in the newest model file. A new dimension with no
topic gives gaps only through recommendations with slots, in the review's own
words, until it is mapped.

### Why templates, and not an AI call

The task asked for a check on whether stored results and templates are enough,
before reaching for a paid call. They are. The review's own text alone would
not do: issues and notes say what is wrong with the copy ("The results are
claimed, not shown."), not what to ask the writer. The topic questions fill
that gap ("Have you solved this for someone like your reader? Who was it, and
what changed for them, in hours, money or another number?"). On the worked
example's draft they give seven gaps, in order: `reader-moment`,
`customer-proof`, `reader-problem`, `small-ask`, `concrete-change`,
`how-it-works`, `objection`. Between them they ask for each fact the final draft
adds: the Leeds warehouse, Harlow & Finch and its numbers, connecting rather
than replacing, the ERP caveat, and the two-page summary.

## Tests

- `tests/unit/lib/app/coaching/gaps.test.ts`: the worked example's gaps and
  their order, each source on its own, the brief dropping what it answers, the
  cap, and the vocabulary scan. The scan's list of forbidden words is built
  from the raw model file, not from `modelVocabulary()`, so a kind of id the
  code missed would fail it.
- `tests/unit/lib/app/coaching/service.test.ts`: the workspace scoping, the 409s,
  the rewrite that finished last, and the brief.
- `tests/unit/app/api/v1/assessments/gaps.test.ts`: the route's guard (session,
  `assess` key, membership) and its refusals.

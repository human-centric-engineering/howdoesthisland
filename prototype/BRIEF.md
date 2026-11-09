# HowDoesThisLand — planning brief

The input to the plan for turning the HowDoesThisLand artefact into a live app
that people sign in to, and a service other software can call. It records what
the artefact is and does, what it leans on that the app will not have, and the
questions the plan has to answer. Written 2026-11-09 against this repo's first
commit on Sunrise `v0.18.0`. Nothing is built yet.

The plan itself is written to load into the HCE Hub (project `howdoesthisland`)
and will live at `.context/app/planning/app-plan.md`, as the spec the Hub's
tasks point at.

## 1. Where this came from

- **The artefact:** a single-page Claude artefact, "HowDoesThisLand: the art of
  changing minds" (claude.ai/artifact/2YvJ6Gfw2hghb4VG8BKpcm). Its source is this
  folder, unchanged except as listed in §9.
- **The model:** `howdoesthisland_model.json`, version **0.5.0** (schema 4,
  dated 2026-11-08, en-GB). It was derived from the Gumption knowledge base plus
  an evidence register checked for this version. The `meta.changes_from_*`
  entries record how it got here, starting as a three-appeal model.
- **The calibration set:** `howdoesthisland_eval_set.json`, version **0.4.0**.
- **The draft API:** `howdoesthisland_api.yaml`, OpenAPI 3.1, version 0.5.0.

## 2. The brief

A service, available through an API or a web app, that lets someone judge their
own content against a very detailed model of influence, presented through the
lenses of logos, ethos, pathos and kairos.

## 3. What the prototype does

Seven pages, each a hash route:

| Route        | What it is                                                                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#home`      | The front page. Its copy is written to the model and scored live.                                                                                                                                                                                   |
| `#assess`    | Paste text or drop a file (PDF, DOCX, PPTX, TXT, Markdown, HTML); a URL tab is a placeholder that says fetching "arrives with the API service". Choose the content type, audience, reader's and writer's culture, and which optional judges to run. |
| `#report`    | A sample report, showing what an assessment returns.                                                                                                                                                                                                |
| `#model`     | The model itself, browsable, with charts.                                                                                                                                                                                                           |
| `#calibrate` | Runs the 18 calibration cases and reports pass rates. In the artefact this runs the quick scan only.                                                                                                                                                |
| `#api`       | Shows the API request and response for the current text.                                                                                                                                                                                            |
| `#about`     | The lineage of the idea, with the Greek visual system.                                                                                                                                                                                              |

Two ways to assess:

- **The quick scan** is deterministic, free and works offline. Regular
  expressions per dimension (`heuristic` in the model) plus craft metrics:
  word count, speaking time, Gunning fog, Flesch–Kincaid grade, passive voice,
  emotional language, rhetorical devices and appeal share by words.
- **The AI judges** are nine LLM calls, one per judge in the model's `judges`:
  ethos, pathos, logos and kairos always, and lenses, influence, craft,
  audience and culture on request (`judge_catalogue`). Each judge gets a prompt
  built by `engine.judgePrompt()`, and its reply is checked by
  `engine.validJudgeOutput()` against `judge_output_schema`. The artefact fires
  them all at once, and shows the quick scan's result for any judge that fails.

A full assessment returns an overall score and band, a score per appeal,
dimension scores with reasons, highlighted passages, recommendations with
rewrites, red flags, balance findings, the five duties, influence perspectives,
craft metrics and, when asked, the culture gap between writer and reader
(`Assessment` in the draft API).

**Rewrite** sends the text, its assessment and a focus to an LLM and streams back
a draft, with placeholders for facts the author must supply.

## 4. The model, in numbers

| Part                   | Count                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Appeals                | 4: ethos, pathos, logos, kairos                                                                                           |
| Dimensions             | 23 core (6 each for ethos, pathos and logos, 5 for kairos) plus 20 in the craft (6), audience (4) and culture (10) groups |
| Lenses                 | 4: telos, mythos, prepon, dialogue                                                                                        |
| Influence perspectives | 13, with 78 levers                                                                                                        |
| Moves                  | 58                                                                                                                        |
| Red flags              | 9                                                                                                                         |
| Content types          | 16, each with its own weights and length target                                                                           |
| Audience archetypes    | 6, plus 14 executive roles                                                                                                |
| Rhetorical duties      | 5: teach, delight, move, steer, unsettle                                                                                  |
| Culture                | 37 countries, 9 text-level scales, Lewis placements and approximate Hofstede scores                                       |
| Research register      | 38 entries, plus 229 knowledge references (frameworks, concepts, thinkers, studies)                                       |
| Stated limitations     | 15                                                                                                                        |
| Score bands            | Weak 0–39 · Developing 40–59 · Solid 60–74 · Strong 75–89 · Exceptional 90–100                                            |
| Calibration cases      | 18, across 11 content types                                                                                               |

The model also carries the brand: name, tagline ("The art of changing minds"),
principles, glossary and visual notes.

## 5. What the prototype leans on, and what stands in for it in the app

The right-hand column is a hypothesis for the plan to check against the tree,
not a finding.

| In the artefact                                           | What it does there                                                 | In the app                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `claude.use("sample")`                                    | Runs the nine judges and the rewrite                               | Sunrise's LLM provider layer, which records cost per call                                                                |
| `claude.use("downloads")`                                 | Saves a report, the model, or calibration results                  | A download from an API route                                                                                             |
| `localStorage` (`peithia:` theme, draft, history, judges) | Remembers the theme, the draft, past assessments and judge choices | Theme and draft can stay in the browser; history is stored data (see Q5)                                                 |
| pdf.js, mammoth and jszip from jsDelivr                   | Extracts text from PDF, DOCX and PPTX in the browser               | Sunrise's document parsers on the server, which the API's `source.file_base64` needs anyway                              |
| Nothing (a placeholder)                                   | Fetching a page from a URL                                         | A server-side fetch for `source.url`, which needs SSRF protection; check what Sunrise's outbound HTTP code already gives |
| Model and eval set inlined as JSON script tags            | The whole model ships to the browser                               | Loaded on the server (see Q2)                                                                                            |
| No accounts                                               | Anyone with the link can use it                                    | Sunrise accounts (see Q4)                                                                                                |

`engine.js` (quick scan, craft metrics, scoring, judge and rewrite prompts,
calibration) has no DOM and no framework, and its README says to reuse it in the
API service. It is the first thing to port, as typed modules.

Three things in it to fix in the port rather than carry across. They are left
alone here, because this folder stays as delivered:

- **`validJudgeOutput()` checks only that the reply has an array.** It never
  checks the entries: their dimension ids, or that each score is a number from
  0 to 4. A judge replying `{ dimension_scores: [{ dimension: "nope", score: "7" }] }`
  passes, and `assemble()` then looks up a dimension that does not exist. In the
  app, a judge's reply is external data, and gets a Zod schema.
- **`locate()` finds a quote in `text.toLowerCase()` and returns offsets into
  `text`.** Lower-casing can change a string's length (`İ` becomes two code
  units), so a highlight after such a character lands one place off per
  occurrence.
- **`rewritePrompt()` picks the duty the audience needs by `=== 40`.** That works
  only because `fnTarget()` gives the primary duty exactly 40. Take the
  highest-weighted duty instead, so a change to the weights cannot silently
  drop the guidance.

## 6. The draft API, and what is wrong with it

`howdoesthisland_api.yaml` describes `POST /v1/assess`,
`POST /v1/assess/{appeal}`, `POST /v1/rewrite`, `POST /v1/eval` and
`GET /v1/model`. It is a draft, and these need fixing before anything is built
from it:

- **It is not valid YAML.** In `AssessRequest`, a stray
  `description: { type: string, description: Free-text description of the reader }`
  is indented under `judges` (line 103), so the file does not parse. It belongs
  in `audience`.
- `model_version` defaults to `0.1.0`; the model is `0.5.0`.
- The summary of `/v1/assess/{appeal}` names four judges; its enum has nine.
- The description lists three lenses; the model has four (dialogue was added).
- Responses are bare objects. Sunrise's API returns
  `{ success, data, meta? }` and `{ success: false, error }` (see Q8).

## 7. Reference material

| File                                                            | What it is                                                                                                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                     | The artefact's own notes: structure, build, and how the AI judges are wired                                                                                           |
| `src/engine.js`                                                 | The engine. Its `createEngine(MODEL)` returns the model indexes and `quickScan`, `assemble`, `toApi`, `judgePrompt`, `validJudgeOutput`, `rewritePrompt`, `calibrate` |
| `src/App.jsx`                                                   | The assembled UI, and the file `main.jsx` imports. The `.part.jsx` files are the pieces it was assembled from                                                         |
| `src/main.jsx`                                                  | Reads the model and eval set from the page and mounts the app                                                                                                         |
| `shell.html`, `build.py`, `tailwind.config.js`, `src/input.css` | The single-file build and the "Tyrian & Graphite" theme tokens                                                                                                        |
| `howdoesthisland_model.json`                                    | The model (§4)                                                                                                                                                        |
| `howdoesthisland_eval_set.json`                                 | The calibration set                                                                                                                                                   |
| `howdoesthisland_api.yaml`                                      | The draft API (§6)                                                                                                                                                    |

## 8. Questions the plan has to answer

Each is a product call for the owner, not something to settle while building.

1. **Who pays, and how is use metered?** A full assessment is up to nine LLM
   calls, and a rewrite is one more, while the quick scan costs nothing. The
   options range from a free quick scan with paid AI judges, to an allowance per
   account, to metering per API key.
2. **Is the model code or data?** As versioned JSON in the repo, every change is
   a reviewed PR and `model_version` is a release. As database rows, an admin
   can edit it, but then versioning, calibration and old assessments need their
   own story.
3. **Which provider and model run the judges?** This sets the cost and latency
   of every assessment. The artefact runs up to nine judges at once, so a
   provider's rate limits matter as much as its price.
4. **Can someone assess without signing in?** The artefact has no accounts. The
   quick scan could stay open to anyone; the AI judges need a limit of some kind.
5. **Do we keep what people submit?** Keeping the text and its assessments gives
   history and shareable reports, but makes them personal data under Sunrise's
   erasure and export rules. Not keeping them makes the service stateless.
6. **Can we use the culture data commercially?** The model carries approximate
   Hofstede country scores and Lewis-model placements. Their terms need checking
   before a paid service ships them.
7. **Is the calibration set brought up to the model first?** It is v0.4.0 and
   has no expectations for the craft, audience or culture judges added in 0.5.0.
   Its own notes say the expectations should be reviewed by two people before
   being used as ground truth.
8. **Is the draft API the contract, or a starting point?** Keeping its paths and
   bodies as drafted is less design work. Moving it into Sunrise's
   `{ success, data }` envelope under `/api/v1/` matches the rest of the
   platform, and Sunrise rate-limits `/api/v1/` routes without extra code.
9. **Does the artefact's look come across?** The Tyrian & Graphite theme, the
   display faces and the Greek visual system are part of the brand in the model.
   Sunrise has a per-surface theming seam for a consumer look.

## 9. Working with the prototype here

- **Never read by the app.** Nothing outside `prototype/` may import from it;
  the app gets its own typed ports. It stays as the reference to port from and to
  check behaviour against.
- **Excluded from the tooling.** ESLint ignores it through the fork-owned seam
  (`lib/app/eslint.config.mjs`), Prettier through `.prettierignore` (divergence
  ledger row 3), Tailwind's automatic source scan through `@source not` in
  `app/globals.css` (ledger row 4), and TypeScript never includes it
  (`tsconfig.json` includes only `.ts` and `.tsx`). Without the Tailwind line,
  the prototype's classes were compiled into the app's stylesheet, about 15 KB
  of rules nothing uses. CodeQL still analyses it on GitHub.
- **Changed from the delivery:**
  - a note at the top of `README.md`, pointing here and warning against
    building inside the repo;
  - the zip's `package.json` is left out. It was an unnamed scaffold listing the
    four build tools the README's build command installs anyway, and as a
    manifest in a public repo it would draw dependency alerts for a folder
    nothing runs;
  - the draft API, delivered beside the zip, is added.
- **Building it:** copy the folder outside the repo first. The commands in
  `README.md` install their tools with `npm i`, and with no `package.json` here
  npm would write them into the app's root manifest, replacing Tailwind 4 with
  Tailwind 3. The build expects the model and eval set alongside, which they are.

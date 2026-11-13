# HowDoesThisLand — from artefact to app

The plan for turning the HowDoesThisLand artefact into a live service: a web app that
people and teams sign in to, and an API other software calls, both judging content
against a detailed, versioned model of persuasion. Written 2026-11-09 against `main`
(`88a8684f`, Sunrise `v0.18.0`). Nothing is built yet.

- **The brief** is [`prototype/BRIEF.md`](../../../prototype/BRIEF.md). Its nine questions
  (§8 there), and the further questions this plan raised, are answered in §10 here as
  D1–D23. D24–D27 (2026-11-13) add editing a draft in place, revising a selected passage
  with the AI, the choice of UK or US English, and the copywriting vocabulary of §4.
- **The model for this document** is Know Your Synth's `.context/app/planning/app-plan.md`.
- **The source documents** are already in the repo, byte for byte: the model, the
  calibration set and the draft API in `prototype/`, and the artefact's source unpacked
  in `prototype/src/` (BRIEF §9 lists the one file left out and why).

**This plan is written to load into the HCE Hub** (project `howdoesthisland`). §6 has one
block per phase and one per feature, and each field is named for the Hub verb argument it
becomes. §7 says how to load it. Once loaded, the Hub is the record of what is planned,
owned and done. This document is the spec the Hub points at (`model.spec`): task
descriptions link here and do not copy design out of it.

**Contents**

1. [Where the project is today](#1-where-the-project-is-today)
2. [The prototype is a source, never read by the app](#2-the-prototype-is-a-source-never-read-by-the-app)
3. [Porting map](#3-porting-map)
4. [What we are building](#4-what-we-are-building)
5. [Ground rules](#5-ground-rules)
6. [Phases and features](#6-phases-and-features)
7. [Loading this into the Hub](#7-loading-this-into-the-hub)
8. [Design](#8-design)
9. [Data model changes, in one place](#9-data-model-changes-in-one-place)
10. [Decisions](#10-decisions)
11. [Risks](#11-risks)
12. [Later](#12-later)

---

## 1. Where the project is today

### The prototype

A single-page Claude artefact: seven hash routes (home, assess, sample report, model,
calibrate, API, about), a deterministic quick scan, and nine LLM judges fired at once from
the browser. BRIEF §3–§7 describe it in full. What matters for the plan:

- **`src/engine.js`** (669 lines, no DOM) holds everything that is not UI: the quick scan,
  craft metrics, culture profiles, scoring, `assemble()`, the judge and rewrite prompts and
  calibration. It is the first thing to port.
- **The model** (`howdoesthisland_model.json`, v0.5.1, schema 4) has 27 top-level keys,
  which hold 4 appeals, 23 core and 20 extra dimensions, 4 lenses, 9 judges, 58 moves, 9 red flags,
  16 content types, 6 archetypes, 14 executive roles, 13 perspectives with 78 levers,
  5 duties, 37 culture countries on 9 scales, 38 research entries, 265 knowledge refs,
  15 limitations, scoring rules and the brand. Its entities refer to each other by id
  (`grounded_in`, `research`, `moves`, `dimensions`). `meta.reference_rules` lists every
  reference field and its target. 0.5.0 left 38 of them unresolved (an export fault);
  0.5.1 fixes that and changes nothing else, and `prototype/tools/validate_refs.py`
  checks it.
- **The calibration set** is v0.4.0: 18 cases across 11 content types, with expected
  bands per appeal, flags present and absent, recommended dimensions and the primary duty.
  It has no expectations for the craft, audience or culture judges.
- **Two type systems are on record.** The artefact uses Instrument Serif and Geist in the
  "Tyrian & Graphite" theme. The model's `brand.visual` asks for Newsreader and Schibsted
  Grotesk, and a mark of two overlapping circles. D15 decides between them by eye.

### The fork

Sunrise `v0.18.0`, set up as HowDoesThisLand in t-1 (PR #5, merged). Dev port 3018,
registered in the HCE dev-proxy. Two seams are filled: `lib/app/eslint.config.mjs` (ignores `prototype/**`) and
`lib/app/reserved-tiers.ts` (`.context/app`), both pinned in
`tests/unit/lib/app/defaults.test.ts`. The divergence ledger has rows 1–4. Everything else
is at its shipped default: `prisma/schema/app.prisma` has no models, `components/app/` is
empty, `app/brand-theme.css` holds only comments. There is no `.env` yet, only a
gitignored `.env.local` holding `OPENAI_API_KEY`.

### Facts about Sunrise that shape the plan

Found in this tree on 2026-11-09 by reading the code. **Live** means a production caller
uses it; **dormant** means it exists and nothing calls it yet. Each fact is re-checked
when the feature that relies on it is claimed (`fp1`).

**Tenancy**

- **Switching to `TENANCY_MODE=multi`** is: migrate and seed as the owner role, create the
  `NOBYPASSRLS` app role (`npm run db:tenancy:role -- --create`), enable the policies
  (`db:tenancy:enable`), point `DATABASE_URL` at the app role and `MIGRATE_DATABASE_URL`
  at the owner, then `db:drift-check` (`.context/architecture/multi-tenancy.md:168-301`).
  `docker-compose.yml` provides only the superuser, so the role is created by hand.
  `db:tenancy:enable` acts only on tables whose RLS is off, so it is re-run after each new
  tenant table.
- **A self-serve signup does not get an org of its own.** At `multi`, an uninvited signup
  becomes a `MEMBER` of the install org, which is the vendor's own
  (`lib/tenancy/membership.ts:79`, `.context/tenancy/identity.md:180-195`). Sunrise leaves
  "self-serve signup UX" to the fork by design (`multi-tenancy-design.md:92-94`). The
  pieces exist: `lib/app/user-created.ts` (dormant; runs after the user row exists and
  cannot reject a signup), `createOrg()` (`lib/tenancy/lifecycle.ts:250`, which also gives
  the org its platform agents), `writeOrgProviderPolicy()` and `writeOrgQuotas()`
  (`lib/tenancy/org-settings.ts:316, 419`).
- **A new org can call no AI provider** until it is granted one; the install org may use
  all (`.context/orchestration/llm-providers.md:744-760`). Every org we create must be
  granted OpenAI in the same step.
- **A tenant-owned fork model** needs `orgId` with a cascading `Org` relation, a
  back-relation line on `Org` in `prisma/schema/tenancy.prisma` (a core-file edit, so a
  ledger row), an `orgIsolationPolicySql()` policy in its migration, `@@unique([orgId,
slug])` for slugs, and registration with the org export (`lib/app/org-export.ts`).
  Enforced by `model-classification`, `policy-coverage`, `org-sources` and
  `org-scoped-slugs` tests. A model with no `orgId` is classified in
  `lib/app/tenancy-classification.ts`. Raw SQL needs a row in the core
  `tests/unit/db-raw-sql-allowlist.test.ts` (no seam), so the plan avoids raw SQL.
- **A `userId` / `createdBy` column** is a plain `String` with a hand-written FK in the
  migration (`ON DELETE CASCADE` or `SET NULL`) and a drift probe in `lib/app/db-drift.ts`,
  because a Prisma relation to `User` would edit core. Every `app.prisma` model is declared
  to the subject export through `lib/app/data-export.ts`, as a source or an exclusion with
  a reason (`export-sources.test.ts:395`). `eraseOrg` has no hook: it relies on cascades
  and sweeps storage under `orgs/{orgId}/`.
- **Org roles are `OWNER`, `ADMIN`, `MEMBER`, and closed.** Per-row read rules go through
  `lib/app/owner-classification.ts`. Handlers read the org with `requireOrgId()`.
- **`multi-tenancy.md:330, 410` is stale**: it says the org export has no fork seam. It
  does (`lib/app/org-export.ts` → `registerAppOrgSources`).

**AI**

- **No provider row is seeded.** OpenAI is a known provider (`known-providers.ts:75-86`)
  that the setup wizard offers once `OPENAI_API_KEY` is set; an admin creates the row. The
  seeded OpenAI models are `gpt-5`, `gpt-4.1`, `gpt-4o`, `gpt-4o-mini`, `o3-mini`,
  `text-embedding-3-small` and `-large` (`prisma/seeds/009-provider-models.ts`).
- **There is no "call and meter" helper.** App code resolves a provider
  (`providerManager.getProvider`), calls `runStructuredCompletion()`
  (`lib/orchestration/llm/structured-completion.ts:237`, which takes a native
  `json_schema`, retries malformed JSON once, and persists nothing), then logs with
  `costTracker.logCost()`, which stamps the org from tenant context. Defaults to raise:
  `maxTokens` 1500 and a 10-second timeout per attempt.
- **The per-org monthly budget gate is automatic** on every provider call, but refuses only
  once spend has already passed the cap, counts only what was logged, and refuses calls
  with no org in context at `multi` (`spend-caps.ts:438`).
- **Platform agents** (`lib/app/platform-agents.ts`, dormant) give every org its own
  instance of a code-defined agent. The fork owns what it is (instructions, temperature,
  persona); the org tunes how it runs (provider, model, budget, rate limit). An agent's
  `metadata` cannot be set by a platform definition, so native `json_schema` is reached by
  calling the provider directly with the agent's binding, not through chat. That skips the
  agent's own `monthlyBudgetUsd` and `rateLimitRpm`, which only the chat routes enforce
  (`checkBudget()` under `withAgentBudgetLock()`, and `agentChatLimiter`), so a direct
  caller has to apply both itself.
- **The workflow engine** could run nine parallel `llm_call` steps then a `tool_call`, with
  leases and recovery, but has no fork step types, no fork template seam, globally unique
  workflow slugs and admin-only status routes. D16 rules it out for the core pipeline.
- **There is no job queue.** Durable background work in Sunrise is a database row plus
  `keepRunningAfterResponse()` (Next `after()`), with a maintenance-tick sweep as the
  crash backstop. App jobs register through `lib/app/jobs.ts` (per-org by default; minimum
  interval held in memory). In production the tick runs only if an external cron calls
  it with `CRON_SECRET`; an idle gate can skip ticks for 30 minutes unless
  `noteMaintenanceWork()` is called.
- **Evaluations** take fork graders (`lib/app/evaluations.ts`) but not fork subject types
  (`subjectKind` is `agent | workflow`).

**Knowledge, files and fetching**

- **The knowledge base is one corpus per org.** Several bases per org are in the schema but
  every write uses the org's default. Search can be limited to a list of document ids
  (`searchKnowledge(query, { documentIds })`, `lib/orchestration/knowledge/search.ts:178`;
  an empty list returns nothing). Uploads dedupe by content hash within the org, so two
  projects can share one document row. Tags are install-wide and unusable per org.
- **Embeddings** at `vector(1536)` with an HNSW index; `text-embedding-3-small` fits. The
  embedder needs an OpenAI provider row and an active embedding model, not just the key.
- **`parseDocument(buffer, fileName)`** (`lib/orchestration/knowledge/parsers/index.ts:60`)
  turns PDF, DOCX, HTML, Markdown, TXT, CSV and EPUB into text, with no database access.
  **PPTX is not supported anywhere.** Scanned PDFs are not supported.
- **`fetchDocumentFromUrl()`** checks each redirect hop and caps size, but takes the file
  type from the URL path first (so `/pricing.php` is refused even when served as HTML),
  buffers the whole body before its second size check, and does no DNS check itself. The
  connect-time address check (`outboundDispatcher()`) applies only to customer orgs at
  `multi`. Any `fetch(` we write must set a redirect policy
  (`outbound-fetch-redirects.test.ts`).
- **Storage**: `getStorageClient({ orgId })` confines keys to `orgs/{orgId}/`; uploads are
  public unless `public: false`; 5 MB default cap.

**API and surface**

- **`withAuth()` accepts a session or a `Bearer sk_` key** and checks a scope with
  `{ scope }` (`lib/auth/guards.ts:970`). Fork scopes go in `lib/app/api-key-scopes.ts`
  (dormant). Keys act as their user and are bound to one org at mint. **No self-service
  key UI ships.**
- **Rate limits**: every `/api/v1/**` route inherits 100/min per user; anonymous callers are
  keyed by IP. `lib/app/rate-limit.ts` adds tiers, keys and rules (dormant); per-flow
  limiters are plain `createRateLimiter()` instances. An anonymous route enters a tenant
  itself with `runAsOrg(INSTALL_ORG_ID, …, { source: 'public-form' })`, as the waitlist does.
- **Event hooks** accept fork events named `app.*`, signed with HMAC and retried
  (`lib/orchestration/hooks/types.ts:96`, `registry.ts:238`), but only platform admins can
  create hooks and there is no UI. Webhook subscriptions, which org admins can manage, have
  a closed event list.
- **SSE**: `sseResponse()` (`lib/api/sse.ts:48`); event types must match
  `/^[a-z0-9_]+$/i` or they are silently renamed `unknown`.
- **MCP** tools are capabilities registered in `lib/app/capabilities.ts`, each needing an
  `AiCapability` row (seeded through `lib/app/capability-seed-pairs.ts`) and an
  `McpExposedTool` row enabled per install. MCP keys (`smcp_`) are bound to an org.
- **Not present**: OpenAPI generation (Sunrise ruled out OpenAPI-_driven_ validation,
  `architectural-decisions.md:1290`), any PDF renderer, any share-link feature, fonts
  (`app/layout.tsx` loads none), and motion libraries. Present: shadcn/ui on Radix,
  Recharts, ECharts, Tailwind 4, react-markdown, zod 4.
- **Theming**: `classifySurface()` marks everything outside `/admin` as `consumer`;
  `app/brand-theme.css` overrides tokens under `[data-surface='consumer']`.
- **The dashboard has no seam**, but `lib/app/auth-landing.ts` moves where people land, so
  the app need not edit it.

---

## 2. The prototype is a source, never read by the app

The rule from BRIEF §9 holds for the whole build:

- **Nothing outside `prototype/` imports from it.** A guard test fails if any file does
  (`e1`). The app's data files are copies, made once, with their checksum recorded.
- **The prototype is the reference for behaviour.** The engine port is proved against a
  baseline recorded from the prototype's own engine (`e1`), and every deliberate difference
  is listed.
- **It stays as delivered.** The three engine bugs in BRIEF §5 are fixed in the port, never
  in `prototype/`.

---

## 3. Porting map

| Prototype                                    | Becomes                                                                                               | Feature                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------- |
| `howdoesthisland_model.json`                 | `lib/app/frameworks/howdoesthisland/data/model-0.5.1.json`, imported into the framework tables (§8.1) | `f-framework-store`    |
| `howdoesthisland_eval_set.json`              | `lib/app/frameworks/howdoesthisland/data/eval-0.5.1.json`, brought up to the model (`k1`)             | `f-calibration`        |
| `engine.js` — text utilities, `craft()`      | `lib/app/frameworks/howdoesthisland/engine/text.ts`, `craft.ts`                                       | `f-engine`             |
| `engine.js` — `quickScan`, `extraScan`       | `…/engine/quick-scan.ts`                                                                              | `f-engine`             |
| `engine.js` — culture profiles and positions | `…/engine/culture.ts`                                                                                 | `f-engine`             |
| `engine.js` — weights, scores, `assemble`    | `…/engine/scoring.ts`, `assemble.ts`                                                                  | `f-engine`             |
| `engine.js` — `judgePrompt`                  | `…/judges/prompts.ts`, with output schemas in `…/judges/schemas.ts`                                   | `f-judges`             |
| `engine.js` — `validJudgeOutput`             | replaced by the Zod schemas plus post-validation (ids exist, quotes located)                          | `f-judges`             |
| `engine.js` — `rewritePrompt`                | `…/rewrite/prompt.ts`, with the duty fix                                                              | `f-rewrite`            |
| `engine.js` — `calibrate`                    | `lib/app/calibration/`                                                                                | `f-calibration`        |
| `engine.js` — `toApi`                        | the public `Assessment` schema in `lib/app/assessments/schema.ts`                                     | `f-assessments`        |
| `howdoesthisland_api.yaml`                   | a starting point only (D12); the contract is the route registry, published as OpenAPI (`dp2`)         | `f-assessments`        |
| `App.jsx` — Assess, Editor and Reader cards  | the assess workbench                                                                                  | `f-workbench`          |
| `App.jsx` — results Workspace and tabs       | the report                                                                                            | `f-report`             |
| `App.jsx` — `VennScore`, charts, `Pips`      | report charts                                                                                         | `f-report`             |
| `App.jsx` — `RewriteDrawer`                  | the rewrite drawer                                                                                    | `f-rewrite`            |
| `App.jsx` — Home, Model, About views         | the public site                                                                                       | `f-public-site`        |
| `App.jsx` — Calibrate view                   | the admin calibration page                                                                            | `f-calibration`        |
| `App.jsx` — API view                         | the developer docs                                                                                    | `f-developer-platform` |
| `greek.part.jsx` — coins, meander, lineage   | `components/app/brand/`, if the chosen design keeps them (D15)                                        | `f-app-frame`          |
| `shell.html`, `tailwind.config.js` tokens    | `app/brand-theme.css`, if the chosen design keeps them (D15)                                          | `f-app-frame`          |
| `localStorage` history                       | stored assessments (D10); theme and draft stay in the browser                                         | `f-workbench`          |
| pdf.js, mammoth, jszip in the browser        | server-side intake (`parseDocument` plus a PPTX extractor)                                            | `f-intake`             |

---

## 4. What we are building

### In one paragraph

HowDoesThisLand judges a piece of writing the way a sharp, well-read editor would: how it
lands on credibility, emotion, reason and timing, which levers of influence it pulls, what
it gets wrong for this reader and culture, and what to change, with rewrites. A person or
team signs in to a workspace, keeps projects that hold the background of their work
(positioning, audience, voice, documents), and assesses drafts against them in the browser
or through the API. Each assessment runs a deterministic quick scan and up to nine AI
judges, then an editor's summary, and becomes a report polished enough to send to a client:
on the web, as a PDF, or by link. The persuasion model is the first of several
**frameworks** the service can judge against (D2), stored as versioned records (D3), so
every result says exactly which model and which judges produced it.

### Shape

```
                         ┌───────────────────────────── web app ─────────────────────────────┐
  public site            │ workbench · report · projects · compare · rewrite · settings      │
  (landing, free scan,   └───────────────────────────────┬───────────────────────────────────┘
   model, docs)                                          │ same routes the API offers
        │                                                ▼
        └──────────────▶  /api/v1/**  (Sunrise envelope, session or sk_ key, scopes)  ◀── MCP tools
                                                         │
               ┌─────────────────────┬───────────────────┼──────────────────────┬──────────────────┐
               ▼                     ▼                   ▼                      ▼                  ▼
          intake               assessment job       framework store        project context      reports
   (text, file, URL→text)   (quick scan → judges   (versioned records,    (Sunrise knowledge    (web, PDF,
                             → editor → assemble)    materialised model)    base, per project)   share links)
                                     │
                                     ▼
                         judges = platform agents per org
                         (OpenAI by default, json_schema replies,
                          cost logged per call, org budget gate)
```

### Route map

| URL                            | What it is                                                         | Who            |
| ------------------------------ | ------------------------------------------------------------------ | -------------- |
| `/`                            | The landing page, its copy scored live; the free quick scan        | anyone         |
| `/scan`                        | The free quick scan, full page                                     | anyone         |
| `/model`, `/model/…`           | The model, browsable: appeals, dimensions, moves, research, limits | anyone         |
| `/about`                       | The lineage of the idea                                            | anyone         |
| `/developers`, `/developers/…` | API docs: guides, recipes and the OpenAPI reference                | anyone         |
| `/r/[token]`                   | A shared report, read-only                                         | link holder    |
| `/home`                        | Where a signed-in person lands: recent work, projects              | member         |
| `/assess`                      | The workbench                                                      | member         |
| `/assessments/[id]`            | The report                                                         | member         |
| `/drafts/[id]`                 | The draft editor: edit in place, revise a passage, see changes     | member         |
| `/compare/[id]`                | A comparison of drafts                                             | member         |
| `/projects`, `/projects/[id]`  | Projects: brief, defaults, context documents, history              | member         |
| `/usage`                       | This month's assessments, spend and limit                          | member         |
| `/profile` (account section)   | Personal preferences: default English (UK or US)                   | member         |
| `/settings/…`                  | Workspace, members, API keys, retention                            | owner/admin    |
| `/admin/frameworks`            | Framework versions, imports and calibration runs                   | platform admin |

### API map (v1)

All under `/api/v1/`, in Sunrise's `{ success, data, meta? }` envelope. Names were checked
against core's `/api/v1` tree: `webhooks` is taken by core, so subscriptions use
`event-subscriptions` (phase 2).

| Route                                                     | Purpose                                                      | Auth                |
| --------------------------------------------------------- | ------------------------------------------------------------ | ------------------- |
| `GET  frameworks`, `GET frameworks/{slug}`                | Frameworks and their published versions                      | anyone              |
| `GET  frameworks/{slug}/versions/{version}`               | The whole model document, as stored                          | anyone              |
| `GET  frameworks/{slug}/versions/{version}/{kind}`        | One kind of entity (dimensions, moves, red flags…)           | anyone              |
| `POST scan`                                               | Quick scan: deterministic, free, nothing stored              | anyone (IP-limited) |
| `POST assessments`                                        | Assess: profile or judges, project, context, `wait`, `store` | `assess`            |
| `GET  assessments`, `GET assessments/{id}`                | List and read                                                | `assess`            |
| `GET  assessments/{id}/events`                            | Live progress (SSE)                                          | `assess`            |
| `POST assessments/{id}/cancel`, `DELETE assessments/{id}` | Cancel, delete                                               | `assess`            |
| `GET  assessments/{id}/report.pdf`                        | The report as a PDF                                          | `reports`           |
| `POST assessments/{id}/shares`, `DELETE shares/{id}`      | Share links                                                  | `reports`           |
| `GET  shared-reports/{token}`                             | A shared report's data                                       | link holder         |
| `POST rewrites`                                           | Rewrite from an assessment (JSON or stream)                  | `assess`            |
| `GET  drafts/{id}`, `POST drafts/{id}/versions`           | A draft and its versions; save the writer's own edits        | `assess`            |
| `POST revisions`, `POST revisions/{id}/accept\|reject`    | Revise a selected passage with the writer's direction        | `assess`            |
| `GET  preferences`, `PATCH preferences`                   | The caller's own defaults (English variant)                  | session             |
| `POST comparisons`, `GET comparisons/{id}`                | Compare 2–5 drafts                                           | `assess`            |
| `…/projects`, `…/projects/{id}/documents`                 | Projects and their context                                   | `projects`          |
| `GET  usage`                                              | This month's usage and limits                                | `assess`            |
| `GET  openapi.json`                                       | The OpenAPI 3.1 document, generated from the route contracts | anyone              |
| _phase 2:_ `batches`, `panels`, `event-subscriptions`     | Batches, audience panels, webhook subscriptions              | `assess`            |

**Profiles** meet varying needs without a new endpoint per use: `quick` (no AI), `core`
(the four appeals), `full` (all nine), and the model's `judge_catalogue` groups (`craft`,
`audience`, `culture`, `lenses`, `influence`), or an explicit `judges` list. The developer
docs carry recipes for common jobs: scoring a landing page, checking an exec briefing for a
CFO, comparing subject lines, gating content in CI.

### The words we use

The people who use this are copywriters, editors and the people who brief them, so the
product speaks their trade's language (D27). This list is the reference for every
interface label, message, email, report heading, help popover and developer guide. A
word not listed here is checked against how a copywriter would say it before it ships;
a new term is added here in the same PR.

**Settled** (the plan already uses these, or they have no rival):

| Say                                               | Means                                                                                       | Not                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **copy**                                          | The words being written or reviewed, as a whole                                             | content, text, input                                 |
| **draft**, **draft 2**                            | One version of the copy; drafts are numbered in order                                       | version, revision number, iteration                  |
| **brief**                                         | What the copy must do, for whom, in what voice: a project's brief                           | context, settings, profile                           |
| **client**                                        | Who the copy is for, when the writer works for someone else                                 | customer, account holder                             |
| **tone of voice**                                 | How the brand or author sounds (in the brief)                                               | voice settings, style                                |
| **house style**                                   | A workspace's or client's rules on spelling, punctuation and usage, UK or US English first  | locale, language settings                            |
| **UK English**, **US English**                    | The two spelling conventions offered (D26)                                                  | en-GB, en-US, British locale                         |
| **headline**, **subhead**, **body copy**, **CTA** | Parts of a piece, as copywriters name them                                                  | title, heading, paragraph, button                    |
| **mark-up**, **marked-up copy**                   | The copy with the review's notes marked in place                                            | annotations, highlights, overlay                     |
| **note**                                          | One point the review makes about a passage                                                  | finding, issue, highlight                            |
| **edit**                                          | A change the writer makes in their own words (D25)                                          | modification, manual change                          |
| **revise**, **revision**                          | A passage reworked by the AI, to the writer's **direction** (D24)                           | regenerate, AI rewrite of selection                  |
| **direction**                                     | What the writer asks of a revision: "warmer", "cut to 20 words", "lead with the saving"     | prompt, instruction, guidance                        |
| **suggested**, **accept**, **reject**             | A revision waits as suggested until the writer accepts or rejects it, as in tracked changes | apply, approve, discard                              |
| **changes**, **show changes**                     | The difference between two drafts, shown as tracked changes                                 | diff, delta                                          |
| **rewrite**                                       | A whole new draft from the review (`f-rewrite`)                                             | regeneration                                         |
| **word count**, **length**                        | As copywriters count them                                                                   | tokens, characters (unless a limit is in characters) |
| **placeholder**                                   | A gap for a fact only the writer knows: `[ADD: client name]`                                | variable, slot                                       |

**Proposed, for the owner to settle** (open question 5): what to call an
_assessment_ (review? copy review? critique?), the _judges_ (reviewers? the panel?), the
_report_ (it stays "report" unless the first changes), _content type_ (format?), and one
piece of work in a project (job? assignment?).

**Where this applies.** Everything a person reads: the interface, reports, PDFs, emails,
errors, help text, the public site and the developer docs' prose. **Code and API names are
not renamed** for it: `Content`, `Assessment` and the route paths already planned keep their
names, so the API stays stable and the code matches the plan. A new public name (a route, a
field, an event) takes the glossary's word where it does not collide, as `drafts` and
`revisions` do.

---

## 5. Ground rules

- **API first.** Every capability is a route before it is a page, and pages read only from
  the API. Each route is declared with a contract (method, path, request and response Zod
  schemas, scope, summary) in the route registry from `p2`, which `dp2` publishes as OpenAPI.
- **Frameworks are data plus code.** A framework's records (rubric, weights, prompts'
  content) are versioned data; its engine, judge slots and record schemas are code. A
  published version never changes (§8.1).
- **Every result is reproducible.** An assessment records its framework version, the
  context it ran in, each judge's model and provider, and its cost.
- **Judges' replies are external data.** Validated by Zod, then post-validated: unknown
  ids dropped, scores clamped to the scale, quotes located in the text or dropped, all
  counted in the judge run.
- **Content and context documents are untrusted.** They are framed as data in every prompt;
  judges have no tools.
- **Tenancy is on from the first task** (`w1`). Every tenant-owned model carries `orgId`
  with its isolation policy, and a smoke run proves two workspaces cannot see each other's
  rows.
- **Standing steps for each new model** (listed in every schema task's done-when as "the
  model steps"): `orgId` and its policy, or a classification; the `Org` back-relation, with
  the `tenancy.prisma` ledger row extended (or created, by the first task to add a tenant
  model); hand-written FKs to `User` and to core models (§9), with drift probes; subject-export and
  org-export registration; the migration's SQL reviewed for spurious index drops (`B13`)
  and `db:tenancy:enable` re-run.
- **Own modules are declared.** Each new directory under `lib/app/` is listed in
  `lib/app/own-modules.ts`. Each seam filled re-pins its `defaults.test.ts` row (`HB2`).
- **Gates before every PR**, in the order of `CLAUDE.md`. Written once here, not in every
  task row. Lint and format run on the changed files.
- **Copy is plain English**: concrete, short, no flourishes. Every non-trivial form field
  has a `<FieldHelp>` popover.
- **Speak the copywriter's language.** Every word a person reads uses the terms in §4
  "The words we use" (D27). Reviewing a PR that adds visible words includes checking them
  against that list; a new term joins the list in the same PR.
- **Every result says which English it was written in.** An assessment, rewrite or revision
  records the English variant it ran with (D26), as it records its framework version.

---

## 6. Phases and features

### Shape

Phases are epics, not an order. **The order comes from the dependencies**
(`model.dependencies`).

| Feature                | Phase      | Depends on                                                                                                            |
| ---------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `f-workspaces`         | foundation | `f-app-frame`                                                                                                         |
| `f-app-frame`          | foundation | —                                                                                                                     |
| `f-framework-store`    | foundation | —                                                                                                                     |
| `f-engine`             | foundation | `f-framework-store`                                                                                                   |
| `f-intake`             | assess     | —                                                                                                                     |
| `f-judges`             | assess     | `f-engine`, `f-workspaces`                                                                                            |
| `f-assessments`        | assess     | `f-judges`, `f-intake`                                                                                                |
| `f-projects`           | assess     | `f-assessments`, `f-app-frame`                                                                                        |
| `f-calibration`        | assess     | `f-assessments`                                                                                                       |
| `f-language`           | assess     | `f-projects`                                                                                                          |
| `f-report`             | report     | `f-assessments`, `f-app-frame`                                                                                        |
| `f-workbench`          | report     | `f-report`, `f-projects`                                                                                              |
| `f-sharing`            | report     | `f-report`                                                                                                            |
| `f-rewrite`            | report     | `f-report`, `f-language`                                                                                              |
| `f-compare`            | report     | `f-report`                                                                                                            |
| `f-editing`            | report     | `f-rewrite`, `f-compare`                                                                                              |
| `f-public-site`        | report     | `f-engine`, `f-app-frame`, `f-assessments`                                                                            |
| `f-developer-platform` | api        | `f-assessments`, `f-app-frame`                                                                                        |
| `f-usage`              | api        | `f-assessments`, `f-app-frame`                                                                                        |
| `f-mcp`                | api        | `f-assessments`, `f-compare`, `f-rewrite`                                                                             |
| `f-launch`             | launch     | `f-workbench`, `f-sharing`, `f-public-site`, `f-developer-platform`, `f-usage`, `f-mcp`, `f-calibration`, `f-editing` |
| `f-batch-webhooks`     | scale      | `f-developer-platform`                                                                                                |
| `f-audience-panel`     | scale      | `f-compare`                                                                                                           |

**Critical path:**
`f-framework-store → f-engine → f-judges → f-assessments → f-report → f-workbench → f-launch`.
`f-app-frame`, then `f-workspaces` (its switcher sits in the frame), and `f-intake` run
alongside the first three. The scale
phase is the "phase 2" of D12 and does not block launch.

### How to read a block

Each field is named for the Hub argument it becomes (§7):

- **A phase** has a key, a `name`, a `summary` and a `description`, and may have
  **milestones**, each with a name and demo lines (`flow.plan-demo`).
- **A feature** has a `slug`, a `title`, a `summary`, `dependsOn`, a `description` (the
  situation first, `fp8`), a `doneWhen` and `references`.
- **Indicative tasks** each have a ref, title, size, task dependencies, done-when and files
  in scope. They become `plan_feature`'s arguments when the feature is claimed, after the
  claimer reconciles them against the tree (`fp1`).

**What a done-when may contain.** Only what can be proved at merge (`fp3b`). The gates are
in every task's done-when (§5). Anything that needs a deployed build goes in the feature's
done-when.

---

### Phase `foundation` — Foundations

- **name:** Foundations
- **summary:** Workspaces at multi-tenancy, the app's frame and look, the model stored as
  versioned records, and the engine ported and proved against the prototype.
- **description:** The groundwork every later feature stands on, kept visible: someone can
  sign up into their own workspace, see the chosen design, read the model through the API,
  and watch the ported quick scan match the prototype case for case.
- **milestone `m-foundations` — Your own workspace, and the model inside it:**
  - Sign up and land in a workspace of your own, in the chosen design. (`f-workspaces`,
    `f-app-frame`)
  - Read model 0.5.1 through the API, record for record as delivered. (`f-framework-store`)
  - Run the ported quick scan over the 18 calibration cases and see it match the
    prototype. (`f-engine`)
  - _Stand-in:_ the signed-in home is a placeholder until `f-workbench`.

#### `f-workspaces` — Workspaces

- **summary:** Multi-tenancy on, a workspace of your own at signup, team workspaces with
  invitations, and every workspace able to call the AI from its first minute.
- **dependsOn:** `f-app-frame`
- **references:** D1 · plan §1 "Tenancy" · `.context/architecture/multi-tenancy.md` ·
  `.context/tenancy/identity.md`
- **description:**

  Today a person who signs up at `multi` becomes a member of the install org, the vendor's
  own, and any org created for them can call no AI provider. HowDoesThisLand is used alone
  and in teams (D1), so each person needs their own workspace from the start, able to run
  assessments immediately, and teams need workspaces they can invite colleagues into.

  This feature:
  - switches the development environment to `TENANCY_MODE=multi` with the role split, and
    documents it for every later contributor;
  - gives every uninvited signup a workspace of their own as `OWNER`, granted OpenAI and
    given the default monthly budget, and keeps them out of the install org;
  - lets a person create a team workspace, invite people (core's
    `POST /api/v1/orgs/[id]/invitations`) and switch between workspaces.

  **The anchor risk:** whether the user-created hook can make the signup land in its own
  workspace without racing the platform's own membership write. `w2` checks that first. If
  it cannot be made race-free, the right fix is a generic seam ("the org an uninvited
  signup joins"), carried under `B19` with a ledger row and an upstream issue.

- **doneWhen:**
  - On a deployed build, a new signup lands in their own workspace and can run an AI
    assessment with no admin step.
  - On a deployed build, a member of one workspace cannot open another workspace's
    project or assessment by id.
- **indicative tasks:**

| Ref | Title                                                     | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                               | Files in scope                                                                     |
| --- | --------------------------------------------------------- | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| w1  | Turn on multi-tenancy in the development environment      | M    | —          | A script creates the app role and enables the policies against the dev database. `.env.example` (fork section) and `.context/app/dev-environment.md` give the exact `DATABASE_URL`, `MIGRATE_DATABASE_URL` and `TENANCY_MODE` lines. `TENANCY_MODE=multi npm run db:drift-check` passes. The OpenAI provider row and `text-embedding-3-small` as the active embedding model are created by a documented step, and checked by the same script.           | `scripts/app/`, `.context/app/dev-environment.md`, `.env.example`                  |
| w2  | Give every new account a workspace of its own             | L    | w1         | An uninvited signup (password and OAuth) ends with exactly one membership, `OWNER` of a new workspace named for them, and none in the install org; an invited signup is unchanged. The new org is granted OpenAI and given the default monthly budget (D6) in the same flow. Unit tests on the hook; a smoke run against the dev database at `multi` covers both signup paths. If a seam was needed: ledger row, upstream issue filed, rest-state test. | `lib/app/user-created.ts`, `lib/app/workspaces/`, `tests/unit/lib/app/workspaces/` |
| w3  | Let people create team workspaces and switch between them | M    | w2, a2     | `POST /api/v1/workspaces` creates a workspace with the caller as `OWNER`, granted and budgeted as in `w2`, with a per-user cap on how many. A workspace switcher in the app frame uses `POST /api/v1/orgs/switch`. Invitations and members use core's routes, behind a settings page. Route and component tests.                                                                                                                                        | `app/api/v1/workspaces/`, `lib/app/workspaces/`, `components/app/workspaces/`      |

#### `f-app-frame` — App frame and look

- **summary:** The look chosen by eye from real pages, then the app's frame, brand, fonts,
  navigation and theme seams filled in it.
- **dependsOn:** —
- **references:** D15, D23 · plan §4 "Route map" · `.context/ui/surface-theming.md` ·
  `prototype/shell.html` · model `brand.visual`
- **description:**

  Sunrise's header, nav and landing still describe Sunrise, and two candidate type systems
  are on record (§1). The product has to look distinct, interesting and serious, and be
  easy to use for long sessions over dense reports (D15). The look is chosen by looking at
  real pages, not described up front.

  This feature:
  - builds two or three design directions with the `frontend-design` skill, each as the
    same three real screens (landing hero, a report section with an annotated passage, the
    workbench), for the owner to choose between;
  - then builds the chosen direction into the frame: brand seam, fonts through `next/font`,
    `brand-theme.css` light and dark, the public and signed-in layouts, navigation, the
    auth landing at `/home`, and the brand components (mark, appeal colours, and the Greek
    emblems if kept).

- **doneWhen:**
  - On a deployed build, the public and signed-in frames render in the chosen look, light
    and dark, and `/admin` stays unthemed.
- **indicative tasks:**

| Ref | Title                                                       | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Files in scope                                                                                                                                                                        |
| --- | ----------------------------------------------------------- | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a1  | Explore design directions and choose one                    | M    | —          | Two or three directions, each rendering the same three screens with real model content, on a throwaway route excluded from the build. The owner's choice and the reasons are recorded as a decision on this feature. Screenshots of each in the PR.                                                                                                                                                                                                                                                    | `app/(design-lab)/`, `components/app/design-lab/`                                                                                                                                     |
| a2  | Build the app frame and fill the brand, nav and theme seams | L    | a1         | The public and signed-in frames, in Sunrise's `(public)` and `(protected)` groups (D23), with header, footer (with Cookie Preferences) and workspace slot; any edit to their layouts carries a ledger row. `brand.ts`, `public-nav.ts`, `protected-nav.ts`, `footer.ts`, `auth-landing.ts` (`/home`) and `protected-routes.ts` filled, each `defaults.test.ts` row re-pinned. Fonts through `next/font`; `brand-theme.css` light and dark. The design lab is deleted. Component tests; checked by eye. | `app/(public)/`, `app/(protected)/`, `components/app/shell/`, `components/app/brand/`, `app/brand-theme.css`, `lib/app/brand.ts`, `lib/app/public-nav.ts`, `lib/app/protected-nav.ts` |

#### `f-framework-store` — Frameworks in the database

- **summary:** Frameworks stored as immutable, linked, versioned records, imported from
  reviewed JSON, readable through the API, and materialised back into the typed model the
  engine runs on.
- **dependsOn:** —
- **references:** D2, D3, D5 · plan §8.1 · `prototype/howdoesthisland_model.json`
- **description:**

  The model exists only as a 370 KB JSON file inside the artefact. The service needs it as
  data it can query, version and cite: every assessment must say which version it used,
  and a second framework must fit without a new set of tables (D2).

  This feature:
  - adds the generic framework tables (§8.1, §9): frameworks, versions, typed nodes and the
    links between them;
  - defines the HowDoesThisLand framework in code: its node kinds, each with a Zod schema,
    and the reference fields that become links;
  - imports a model JSON file as a draft version, refusing a file with a dangling
    reference, an unknown kind or a schema error, and publishes it, after which it cannot
    change;
  - materialises a version back into the typed model, and proves the round trip is exact;
  - serves frameworks and versions through the API.

- **doneWhen:**
  - On a deployed build, `GET /api/v1/frameworks/howdoesthisland/versions/0.5.1` returns
    the model, and its checksum matches the committed file.
- **indicative tasks:**

| Ref | Title                                         | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Files in scope                                                                                                 |
| --- | --------------------------------------------- | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| s1  | Store frameworks as versioned, linked records | L    | —          | The four framework models are in `app.prisma`, classified as shared config (no `orgId`), with the model steps (§5). `npm run frameworks:import <file>` imports a draft; `frameworks:publish` publishes. Import refuses (tested): a dangling reference, an unknown kind, a node failing its schema, a duplicate key, a version already published. Publishing makes nodes and links unwritable (tested). `materialise(versionId)` returns the typed model; a test proves `materialise(import(file))` deep-equals the file for 0.5.1. Re-importing the same file is a no-op. | `prisma/schema/app.prisma`, `lib/app/frameworks/`, `scripts/app/frameworks/`, `tests/unit/lib/app/frameworks/` |
| s2  | Serve frameworks and versions through the API | M    | s1         | The four `frameworks` routes in §4, public, cached per published version with an ETag (`lib/api/etag.ts`). Unknown slug, version or kind are 404 with a code. The culture kinds follow the culture switch (D11). Route tests.                                                                                                                                                                                                                                                                                                                                             | `app/api/v1/frameworks/`, `lib/app/frameworks/api/`                                                            |

#### `f-engine` — The assessment engine

- **summary:** The prototype's engine as typed modules behind a framework engine interface,
  proved against a baseline recorded from the prototype itself.
- **dependsOn:** `f-framework-store`
- **references:** D11, D19 · plan §2, §3 · BRIEF §5 · `prototype/src/engine.js`
- **description:**

  Everything that scores lives in one untyped file in the artefact, with three known bugs
  (BRIEF §5). Nothing would tell us if a port changed a score. The quick scan is also the
  free product (D7) and the fallback when a judge fails, so it must be exact.

  This feature:
  - records a baseline from the prototype's engine: quick scan and `assemble` output for
    the 18 calibration cases and a corpus of sample texts across content types, audiences
    and cultures;
  - transliterates the engine into typed modules (§3), reading the materialised model,
    behind a `FrameworkEngine` interface (§8.2) that a second framework would implement;
  - fixes the three bugs, each with a test that fails on the old behaviour;
  - adds the culture switch (D11).

  **Not a rewrite**: each module follows its prototype function, so a diff against it stays
  readable.

- **doneWhen:**
  - The ported engine matches the baseline on every case, except the listed differences
    the three fixes cause.
- **indicative tasks:**

| Ref | Title                                  | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Files in scope                                                                                                                                   |
| --- | -------------------------------------- | ---- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| e1  | Record the prototype engine's baseline | S    | —          | A script, run from a copy of `prototype/` outside the repo, writes fixtures for the 18 cases and a corpus of at least 40 text × context pairs. The fixtures and the script's checksum of the prototype are committed. A guard test fails if any file outside `prototype/` imports from it (proved by a deliberate import in the PR).                                                                                                                                                                  | `scripts/app/baseline/`, `tests/fixtures/app/engine-baseline/`, `tests/unit/lib/app/prototype-guard.test.ts`                                     |
| e2  | Port the engine as typed modules       | L    | e1         | The modules in §3 under `lib/app/frameworks/howdoesthisland/engine/`, implementing `FrameworkEngine`, no `any`. Output matches every fixture except a listed set of differences, each traced to a fix. Tests for each fix fail on the prototype's behaviour: `locate()` offsets after `İ`, `rewritePrompt` duty by highest weight (shared helper used by `f-rewrite`), and judge output validation (delegated to `j2`, noted). The culture switch hides culture inputs and outputs when off (tested). | `lib/app/frameworks/howdoesthisland/engine/`, `lib/app/frameworks/engine.ts`, `lib/app/env.ts`, `tests/unit/lib/app/frameworks/howdoesthisland/` |

---

### Phase `assess` — Assessing content

- **name:** Assessing content
- **summary:** Content in by text, file or URL; nine AI judges and an editor run as a
  durable job; projects whose context the judges read; and calibration that says how far
  to trust them.
- **description:** Everything an assessment needs, through the API. Results are read as JSON
  here; the report that presents them is the next phase.
- **milestone `m-judges` — Nine judges on your content:**
  - Send a landing page by URL to the API and get a full assessment back, scored by nine
    judges, with the editor's summary. (`f-assessments`, `f-intake`)
  - Upload a pitch deck as PowerPoint and have it assessed. (`f-intake`)
  - Create a project, add your positioning document, and see a judge cite it. (`f-projects`)
  - Open the calibration page and see how the judges agree with the expected results.
    (`f-calibration`)
  - Set your default to US English, set one project to UK English, and see each
    assessment record and respect the one it ran with. (`f-language`)
  - _Stand-in:_ results are JSON until `f-report`.

#### `f-intake` — Content intake

- **summary:** Text from pasted content, uploaded files (PDF, DOCX, PPTX, HTML, Markdown,
  TXT) and web pages fetched safely.
- **dependsOn:** —
- **references:** D14 · plan §1 "Knowledge, files and fetching"
- **description:**

  The artefact read files in the browser and could not fetch URLs. The API takes a file or a
  URL (`source.file_base64`, `source.url` in the draft), so the server must turn both into
  text. Core parses most formats but not PowerPoint, and its URL fetcher refuses many
  ordinary pages by their extension and does no connect-time address check outside
  customer orgs.

  This feature:
  - wraps `parseDocument()` and adds a PPTX extractor (slide text and notes, in order), with
    limits on size and pages, and clear errors for scanned PDFs and unsupported types;
  - adds a page fetcher for user URLs: the safe-URL check on every hop, the outbound
    dispatcher on every request, a streaming size cap, type decided by the response, and
    the main content extracted from HTML (navigation and footers dropped).

- **doneWhen:**
  - On a deployed build, a public page fetched by URL is assessed, and a URL that resolves
    to a private address is refused.
- **indicative tasks:**

| Ref | Title                                  | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                       | Files in scope                                                                |
| --- | -------------------------------------- | ---- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| i1  | Turn uploaded files into text          | M    | —          | `extractText(buffer, fileName)` returns text plus word count, title and warnings for the six formats, with fixture tests for each. PPTX uses a small focused dependency, added to `package.json` with a reason in the PR. Size and page limits; scanned or empty PDFs return a specific error code.                                                                                                                                             | `lib/app/intake/`, `tests/unit/lib/app/intake/`, `tests/fixtures/app/intake/` |
| i2  | Fetch a web page safely for assessment | M    | i1         | `fetchPage(url)`: http(s) only, safe-URL check and dispatcher on every hop (redirects followed by hand, at most 5), streaming cap, 15-second total timeout, type from the response. HTML reduced to its main content. Tests for each refusal (private IP literal, private hostname by mocked DNS, redirect into a private range, oversize stream, non-text type) and a real-page fixture. Redirect policy set (the outbound-fetch test passes). | `lib/app/intake/fetch-page.ts`, `tests/unit/lib/app/intake/`                  |

#### `f-judges` — The AI judges

- **summary:** Nine judges and an editor as platform agents in every workspace, prompted
  from the framework version, replying in strict JSON that is validated before use.
- **dependsOn:** `f-engine`, `f-workspaces`
- **references:** D8, D17 · plan §8.3 · `prototype/src/engine.js` `judgePrompt`
- **description:**

  In the artefact the judges were nine browser calls through `claude.use("sample")`, checked
  only for an array. Here each judge is an agent each workspace owns an instance of, so a
  workspace can tune its provider, model and budget, while what the judge asks comes from
  the framework version, so it is versioned with the model (D17).

  This feature:
  - defines the judge agents (one per judge slot in the framework definition) and the
    editor agent, defaulting to OpenAI;
  - ports `judgePrompt` for all three judge shapes (appeal, extra group, influence), fed by
    the materialised model, the context and (later) the project's context block;
  - generates a strict JSON schema per judge from its Zod schema, with dimension, move,
    flag, perspective and lever ids as enums;
  - runs one judge: provider from the agent's binding, `runStructuredCompletion` with limits
    set per judge, cost logged with the assessment and judge in its metadata, and the reply
    post-validated (§5).

- **doneWhen:**
  - On a deployed build, a new workspace has the ten agents, and a judge run against real
    OpenAI returns a valid reply.
- **indicative tasks:**

| Ref | Title                                               | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Files in scope                                                                                                              |
| --- | --------------------------------------------------- | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| j1  | Define the judges and the editor as platform agents | M    | —          | `lib/app/platform-agents.ts` registers one agent per judge slot plus the editor, derived from the framework definition, `audience: 'every-org'`, defaulting to the OpenAI provider and the models of D8. The reconcile creates them in a new org and is a no-op on re-run (tested). Their `defaults.test.ts` row is re-pinned. Their instructions frame content as untrusted data.                                                                                                                                                                                                                                                                                                                                                                                                   | `lib/app/platform-agents.ts`, `lib/app/judges/agents.ts`                                                                    |
| j2  | Run a judge and validate its reply                  | L    | j1         | `runJudge(judge, input)` builds the prompt from the version (fixture tests against the prototype's prompts for the same inputs, differing only where listed), first applies the agent's own limits as chat does (`withAgentBudgetLock(agent.id, () => checkBudget(agent.id))`, refusing when over, and a per-agent limiter on `rateLimitRpm`; both tested, because the direct call bypasses them), calls the provider from the org's agent binding with a strict schema, logs cost with `{ assessmentId, judge }`, and returns a validated output plus a record of what post-validation dropped. Unit tests cover malformed JSON, unknown ids, out-of-range scores, unlocatable quotes, truncation and a provider refusal. `npm run smoke:judge` runs one judge against real OpenAI. | `lib/app/judges/`, `lib/app/frameworks/howdoesthisland/judges/`, `scripts/app/smoke-judge.ts`, `tests/unit/lib/app/judges/` |

#### `f-assessments` — Assessments

- **summary:** An assessment as a durable job that runs the quick scan, the chosen judges and
  the editor, offered through the API with profiles, live progress, synchronous waits and
  retention.
- **dependsOn:** `f-judges`, `f-intake`
- **references:** D7, D10, D12, D16 · plan §4 "API map", §8.2
- **description:**

  Nothing yet ties intake, engine and judges into one result that survives a crash, reports
  progress, and can be fetched later. API callers have different needs: a quick synchronous
  check in a pipeline, a full assessment fetched later, or a run where nothing is kept.

  This feature:
  - stores content, assessments and judge runs, and runs an assessment as a job: quick scan
    first, then the judges in parallel under a per-workspace concurrency limit, each
    checkpointed; a failed judge falls back to the quick scan for its dimensions and marks
    the result partial, as the artefact did, but says so;
  - recovers stalled jobs with an app job on the maintenance tick;
  - offers the routes of §4: profiles, `wait`, `store: false`, SSE progress, cancel and
    delete, the anonymous quick scan, scopes and rate limits;
  - adds the route registry every app route declares itself in;
  - adds the editor's summary to full assessments;
  - purges content past the workspace's retention window.

- **doneWhen:**
  - On a deployed build, an API key runs a full assessment to completion asynchronously and
    synchronously, and a run killed mid-way is completed by the recovery job.
- **indicative tasks:**

| Ref | Title                                               | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Files in scope                                                                                                      |
| --- | --------------------------------------------------- | ---- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| p1  | Run an assessment as a durable job                  | L    | —          | Content, Assessment and JudgeRun models (§9) with the model steps (§5). The state machine of §8.2, with a lease; judges run under a per-workspace limit; each judge's result is stored as it lands; a failure falls back and marks the result partial with the reason; cancel stops further calls. `assemble()` gives the stored result. A per-org app job re-drives stalled jobs, at most three attempts, idempotent (tested by running it twice). `noteMaintenanceWork()` is called on enqueue. A smoke run at `multi` completes an assessment and proves another workspace cannot read it. Budget a review-fix commit.                                                                                                                                                                                                                                                                                                                                                                                                                | `prisma/schema/app.prisma`, `lib/app/assessments/`, `lib/app/jobs.ts`, `tests/unit/lib/app/assessments/`            |
| p2  | Offer assessments through the API                   | L    | p1         | The `scan` and `assessments` routes of §4, each declared in the route registry (`lib/app/api/registry.ts`) with Zod request and response schemas. Profiles resolve to judges from the version's catalogue. `wait=true` returns the result or 202 after a bound; `store=false` is synchronous only and keeps no text (tested). SSE events use `assessment_progress`-style names and are derived by polling the stored rows, so a stream sees every judge even when the run is driven outside its request (tested). Scopes `assess`, `projects`, `reports` declared. `POST scan` is anonymous with an IP rule and enters the install org. A per-user sub-cap on full assessments. Route tests for every error code.                                                                                                                                                                                                                                                                                                                        | `app/api/v1/assessments/`, `app/api/v1/scan/`, `lib/app/api/`, `lib/app/api-key-scopes.ts`, `lib/app/rate-limit.ts` |
| p3  | Add the editor's summary to full assessments        | M    | p1         | After the judges, the editor agent writes a validated summary: a verdict in two or three sentences, the three changes that matter most (each tied to a recommendation id), and what already works. Skipped for `quick` and single-judge runs. Its failure leaves the assessment complete without a summary, marked. Fixture tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `lib/app/assessments/editor.ts`, `lib/app/frameworks/howdoesthisland/judges/editor.ts`                              |
| p4  | Purge content past the workspace's retention window | M    | p1         | A workspace setting (`Org.settings.app.retention`, via `PATCH /api/v1/workspaces/{id}/settings`, owner/admin only) sets a window or none (D10). It covers content and assessments, which core's per-org `retention` slice and sweep (`lib/tenancy/org-settings.ts`, `.context/orchestration/retention.md` §Per-org windows) do not cover; core's slice keeps governing core's own history, and the settings page says which window is which. The write touches only the `app` key, using the same serializable read-modify-write as core's unexported `writeSettingsSlice`, and a test proves `retention`, `quotas`, `providers` and `platformAgents` survive it. A per-org app job deletes content text and its assessments older than the window, and judge runs' raw replies after 30 days in any case. Purging an assessment removes its shares and rewrites (FK cascade), and a comparison or batch that loses a member shows it as purged rather than failing (tested). Idempotent; tested against a population that is not empty. | `lib/app/retention/`, `lib/app/jobs.ts`, `app/api/v1/workspaces/`                                                   |

#### `f-projects` — Projects and their context

- **summary:** Projects that hold a workspace's background, a brief, defaults, weight
  adjustments and context documents, which the judges read when assessing.
- **dependsOn:** `f-assessments`, `f-app-frame`
- **references:** D4, D5, D18, D21 · plan §8.4
- **description:**

  A judge scoring a draft without knowing the author's offer, audience, voice or market
  gives generic advice. Users keep projects for each client, product or campaign, with
  documents that explain the work, and expect the judges to use them.

  This feature:
  - adds projects with a structured brief (what you offer, to whom, your voice, your
    markets, goals) and defaults (content type, audience, culture, profile);
  - lets a project adjust the framework's weights within bounds (D5), recorded on every
    assessment that used them;
  - adds context documents to a project through Sunrise's knowledge base (D18);
  - gives the judges a bounded project context block: the brief, plus passages retrieved
    from the project's documents for this content, recorded on the assessment so the
    report can show what was used.

- **doneWhen:**
  - On a deployed build, an assessment in a project with a document cites a passage from it,
    and the report lists the document as context used.
- **indicative tasks:**

| Ref | Title                                     | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Files in scope                                                                                                                   |
| --- | ----------------------------------------- | ---- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| c1  | Create projects with a brief and defaults | M    | —          | Project model with the model steps (§5); CRUD routes in the registry; overlay validated against the version (unknown ids and out-of-bounds deltas refused); assessments take `project_id` and apply defaults and overlay. Projects list and project page with the brief form (`<FieldHelp>` on every field). Route and component tests.                                                                                                                                                                                                                                                                                | `prisma/schema/app.prisma`, `lib/app/projects/`, `app/api/v1/projects/`, `components/app/projects/`, `app/(protected)/projects/` |
| c2  | Add context documents to a project        | M    | c1         | Upload (the `f-intake` formats) and URL; text goes into the org's knowledge base through `uploadDocument`, linked by a ProjectDocument row. Removing a link deletes the document from the base only if this app's upload created it (the link records whether `uploadDocument` made a new row or reused one by content hash), no project link remains, and no agent is granted it; otherwise only the link goes (tested for a document shared by two projects and for one first uploaded through core's knowledge page). Status shown while embedding. Delete and list routes. Org export and erasure cover the links. | `lib/app/projects/documents.ts`, `app/api/v1/projects/`, `components/app/projects/`                                              |
| c3  | Give the judges a project's context       | M    | c2         | `buildProjectContext(project, content)` returns the brief plus at most N retrieved passages (queries from the content's sections, deduplicated), under a token budget. Judges receive it framed as background, not instructions. The assessment records the documents used (title as well as id) and the passages. Tests prove retrieval is limited to the project's documents.                                                                                                                                                                                                                                        | `lib/app/projects/context.ts`, `lib/app/judges/`                                                                                 |

#### `f-calibration` — Calibration

- **summary:** The calibration set brought up to model 0.5.1, a runner for the quick scan
  and the AI judges, a publish gate, and the judge models chosen by measurement.
- **dependsOn:** `f-assessments`
- **references:** D8, D9 · `prototype/howdoesthisland_eval_set.json`
- **description:**

  The artefact's calibration ran only the quick scan, against a set two versions behind the
  model, with nothing for the craft, audience or culture judges. Before anyone relies on a
  score, we need to know how often the judges agree with the expected results, and to know
  when a change of model, prompt or framework version makes that worse.

  This feature:
  - extends the set to cover all nine judges (D9);
  - runs it against the quick scan and the AI pipeline, storing each run with its framework
    version, judge models and cost, and comparing it with the previous run;
  - requires a recorded AI run before a framework version can be published;
  - measures candidate models and sets the defaults (D8).

- **doneWhen:**
  - On a deployed build, the admin calibration page shows a run of the 0.5.1 set against the
    production judge models.
- **indicative tasks:**

| Ref | Title                                                 | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Files in scope                                                                                              |
| --- | ----------------------------------------------------- | ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| k1  | Bring the calibration set up to model 0.5.1           | M    | —          | `eval-0.5.1.json` adds expectations for craft, audience and culture (group bands and key dimensions) to the 18 cases and adds cases until each judge has at least six, with a Zod schema the runner reads. The changes from 0.4.0 are listed in its `meta`. Reviewed in the PR (D9).                                                                                                                                                                                                                           | `lib/app/frameworks/howdoesthisland/data/`, `lib/app/calibration/schema.ts`                                 |
| k2  | Run calibration against the quick scan and the judges | L    | k1         | CalibrationRun model (install-org owned) with the model steps. `npm run calibrate -- --mode quick\|ai` and an admin page at `/admin/frameworks` run the set, show agreement per appeal, flag and duty, and the change from the last run. Calibration runs against a draft version; publishing a draft without an AI run of that draft is refused (tested). 0.5.1, published in `s1` before the gate existed, gets its AI run recorded here. The quick mode matches the prototype's calibration on 0.4.0 cases. | `lib/app/calibration/`, `app/admin/frameworks/`, `app/api/v1/admin/frameworks/`, `scripts/app/calibrate.ts` |
| k3  | Choose the judge and editor models by measurement     | M    | k2         | AI runs for at least three candidate OpenAI models, compared on agreement, cost per assessment and time to complete, written to `.context/app/judge-models.md`. The platform-agent defaults are set to the choice, recorded as a decision. Newer model ids, if needed, are added to the provider-models matrix by the documented admin step.                                                                                                                                                                   | `.context/app/judge-models.md`, `lib/app/judges/agents.ts`                                                  |

#### `f-language` — UK or US English

- **summary:** A personal default of UK or US English, overridden by a project and by a
  single piece of copy, which the judges, rewrites and revisions all write and check in.
- **dependsOn:** `f-projects`
- **references:** D26 · `prototype/src/engine.js` (judge and rewrite prompts: "the same
  language and spelling conventions as the content") · model `meta.language` (`en-GB`)
- **description:**

  A copywriter in London writing for a client in Chicago needs US spelling in that client's
  work and UK spelling everywhere else. The artefact guessed the convention from the copy
  itself, which fails on short copy, on copy that mixes the two, and on a draft being
  converted from one to the other. A review that marks "colour" as a slip, or a revision
  that hands back "organise" to a US client, costs the tool its credibility with exactly
  the people it is for.

  This feature:
  - adds a personal default (UK or US English), set on the person's profile page and asked
    once on first use;
  - lets a project override it, and a single piece of copy override the project, in the
    workbench and in the API (`language` on `POST assessments`);
  - resolves the variant in one place (`resolveLanguage`: the piece, then the project, then
    the person's default, then UK English, the model's own language) and records it on the
    assessment, so every rewrite and revision from it inherits it;
  - gives it to the judges, the editor, rewrites and revisions as a run setting, not by
    editing the framework version's prompts;
  - adds a house-style check beside the quick scan: spellings from the other variant, and
    for UK English, -ise and -ize mixed in one piece (both are correct UK English; mixing
    them is not).

  The variant is the copy's spelling, not the interface's language: the app's own words
  stay as they are. Values are stored as BCP 47 tags (`en-GB`, `en-US`) so more variants
  (Australian, Canadian) can follow without a migration; the interface says "UK English"
  and "US English" (§4).

- **doneWhen:**
  - On a deployed build, a person whose default is US English assesses a piece in a UK
    English project, and the report, a rewrite and a revision all use UK spelling and say
    so.
- **indicative tasks:**

| Ref | Title                                    | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Files in scope                                                                                                                                                                           |
| --- | ---------------------------------------- | ---- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lg1 | Choose UK or US English, and override it | M    | —          | `UserPreference` model (per person, not per workspace: `userId` cascade, classified as personal data and registered in the subject export) with `language`; `GET`/`PATCH /api/v1/preferences` for the session's own person. `Project.language` (nullable: inherit) on the project routes and form; `language` accepted on `POST assessments`. `resolveLanguage()` applies the order of D26 and the assessment records the result in its context. Profile-page section through `account-sections.ts` (row re-pinned); project form and workbench control with `<FieldHelp>`; the report's cover shows it. Route, resolver and component tests, including a key-authenticated call resolving to the key owner's default. | `prisma/schema/app.prisma`, `lib/app/language/`, `app/api/v1/preferences/`, `app/api/v1/projects/`, `app/api/v1/assessments/`, `components/app/settings/`, `lib/app/account-sections.ts` |
| lg2 | Write and check in the chosen English    | M    | lg1        | The judges' and editor's run context carries the variant in place of the artefact's "same conventions as the content" line; the framework version's stored prompts are unchanged, and any difference from the recorded engine baseline is listed (D19). A house-style check, run beside the quick scan and outside the ported engine, reports other-variant spellings and, for UK English, mixed -ise/-ize, from a curated list of paired spellings whose source and licence are recorded. Tests with UK, US and mixed fixtures, and short copy that a guess would get wrong.                                                                                                                                          | `lib/app/language/`, `lib/app/judges/`, `lib/app/assessments/`                                                                                                                           |

---

### Phase `report` — The report and the web app

- **name:** The report and the web app
- **summary:** The report as the product's flagship, the workbench people assess in, PDF
  and share links, rewrites, comparisons, and the public site with the free scan.
- **description:** Everything a person sees. The report is designed first because every
  other surface borrows from it.
- **milestone `m-report` — A report worth sending:**
  - Assess a draft in the browser and watch the judges finish one by one. (`f-workbench`)
  - Read the report, download it as a PDF, and send a link a client can open.
    (`f-report`, `f-sharing`)
  - Rewrite the weakest appeal, then compare the rewrite with the original.
    (`f-rewrite`, `f-compare`)
  - Select a weak paragraph, ask for a revision with your own direction, accept it, edit a
    line by hand, then re-assess draft 2 against draft 1. (`f-editing`)
  - Try the free quick scan on the landing page without an account. (`f-public-site`)

#### `f-report` — The report

- **summary:** The assessment presented as a professional report: verdict, scores,
  annotated text, recommendations with rewrites, flags, method and limitations.
- **dependsOn:** `f-assessments`, `f-app-frame`
- **references:** D13 · plan §8.5 · `prototype/src/App.jsx` (`Workspace`, `ScoreHero`,
  `VennScore`, tabs)
- **description:**

  The report is what people pay attention to and pass on, so it decides whether this reads
  as a serious tool. The artefact's results view was a working surface with tabs; a client
  needs a document that reads top to bottom, holds up in print, and says how it was made.

  This feature builds the report page (§8.5) from the stored result, reading only from the
  API, with a print stylesheet that `f-sharing` renders, and the charts it needs (built
  with the `dataviz` skill).

- **doneWhen:**
  - On a deployed build, a full assessment's report renders every section, and its print
    preview paginates cleanly.
- **indicative tasks:**

| Ref | Title                    | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                          | Files in scope                                           |
| --- | ------------------------ | ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| r1  | Build the report page    | L    | —          | `/assessments/[id]` renders the sections of §8.5 for full, partial, single-judge and quick results, each tested. Highlights are marked in the text and linked to their dimension and recommendation. Sections absent from a result are omitted, not empty. Print stylesheet. Checked by eye against three real assessments, screenshots in the PR. | `app/(protected)/assessments/`, `components/app/report/` |
| r2  | Draw the report's charts | M    | r1         | Appeal scores, balance against the target mix, duty profile, perspective scores and culture scales, as accessible SVG with values available as text, readable in light, dark and print. Component tests.                                                                                                                                           | `components/app/report/charts/`                          |

#### `f-workbench` — The assess workbench

- **summary:** Where people assess: paste, drop a file or give a URL, set the reader and the
  judges, watch the judges finish, and find past work.
- **dependsOn:** `f-report`, `f-projects`
- **references:** plan §4 "Route map" · `prototype/src/App.jsx` (`AssessView`, `EditorCard`,
  `ReaderCard`, `JudgePicker`)
- **description:**

  Signed-in people have nowhere to work yet. The artefact's assess page was good at setting
  the reader (content type, audience, culture) and choosing judges; the app adds projects,
  live progress from the server and a history that persists.

- **doneWhen:**
  - On a deployed build, an assessment started in the browser streams its progress and opens
    as a report.
- **indicative tasks:**

| Ref | Title                                    | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                        | Files in scope                                                                |
| --- | ---------------------------------------- | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| b1  | Build the assess page with live progress | L    | —          | `/assess`: text, file and URL inputs; project picker that applies defaults; reader settings and profile or judge picker with `<FieldHelp>`; the quick scan shown at once, then each judge as it lands (SSE), then the report. Draft kept in the browser. Errors from intake and budget shown beside the action. Component tests; checked by eye. | `app/(protected)/assess/`, `components/app/workbench/`                        |
| b2  | Show history and a home page             | M    | b1         | `/home` and project pages list recent assessments from one enriched list endpoint (no per-row fetches), with filters by project, content type and band. Delete with confirmation.                                                                                                                                                                | `app/(protected)/home/`, `components/app/history/`, `app/api/v1/assessments/` |

#### `f-sharing` — PDF and share links

- **summary:** The report as a PDF that matches the web report, and share links that can
  expire and be revoked.
- **dependsOn:** `f-report`
- **references:** D13 · plan §8.5
- **description:**

  Reports are sent to clients and colleagues who have no account. Sunrise has no PDF
  renderer and no share links. The PDF must look like the web report, not a second design.

  This feature renders the report's print view to PDF with headless Chromium, behind a
  short-lived render token, caching the file in the workspace's private storage, and adds
  share links stored hashed with an expiry, revocable, opening a read-only report.

- **doneWhen:**
  - On a deployed build, a PDF downloads for a full assessment, and a share link opens in a
    signed-out browser and stops working once revoked.
- **indicative tasks:**

| Ref | Title                      | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Files in scope                                                                                                                 |
| --- | -------------------------- | ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| x1  | Render the report as a PDF | L    | —          | Starts with a spike against the deploy target (open question 1): image size and render time measured, recorded in the PR. `GET /api/v1/assessments/{id}/report.pdf` renders the print route with a signed token of a new `typ`, bound to the assessment and its org with a short expiry. The print request has no session or key, so it enters that org through a named tenant entry, tested at `multi`. This is the same `TenantContextSource` question as `x2`, settled once by whichever lands first: an existing source if one fits, otherwise a ledger row and an upstream issue. The route caches under `orgs/{orgId}/reports/` (private), and reuses the cache while the assessment is unchanged. A sample PDF in the PR. | `lib/app/reports/pdf/`, `app/api/v1/assessments/`, `app/(print)/`, `Dockerfile` (ledger row if changed)                        |
| x2  | Share a report by link     | M    | —          | ReportShare model with the model steps; 32-byte token stored as a hash; expiry (default 30 days) and revoke; `/r/[token]` and `GET shared-reports/{token}` enter the share's org through a tenant entry that names it (`TenantContextSource` is a closed union in core `lib/tenancy/context.ts`: an existing source if one fits, otherwise a ledger row and an upstream issue for the new one); the shared view omits workspace and author details. Tests for expired, revoked and wrong tokens; rate limit on the public route.                                                                                                                                                                                                 | `prisma/schema/app.prisma`, `lib/app/reports/shares.ts`, `app/(public)/r/`, `app/api/v1/shares/`, `app/api/v1/shared-reports/` |

#### `f-rewrite` — Rewrites

- **summary:** A draft rewritten from its assessment, streamed, with placeholders for facts
  the author must supply, and re-assessed in one step.
- **dependsOn:** `f-report`, `f-language`
- **references:** BRIEF §3, §5 · `prototype/src/engine.js` `rewritePrompt`
- **description:**

  An assessment says what to change; most people then want a draft that does it. The
  artefact streamed one with a focus on an appeal. The app keeps the rewrite, lets it be
  assessed and compared with the original, and fixes the duty rule.

- **doneWhen:**
  - On a deployed build, a rewrite streams into the report's drawer and its re-assessment
    opens as a comparison.
- **indicative tasks:**

| Ref | Title                               | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                                                                 | Files in scope                                                                          |
| --- | ----------------------------------- | ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| rw1 | Stream a rewrite from an assessment | M    | —          | Rewrite model with the model steps. `POST /api/v1/rewrites` with `focus` and `stream`, through the editor agent, cost logged, written in the assessment's English variant (D26). The ported prompt uses the highest-weighted duty (test fails on the `=== 40` rule). The drawer streams, offers copy, and "Assess this draft" starts a comparison once `f-compare` exists (until then, a new assessment). | `lib/app/rewrites/`, `app/api/v1/rewrites/`, `components/app/report/rewrite-drawer.tsx` |

#### `f-compare` — Comparing drafts

- **summary:** Two to five drafts assessed in the same context, with the differences per
  appeal and the editor's verdict on which lands better and why.
- **dependsOn:** `f-report`
- **references:** D12
- **description:**

  Choosing between drafts (subject lines, headlines, two versions of a proposal) is one of
  the most common questions, and answering it by opening reports side by side is slow.

- **doneWhen:**
  - On a deployed build, a comparison of three drafts completes and its view shows the
    winner per appeal.
- **indicative tasks:**

| Ref | Title          | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                              | Files in scope                                                                                                                       |
| --- | -------------- | ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| cm1 | Compare drafts | L    | —          | AssessmentSet model (kind `comparison`) with the model steps. `POST /api/v1/comparisons` runs each draft with the same context and judges, then the editor's validated verdict; `GET` returns the set with per-appeal deltas. `/compare/[id]` shows them side by side with the verdict. Partial and failed members handled and tested. | `prisma/schema/app.prisma`, `lib/app/comparisons/`, `app/api/v1/comparisons/`, `app/(protected)/compare/`, `components/app/compare/` |

#### `f-editing` — Editing the draft

- **summary:** The copy edited in place in the writer's own words, any passage revised by
  the AI to the writer's direction and the model, every change shown as tracked changes,
  and each saved round a numbered draft that can be re-assessed.
- **dependsOn:** `f-rewrite`, `f-compare`
- **references:** D24, D25, D26, D27 · plan §8.6 · §4 "The words we use"
- **description:**

  A review says what to change, and `f-rewrite` hands back a whole new draft. Writers rarely
  work that way: they keep most of what they wrote, fix a line here and rework a paragraph
  there, and want to stay the author. Today the only way to act on a note is to copy the
  copy out, edit it elsewhere and paste it back as a new assessment, losing the link between
  drafts.

  This feature:
  - makes each piece of copy a series of numbered drafts: saving the writer's changes
    creates the next draft, and earlier drafts, with the assessments that point at them,
    never change (D25);
  - adds a draft editor where the writer edits the copy in place, with the latest review's
    notes in the margin, carried over where their passage is unchanged and marked as
    changed since the review where it is not;
  - lets the writer select a passage and ask for a revision of just that passage, with
    their own direction ("warmer", "cut to 20 words", "lead with the saving") and a focus
    (the notes on that passage, an appeal, or the model as a whole), and get one to three
    suggestions, each saying which of the model's moves it used (D24);
  - shows suggestions and edits as tracked changes the writer accepts or rejects, and shows
    the changes between any two drafts;
  - re-assesses a new draft as a comparison with the draft last reviewed, so the writer sees
    what the round of changes did.

  Everything is in the copy's English variant (D26) and is reachable through the API first
  (`drafts`, `revisions`).

- **doneWhen:**
  - On a deployed build, a writer selects a paragraph in a reviewed draft, asks for a
    revision with a direction, accepts one suggestion, edits another line by hand, saves
    draft 2, and re-assesses it as a comparison with draft 1.
- **indicative tasks:**

| Ref | Title                           | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Files in scope                                                                               |
| --- | ------------------------------- | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ed1 | Save edits as numbered drafts   | M    | —          | `Content` gains `parentContentId?` (set null), `rootContentId` and `draftNumber`, and `changeSource` (`writer`, `revision`, `rewrite`). `GET /api/v1/drafts/{id}` returns the piece's drafts in order, each with its latest assessment, from one query. `POST /api/v1/drafts/{id}/versions` takes the new text, `baseDraftNumber` and the accepted revision ids; it refuses with 409 when the base is not the latest draft, applies intake's size limits, and records word count. A rewrite's "Assess this draft" also saves it as the next draft. `diffDrafts(a, b)` gives word-level changes. Retention purge (`p4`) leaves later drafts intact. Route and unit tests, including two writers saving from the same base.                                                                                                                                     | `prisma/schema/app.prisma`, `lib/app/drafts/`, `app/api/v1/drafts/`, `lib/app/rewrites/`     |
| ed2 | Build the draft editor          | L    | ed1        | `/drafts/[id]`: the latest draft editable in place, with a live word count; the latest review's notes in the margin, carried over by locating their quote, and the rest listed as changed since the review; unsaved edits kept in the browser with a warning on leaving; "Save as draft N"; show changes between any two drafts as tracked changes; "Re-assess" starts a comparison of the new draft with the one last reviewed, in the same context. The report gains "Edit this draft". Keyboard-only use works throughout. Component tests; checked by eye, screenshots in the PR.                                                                                                                                                                                                                                                                         | `app/(protected)/drafts/`, `components/app/editor/`, `components/app/report/`                |
| ed3 | Revise a selected passage (API) | M    | ed1        | `Revision` model with the model steps. `POST /api/v1/revisions` takes the working text, a selection (offsets plus the selected text, checked against each other), a direction (at most 500 characters), a focus and 1–3 options; the editor agent sees the selection, the paragraphs around it as read-only context, the brief, the notes that overlap it, the model's moves for the focus and the English variant, with the copy framed as data and the direction as the writer's. Replies are strict JSON, validated: move ids unknown to the version dropped, empty or overlong suggestions refused, placeholders kept. Cost logged against the workspace's budget; a per-flow sub-cap on the route. `accept` and `reject` record the writer's choice (accepting one rejects its siblings). Tests, including copy that tries to change the reply's format. | `prisma/schema/app.prisma`, `lib/app/revisions/`, `app/api/v1/revisions/`, `lib/app/judges/` |
| ed4 | Revise from the editor          | M    | ed2, ed3   | Selecting text in the editor offers "Revise" and "Check this passage" (the free quick scan and house-style check on the selection alone). "Revise" opens a direction field with example directions, the focus (the notes on the passage ticked by default, an appeal, or the model as a whole) and the number of options, each with `<FieldHelp>`. Suggestions appear in place as tracked changes with their reasons and moves; accept and reject work by keyboard; accepted changes join the working copy and are saved with the next draft. A note in the margin offers "Revise this passage", selecting its quote. Component tests; checked by eye.                                                                                                                                                                                                        | `components/app/editor/`                                                                     |

#### `f-public-site` — Public site and free scan

- **summary:** The landing page with its copy scored live, the free quick scan for anyone,
  the model as browsable pages, and the lineage of the idea.
- **dependsOn:** `f-engine`, `f-app-frame`, `f-assessments`
- **references:** D7, D11 · `prototype/src/App.jsx` (`HomeView`, `ModelView`, `AboutView`)
- **description:**

  The site still says Sunrise. The artefact's home page made its case by scoring its own
  copy, and its model pages showed the depth behind the scores. Anyone can run the quick
  scan without an account (D7); the AI judges need one.

- **doneWhen:**
  - On a deployed build, a signed-out visitor runs the quick scan from the landing page, and
    every model page renders from the API.
- **indicative tasks:**

| Ref  | Title                                          | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                                    | Files in scope                                                             |
| ---- | ---------------------------------------------- | ---- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| pub1 | Build the landing page and the free quick scan | L    | —          | `/` (thin shim per CUSTOMIZATION.md, ledger row if it edits a platform file) with copy scored live by the ported quick scan, and `/scan`, calling `POST /api/v1/scan`. A clear path to sign up for the AI judges. Metadata and Open Graph image. Checked by eye.                                                                                                             | `components/app/marketing/`, `app/(public)/scan/`, `app/(public)/page.tsx` |
| pub2 | Publish the model as browsable pages           | L    | —          | `/model` and its sections (appeals, dimensions, lenses, moves, red flags, perspectives, duties, content types, research, limitations, culture when switched on) and `/about` (the platform's `app/(public)/about/page.tsx` reduced to a shim, with a ledger row), as server components reading the API, linked to each other by id. Static generation per published version. | `app/(public)/model/`, `app/(public)/about/`, `components/app/model/`      |

---

### Phase `api` — The API as a product

- **name:** The API as a product
- **summary:** Self-service API keys, a generated OpenAPI reference with guides and recipes,
  MCP tools, and usage that each workspace can see and is held to.
- **description:** What makes HowDoesThisLand usable from other software and other AI tools,
  and what keeps cost in hand without billing (D6).
- **milestone `m-api` — Built into other tools:**
  - Create an API key with scopes and follow a recipe in the docs to assess from a script.
    (`f-developer-platform`)
  - Ask an AI assistant, through MCP, to check a draft and get the summary back. (`f-mcp`)
  - See this month's assessments and spend against the workspace's limit. (`f-usage`)

#### `f-developer-platform` — API keys and developer docs

- **summary:** API keys people create themselves with scopes, and developer docs whose
  reference is generated from the same contracts the routes validate with.
- **dependsOn:** `f-assessments`, `f-app-frame`
- **references:** D20 · plan §4 "API map" · `.context/orchestration/api-keys.md`
- **description:**

  Sunrise mints API keys through session-only routes and ships no page for them, and has no
  OpenAPI document. An API sold as a product needs both: keys a developer creates and
  revokes, and a reference that cannot drift from the code (D20).

- **doneWhen:**
  - On a deployed build, a key created on the settings page calls `POST /api/v1/assessments`
    successfully, and `/developers` shows the reference for every app route.
- **indicative tasks:**

| Ref | Title                                                | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                        | Files in scope                                                                                                 |
| --- | ---------------------------------------------------- | ---- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| dp1 | Let people create and revoke API keys                | M    | —          | `/settings/api-keys` lists, creates (name, scopes from the app's list, expiry) and revokes keys through core's routes, shows a key once, and says which workspace it acts in. Fills `account-sections.ts` (row re-pinned). Component tests.                                                                      | `components/app/settings/api-keys/`, `lib/app/account-sections.ts`                                             |
| dp2 | Publish the OpenAPI reference and the developer docs | L    | —          | `GET /api/v1/openapi.json` is generated from the route registry (zod 4 JSON Schema), valid OpenAPI 3.1 (validated in a test). A test fails when an app route file is not in the registry. `/developers` has a getting-started guide, authentication, errors and limits, recipes (§4) and the rendered reference. | `lib/app/api/openapi.ts`, `app/api/v1/openapi.json/`, `app/(public)/developers/`, `components/app/developers/` |

#### `f-usage` — Usage and limits

- **summary:** Each workspace's assessments and AI spend this month, its limit, and a refusal
  before a run that would pass it rather than after.
- **dependsOn:** `f-assessments`, `f-app-frame`
- **references:** D6 · plan §1 "AI"
- **description:**

  There is no billing yet (D6), but every full assessment costs money. Sunrise's budget gate
  refuses only after a workspace has passed its cap, mid-assessment, and nobody can see
  what they have used.

- **doneWhen:**
  - On a deployed build, `/usage` shows the month's figures, and a workspace at its cap is
    refused before an assessment starts.
- **indicative tasks:**

| Ref | Title                                                  | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                              | Files in scope                                                                           |
| --- | ------------------------------------------------------ | ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| u1  | Show each workspace its usage and hold it to its limit | M    | —          | `GET /api/v1/usage` and `/usage`: assessments, judges run and spend this month by project, against the cap. Before a run, its estimated cost (from recent runs of the same profile) is checked against what is left, and a run that would pass it is refused with `budget_exceeded` and the figures. Tests at, under and over the cap. | `lib/app/usage/`, `app/api/v1/usage/`, `app/(protected)/usage/`, `components/app/usage/` |

#### `f-mcp` — MCP tools

- **summary:** Quick scan, assess, read an assessment, compare and rewrite as MCP tools, so AI
  assistants and Sunrise's own agents can use HowDoesThisLand.
- **dependsOn:** `f-assessments`, `f-compare`, `f-rewrite`
- **references:** D12 · `.context/orchestration/mcp.md`
- **description:**

  People want to check a draft from the assistant they write in. Sunrise's MCP server serves
  capabilities, bound to an org by its key. The same capabilities let a workspace's own
  agents and workflows call HowDoesThisLand.

  **After merge** (`sunrise.mcp-reseed`): reseed each database so the capability rows exist,
  enable the tools on the MCP page, and reconnect any client.

- **doneWhen:**
  - On a deployed build, an MCP client with a workspace's key lists the tools and gets an
    assessment summary back.
- **indicative tasks:**

| Ref | Title                              | Size | Depends on | Done when                                                                                                                                                                                                                                                                                                                                                     | Files in scope                                                                                       |
| --- | ---------------------------------- | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| mc1 | Offer HowDoesThisLand as MCP tools | M    | —          | Five capabilities in `lib/app/capabilities.ts` with seed pairs (rows re-pinned), each calling the same library functions as the routes. An assessment that outlasts the tool's time limit returns its id and status for `get_assessment`. Whether a workspace OWNER can mint an MCP key is checked and documented in `.context/app/mcp.md`. Capability tests. | `lib/app/capabilities.ts`, `lib/app/capability-seed-pairs.ts`, `lib/app/mcp/`, `.context/app/mcp.md` |

---

### Phase `launch` — Going live

- **name:** Going live
- **summary:** Production configured for multi-tenancy, the maintenance tick, the PDF
  renderer and the judges; the culture data cleared or switched off; and a launch review.
- **description:** The checks that only a deployment can answer.

#### `f-launch` — Launch

- **summary:** Production configured, the culture question settled, and the public surfaces
  reviewed under load before the site opens.
- **dependsOn:** `f-workbench`, `f-sharing`, `f-public-site`, `f-developer-platform`,
  `f-usage`, `f-mcp`, `f-calibration`, `f-editing`
- **references:** D11, D13 · open questions 1–3
- **description:**

  Several things work in development but depend on production set-up: the cron that drives
  recovery and retention, the role split, the provider row, the embedding model, Chromium,
  and the culture switch. The public routes (scan, shared reports, docs) take anonymous
  traffic and need a deliberate review.

- **doneWhen:**
  - The production site is open, the maintenance tick runs every minute, and a full
    assessment, a PDF and a share link work on it.
- **indicative tasks:**

| Ref | Title                                            | Size | Depends on | Done when                                                                                                                                                                                                                             | Files in scope                                                  |
| --- | ------------------------------------------------ | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| l1  | Write down and script the production set-up      | M    | —          | `.context/app/production.md` covers the role split, env vars, provider row, embedding model, cron for the tick with `CRON_SECRET`, Chromium, storage, and the order to do them in. A check script reports each as present or missing. | `.context/app/production.md`, `scripts/app/check-production.ts` |
| l2  | Settle the culture data and set the switch       | S    | —          | The owner's decision on the Hofstede and Lewis data is recorded on this feature; the production value of the culture switch follows it; with it off, no culture data is served (tested in `e2`, confirmed here).                      | `lib/app/env.ts`, `.context/app/production.md`                  |
| l3  | Review the public surfaces and load-test judging | M    | l1         | `/security-review` over the public routes; a load test of N concurrent full assessments against OpenAI's limits, with the concurrency settings adjusted and recorded; rate limits on scan, shares and docs confirmed.                 | `scripts/app/load/`, `.context/app/production.md`               |

---

### Phase `scale` — Volume and integration

- **name:** Volume and integration
- **summary:** Batches, webhooks for finished work, and one piece judged against several
  audiences at once.
- **description:** The second wave of the API (D12), after launch.

#### `f-batch-webhooks` — Batches and webhooks

- **summary:** Many pieces assessed in one call, and signed webhooks a workspace subscribes to
  for finished assessments, comparisons and batches.
- **dependsOn:** `f-developer-platform`
- **references:** D12 · `.context/orchestration/hooks.md`
- **description:**

  Routine users (a content team checking every page, a CMS checking every draft) want to send
  work in bulk and be told when it is done rather than poll. Core's event hooks take `app.*`
  events, signed and retried, but only platform admins can create them.

- **doneWhen:**
  - On a deployed build, a batch of twenty completes and a subscribed endpoint receives
    signed events for it.
- **indicative tasks:**

| Ref | Title                                     | Size | Depends on | Done when                                                                                                                                                                                                                                                                                               | Files in scope                                                                   |
| --- | ----------------------------------------- | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| bw1 | Let workspaces subscribe to finished work | M    | —          | `event-subscriptions` routes for workspace owners and admins write core event-hook rows in their org; secrets rotated through the core route; `app.assessment.completed`, `app.comparison.completed` and `app.batch.completed` emitted. Settings page. Signature verification documented with a sample. | `lib/app/events/`, `app/api/v1/event-subscriptions/`, `components/app/settings/` |
| bw2 | Assess content in batches                 | L    | bw1        | AssessmentSet kind `batch`; `POST /api/v1/batches` takes up to 100 items, runs them under the workspace's concurrency limit, and reports progress; budget checked for the whole batch before it starts. Tests for partial failure.                                                                      | `lib/app/batches/`, `app/api/v1/batches/`                                        |

#### `f-audience-panel` — Audience panels

- **summary:** One piece judged against several audiences (roles, archetypes, cultures), with
  a matrix of how it lands with each.
- **dependsOn:** `f-compare`
- **references:** D12
- **description:**

  "How does this land with a CFO, a CTO and a procurement lead?" is the product's own
  question, asked of several readers at once.

- **doneWhen:**
  - On a deployed build, a panel of three audiences completes and its matrix view renders.
- **indicative tasks:**

| Ref | Title                                      | Size | Depends on | Done when                                                                                                                                                                                                                                        | Files in scope                                                                               |
| --- | ------------------------------------------ | ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| ap1 | Assess one piece against several audiences | L    | —          | AssessmentSet kind `panel`; `POST /api/v1/panels` with 2–6 audiences runs the judges that depend on the audience once per audience and the rest once; `/panels/[id]` shows the matrix and the editor's summary of where it lands best and worst. | `lib/app/panels/`, `app/api/v1/panels/`, `app/(protected)/panels/`, `components/app/panels/` |

---

### Sweeps

- **`model-steps` · New models:** the standing steps for each new model (§5). Tasks `s1`,
  `p1`, `c1`, `c2`, `k2`, `lg1`, `x2`, `rw1`, `cm1`, `ed1`, `ed3`, `bw2`, `ap1`.
- **`public-surface` · Anonymous routes:** routes anyone can call, each reviewed for rate
  limits and tenant entry. Tasks `s2`, `p2`, `x2`, `pub1`, `pub2`, `dp2`.

### Standing features

These already exist in the Hub, so the plan does not create them.

- **Housekeeping** (`f-housekeeping`) takes CI, tooling, dependency bumps and the dev
  environment beyond `w1`.
- **Upstream** (`f-upstream`) takes each Sunrise release, the divergence ledger and every
  issue filed with Sunrise (the signup seam, if `w2` needs one; the stale tenancy doc).

---

## 7. Loading this into the Hub

**From a session opened in `~/code/howdoesthisland`**, whose `.mcp.json` points at the
`howdoesthisland` project. A session in the Sunrise checkout reaches the wrong project.

The history import does not fit (it writes only claimed, active or merged tasks into an
empty project, and t-1 exists). The plan goes in through the planning verbs:

1. **Phases.** For each phase block, in the order of §6, `create_phase` with its `name`,
   `summary` and `description`. The phase key is used only inside this document.
2. **Milestones.** For each milestone, `create_milestone` in its phase with its name and demo
   lines; features join it as they are created.
3. **Features, in dependency order** (the order of the table in §6, top to bottom). For each
   block, `create_feature` with `phaseId`, `slug`, `title`, `summary`, `description`,
   `doneWhen`, `references` (a link to this plan's section first), `dependsOnFeatureIds`,
   and `indicativeTasks`, each written as `"<ref> · <title> (<size>) — done when: …"` and
   shortened to the Hub's 500-character cap. The full done-when is here, and it is the one
   `plan_feature` takes.
4. **Decisions.** `record_decision` for D1–D27 on the feature each governs (D27 is
   recorded on `f-editing`, the first feature built around it, but binds every feature):

   | Decisions         | Feature                |
   | ----------------- | ---------------------- |
   | D1                | `f-workspaces`         |
   | D2, D3, D5        | `f-framework-store`    |
   | D11, D19          | `f-engine`             |
   | D14               | `f-intake`             |
   | D8, D17           | `f-judges`             |
   | D7, D10, D12, D16 | `f-assessments`        |
   | D4, D18, D21      | `f-projects`           |
   | D9                | `f-calibration`        |
   | D13               | `f-sharing`            |
   | D15, D22, D23     | `f-app-frame`          |
   | D26               | `f-language`           |
   | D24, D25, D27     | `f-editing`            |
   | D20               | `f-developer-platform` |
   | D6                | `f-usage`              |

5. **Sweeps.** `create_sweep` for `model-steps` and `public-surface`; tasks join them with
   `update_sweep` once their features are planned.
6. **Tasks wait for a claim.** A feature's claimer reconciles its indicative tasks against
   the tree (`fp1`), then calls `plan_feature`, each row mapping to `ref`, `title`, `size`,
   `doneWhen`, `dependsOn` and `filesScope`, with a description pointing back to the block.

---

## 8. Design

### 8.1 The framework store

A framework is three things: **records** (what it judges against), **an engine** (how it
scores), and **judge slots** (who it asks). Records are data, versioned; the engine and slots
are code, and the code says which kinds of record a framework has.

**Tables** (all shared config: no `orgId`, written only by the import and publish scripts):

- `Framework`: `slug`, `name`, `summary`, `status`.
- `FrameworkVersion`: `frameworkId`, `version` (semver), `schemaVersion`, `status`
  (`draft` → `published` → `retired`), `sourceDocument` (the imported JSON, for export
  and audit), `sourceSha256`, `publishedAt`, `calibration` (a snapshot of the AI run that allowed
  publishing: run id, date, agreement; copied at publish because the run is an install-org
  row other workspaces cannot read).
- `FrameworkNode`: `versionId`, `kind` (`appeal`, `dimension`, `lens`, `move`, `red_flag`,
  `content_type`, `archetype`, `exec_role`, `perspective`, `lever`, `duty`, `judge`,
  `culture_country`, `culture_scale`, `research`, `knowledge_ref`, `limitation`, …),
  `key` (the model's own id, e.g. `eth_goodwill`), `parentKey` (a lever's perspective, an
  extra dimension's group), `name`, `position`, `attributes` (JSON, validated by the
  kind's Zod schema). Unique on `(versionId, kind, key)`.
- `FrameworkLink`: `versionId`, `fromNodeId`, `toNodeId`, `relation` (`grounded_in`,
  `research`, `move_for`, `judged_by`, …). Unique on all four. Containment (a lever's
  perspective, an extra dimension's group) is `parentKey` alone, never also a link, so the
  tree has one source.

**Why this shape** (D3): the model is a graph of typed entities that scoring walks exactly,
so it is relational, not vector. A generic node and link pair, typed by per-kind schemas in
code, lets a second framework arrive without new tables (D2), while every reference is a
real row that can be queried ("which research grounds this dimension?", "which moves serve
it?") and checked at import. Singletons (`meta`, `scoring`, `brand`, `culture.note`) are
nodes of their own kinds.

**Properties** (`fp4`):

- **Import is idempotent**: the same file twice is no change. A different file under a
  published version number is refused.
- **Published is immutable**: no write path updates or deletes a published version's nodes
  or links. Retiring a version stops new assessments using it; existing ones keep it.
- **The round trip is exact**: `materialise()` rebuilds the typed model from nodes and links,
  and equals the source document. The engine runs on the materialised model, so the records,
  not the file, are what scores.
- **Cache by version id**: a published version cannot change, so its materialised model is
  cached for the life of the process.

### 8.2 The assessment pipeline

```
POST /assessments ─▶ intake (text | file | url) ─▶ Content row
                  ─▶ Assessment row: queued
                  ─▶ 202 (or wait)          keepRunningAfterResponse(run)
run:  lease ─▶ quick scan ─▶ judges in parallel (≤ per-workspace limit; each JudgeRun saved as it lands)
            ─▶ editor summary (full only) ─▶ assemble ─▶ completed | partial | failed
            each step writes its row (Assessment status, JudgeRun) ─▶ GET …/events polls the rows ─▶ SSE
recovery job (per org, each tick): queued/running with an expired lease ─▶ re-run missing judges (≤ 3 attempts)
```

- **Progress is read from the database**, not passed in memory. The run may be in another
  request's `after()`, on another instance, or in the recovery job, so the events route polls
  the assessment and its judge runs on a short interval, sends an event for each change, and
  closes at a final state.
- **States:** `queued`, `running`, `completed`, `partial` (a judge or the editor failed and
  the quick scan stood in, with the reason), `failed`, `cancelled`.
- **Why not the workflow engine** (D16): the pipeline is fixed product code whose prompts are
  computed from versioned data, not an operator-editable workflow; the engine has no fork
  step types or template seam, and its workflow rows would sit in each workspace's builder.
  The mechanism it uses for durability (a row, `after()`, a tick sweep) is the one copied
  here, because its reason (crash recovery without a queue) holds here too.
- **`FrameworkEngine`** is the interface a framework implements: `quickScan(text, ctx)`,
  `judgeSlots(ctx, profile)`, `buildJudgeRequest(slot, text, ctx, projectContext)`,
  `outputSchema(slot)`, `assemble(text, ctx, quick, outputs)`, `rewriteRequest(…)`.
- **Ephemeral runs** (`store: false`) are synchronous only; they keep no content or result,
  only the usage and cost record: its cost rows carry `ephemeral: true` and no
  `assessmentId`, and count toward usage and the budget like any other (§8.3).
- **Long content**: the prototype truncates at 40,000 characters. The API refuses longer
  content with a clear error in v1 (a long-document mode is in §12).

### 8.3 The judges

- **Who runs it is the workspace's; what it asks is the version's** (D17). Each judge agent's
  code-owned instructions are a short, stable frame: the role, that content and context are
  data to judge and never instructions, and the output discipline. The persona, rules, rubric,
  moves, flags and output shape come from the framework version.
- **Strict schemas**: each judge's Zod schema produces an OpenAI strict JSON schema, with the
  version's ids as enums, so a reply cannot name a dimension that does not exist. The Zod
  parse and post-validation still run, because the schema is a request, not a guarantee.
- **Limits per judge**: the influence judge's reply (13 perspectives × 6 levers) is several
  times the others', so `maxTokens` and timeout are set per slot and measured in `k3`.
- **Cost**: every call is logged with `{ assessmentId, judge, frameworkVersion }` (no
  `assessmentId` on an ephemeral run, §8.2), so the
  usage page and the per-assessment cost come from the same rows the budget gate counts.

### 8.4 Project context

- **Brief and defaults** are structured fields on the project; the brief is always given to
  the judges, under a heading that says it is the author's own description.
- **Documents** go into the workspace's knowledge base through `uploadDocument` (D18), linked
  to projects by `ProjectDocument`. Search is limited to the project's document ids. A
  document is removed from the base only when the app created it, its last project link goes
  and no agent is granted it, because uploads are deduplicated across the workspace and the
  base is shared with core's knowledge page (`c2`).
- **Retrieval** uses queries drawn from the content's sections, returns at most a fixed
  number of passages under a token budget, and records which passages were used.
- **Why not our own vector table:** the knowledge base already gives chunking, embedding,
  hybrid search, cost attribution, tenancy and erasure, and our own table would need raw SQL
  (a core allowlist row) and its own index handling (`B13`). Its one mismatch, one corpus per
  workspace, is closed by the document-id filter.

### 8.5 The report

Read top to bottom, in this order, omitting what a result does not have:

1. **Cover**: title, content type, audience, date, project, framework version.
2. **Verdict**: overall score and band, the editor's summary, the three changes that matter
   most.
3. **How it lands**: the four appeals against the target mix for this content type and
   audience, the balance index, integrity caps if applied.
4. **The text, annotated**: strengths and weaknesses marked in place, each linked to its
   dimension and recommendation.
5. **Recommendations**: by impact, each with the issue, the move, the original and the
   rewrite.
6. **Red flags**, with severity and quote.
7. **Dimensions**, per appeal and group, with score and reason.
8. **Duties and lenses**, **influence perspectives** with levers, **craft metrics**,
   **audience** and **culture** (when switched on).
9. **Context used**: the project brief and documents the judges read.
10. **Method and limitations**: the judges and models that ran, any that fell back, the
    calibration status of the version, the model's interpretation note ("structured
    judgement, not predictions") and its stated limitations.

The same component renders the web report, the print view the PDF is made from, and the
shared view (which leaves out workspace and author).

### 8.6 Drafts, edits and revisions

- **A draft never changes.** Assessments point at a `Content` row, so editing one in place
  would make every earlier report describe text that no longer exists. Saving creates the
  next draft (`draftNumber` + 1, same `rootContentId`); the editor works on a copy in the
  browser until then. One save is one round of changes, however many edits and accepted
  revisions it holds, which is how writers and clients already count rounds.
- **Two writers, one draft.** A save names the draft it started from; if that is no longer
  the latest, it is refused (409) and the editor shows the other writer's changes against
  the working copy, to accept or redo. No merging in the first version.
- **A revision sees its passage and only rewrites it.** The editor agent gets the
  selection, the surrounding paragraphs as read-only context, the brief, the notes that
  overlap the selection, the model's moves for the chosen focus, and the English variant.
  It returns suggestions for the selection alone, so nothing outside it can change; the
  server checks that the offsets and the selected text agree before calling, and the
  editor checks again before showing a suggestion in place.
- **The direction is the writer's; the copy is data.** The writer's direction is the one
  instruction in the prompt besides the version's own; the copy, the brief and the notes are
  framed as material (D21). The reply's format is fixed by its schema whatever either says.
- **Notes across drafts.** A note on draft 1 is shown on draft 2 when its quote is found
  unchanged, located as judges' quotes are; otherwise it is listed as changed since the
  review. Re-assessing is the only way a draft gets new notes.
- **Tracked changes are a view, not a store.** Changes between drafts are computed by
  `diffDrafts`; suggested and accepted revisions are `Revision` rows. Nothing stores a
  change list that could drift from the drafts themselves.
- **Formatting is out of scope.** Copy is plain text with paragraph breaks, as intake makes
  it. Bold, links and lists in the editor would need a rich-text model that intake, the
  judges and the report do not have (§12).

---

## 9. Data model changes, in one place

All in `prisma/schema/app.prisma`, tables prefixed `app_`. Tenant-owned models, children such
as `JudgeRun` and `ProjectDocument` included, carry their own `orgId` (cascade) and an
isolation policy; user columns are plain strings with hand-written
FKs (§1).

| Model              | Owner                | Key fields                                                                                                                                                                      | User columns (on delete)     | Task  |
| ------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----- |
| `Framework`        | shared config        | `slug`, `name`, `status`                                                                                                                                                        | —                            | `s1`  |
| `FrameworkVersion` | shared config        | `frameworkId`, `version`, `status`, `sourceDocument`, `sourceSha256`, `calibration`                                                                                             | —                            | `s1`  |
| `FrameworkNode`    | shared config        | `versionId`, `kind`, `key`, `parentKey`, `name`, `position`, `attributes`                                                                                                       | —                            | `s1`  |
| `FrameworkLink`    | shared config        | `versionId`, `fromNodeId`, `toNodeId`, `relation`                                                                                                                               | —                            | `s1`  |
| `Content`          | tenant               | `projectId?`, `title`, `sourceKind`, `sourceUrl?`, `fileName?`, `text`, `textSha256`, `wordCount`                                                                               | `createdByUserId` (set null) | `p1`  |
| `Assessment`       | tenant               | `contentId`, `projectId?`, `frameworkVersionId`, `profile`, `judges[]`, `context`, `status`, `result`, `overall`, `band`, `costUsd`, `lease…`, `requestedVia`, `apiKeyId?`      | `createdByUserId` (set null) | `p1`  |
| `JudgeRun`         | tenant (child)       | `assessmentId`, `judge`, `provider`, `model`, `status`, `attempts`, `costUsd`, `tokens`, `latencyMs`, `rawOutput?`, `dropped`                                                   | —                            | `p1`  |
| `Project`          | tenant               | `slug`, `name`, `brief`, `defaults`, `overlay`, `frameworkId`, `archivedAt`                                                                                                     | `createdByUserId` (set null) | `c1`  |
| `ProjectDocument`  | tenant (child)       | `projectId`, `knowledgeDocumentId`, `title`, `status`                                                                                                                           | `addedByUserId` (set null)   | `c2`  |
| `CalibrationRun`   | tenant (install org) | `frameworkVersionId`, `mode`, `judgeModels`, `totals`, `rows`, `costUsd`                                                                                                        | `startedByUserId` (set null) | `k2`  |
| `ReportShare`      | tenant               | `assessmentId`, `tokenHash`, `expiresAt`, `revokedAt`, `viewCount`                                                                                                              | `createdByUserId` (set null) | `x2`  |
| `Rewrite`          | tenant               | `assessmentId`, `focus`, `draft`, `model`, `costUsd`                                                                                                                            | `createdByUserId` (set null) | `rw1` |
| `AssessmentSet`    | tenant               | `kind` (`comparison`, `batch`, `panel`), `projectId?`, `members`, `verdict`, `status`                                                                                           | `createdByUserId` (set null) | `cm1` |
| `UserPreference`   | per person           | `userId` (unique), `language` (`en-GB` \| `en-US`)                                                                                                                              | `userId` (cascade)           | `lg1` |
| `Revision`         | tenant               | `contentId`, `assessmentId?`, `selectionStart`, `selectionEnd`, `selectedText`, `direction`, `focus`, `language`, `suggestions`, `acceptedIndex?`, `status`, `model`, `costUsd` | `createdByUserId` (set null) | `ed3` |

**Columns added to models above:** `Project.language?` (`lg1`; null inherits the person's
default); `Content.parentContentId?`, `rootContentId`, `draftNumber`, `changeSource` (`ed1`);
the English variant inside `Assessment.context` (`lg1`) and on `Rewrite` (`rw1`).

**Why `UserPreference` cascades and is not tenant-owned:** a person's default English goes
with them across workspaces and is their own data, so it is erased with them and given to
them in the subject export. A team's shared choice belongs on the project.

**Why set null, not cascade**: content, assessments and projects belong to the workspace (the
tenant is the controller, per Sunrise's tenancy decision), so they survive a member's
erasure, and the member's identity leaves with them. The subject export gives each person
what they created; the org export gives the workspace everything.

**Columns that point at core models** (`Assessment.apiKeyId` → `AiApiKey`,
`ProjectDocument.knowledgeDocumentId` → `AiKnowledgeDocument`) follow the user-column rule: a
plain `String` with a hand-written FK in the migration and a drift probe, and no Prisma
relation, so no core schema file is edited. `apiKeyId` is `SET NULL`, so the assessment still
says it came through the API. `knowledgeDocumentId` is `CASCADE`, so a document deleted through
core's knowledge page takes its project links with it. The assessment keeps its own copy of
each document's title and the passages used, so its report still lists them.

**The `tenancy.prisma` ledger row** (`prisma/schema/tenancy.prisma`): one back-relation line
on `Org` per tenant model, added with each model. It takes whatever row number is next when the
first tenant model lands, since other foundation tasks may add rows before it. Merge action: take theirs, re-add our lines. Deleted
when Sunrise lets a fork's models relate to `Org` without editing it.

---

## 10. Decisions

### Decided — 2026-11-09

"Owner, Qn" is the owner's answer to question n of the planning conversation on
2026-11-09; "brief Qn" is a question in BRIEF §8.

**D1 · Workspaces** (owner, Q1)

**Every person gets a workspace of their own; teams create shared ones.** A workspace is a
Sunrise org. An uninvited signup becomes `OWNER` of a new workspace and is not a member of
the install org. There is no client level beneath the workspace: an agency uses projects for
clients. In v1 every member of a workspace sees all its projects.

**D2 · Frameworks, plural** (owner, Q2)

**The persuasion model is the first of several frameworks.** Storage, engine interface,
judge slots, API paths and reports are framework-generic. v1 ships only HowDoesThisLand's
framework; a second one is in §12.

**D3 · The model is relational and versioned** (brief Q2; owner: "properly stored")

**Records in Postgres, versioned, immutable once published**, as §8.1. The JSON in the repo is
the import format and the reviewed source; the records are what the engine runs on. Every
assessment pins its version.

**D4 · Vectors for project context, not the model**

The model is walked exactly by scoring, so it is never retrieved by similarity in v1. Vector
search is for project documents (D18). Embedding the model's research and moves for an
advisor is in §12.

**D5 · Who changes the model** (owner, Q3)

**Model changes are PRs to the JSON, imported and published by script.** Admins browse
versions and calibration in the app; editing in the app is in §12. **Projects may adjust
weights** (appeal mix and priority dimensions) within bounds the framework sets; rubrics,
prompts and ids are not adjustable. The adjustment is recorded on each assessment.

**D6 · No billing yet** (owner, Q4)

The app is a prototype without billing until Sunrise ships it. Every AI call's cost is
recorded; each new workspace gets a default monthly AI budget (the number is open
question 2); a run is refused before it starts if it would pass the budget (`u1`).

**D7 · Free quick scan for anyone; AI judges need an account** (owner, Q5)

The quick scan is open on the site and `POST /api/v1/scan` without a key, IP-limited, storing
nothing. Ad-hoc payments for anonymous AI use wait for billing (§12).

**D8 · OpenAI by default; models chosen by measurement** (owner, Q6)

The judges and the editor default to OpenAI. Which models is decided in `k3` by agreement,
cost and time on the calibration set; until then `j1` uses a mid-tier chat model for judges
and the flagship for the editor. Workspaces can change provider and model per agent.

**D9 · The calibration set is brought up to the model first** (owner, Q7)

Extended to all nine judges in `k1`, reviewed in its PR like any change (the artefact's
two-reviewer note is dropped, by the owner). Publishing a framework version requires an AI
calibration run. The runner is the app's own, because Sunrise's evaluations take no fork
subject types.

**D10 · Keep what people submit, with a retention window and a no-store option** (owner, Q8)

Content and assessments are stored per workspace and project, so history, reports and share
links work. A workspace may set a retention window (`p4`). API calls may pass `store: false`
to keep nothing but the usage record. Judge runs' raw replies go after 30 days.

**D11 · Culture is a module that can be switched off** (owner, Q9)

The Hofstede and Lewis data's terms are unchecked. The culture judge, inputs, outputs and
model pages sit behind one switch, on in development. Its production value is set at `l2`
after the owner checks the terms.

**D12 · The API surface** (owner, Q10; brief Q8)

v1: quick scan, assessments (with profiles, single judges, `wait`, `store`), rewrite,
comparison, reports and shares, projects, the model, usage, and MCP. Phase 2: batches,
webhooks and audience panels. The draft YAML is a starting point, not the contract: routes
use Sunrise's envelope under `/api/v1/` with resource names, and the contract is the route
registry (`p2`).

**D13 · Reports on the web, as PDF and by link; no DOCX** (owner, Q11)

One report component renders all three (§8.5). White-label reports are in §12.

**D14 · Fetching from a URL, safely** (owner, Q12)

In v1, through the app's own fetcher (`i2`), because core's refuses ordinary pages by
extension and checks addresses at connect time only for customer orgs. URL fetch needs an
account; the anonymous scan takes pasted text only.

**D15 · The look is chosen by eye** (owner, Q13)

It must be distinct, interesting and easy to use. `a1` builds two or three directions as real
screens (one drawing on the artefact's Tyrian & Graphite and Greek system, one on the model's
`brand.visual`), and the owner chooses.

**D16 · Assessments run as the app's own durable job**

Not as workflow executions (§8.2 says why). A row, a lease, `after()`, and a recovery job on
the tick.

**D17 · Judges are platform agents; their questions come from the version**

Each workspace owns its judge and editor agents and can tune how they run. What a judge asks
is the framework version's, so prompts are versioned with the model. Calls go to the
provider directly with the agent's binding, to use strict JSON schemas. A direct call does not
get chat's per-agent checks, so `runJudge` applies the agent's budget and rate limit itself
(`j2`).

**D18 · Project documents live in Sunrise's knowledge base**

§8.4 says why. Searches are limited to the project's document ids.

**D19 · Transliterate the engine, against a recorded baseline**

The port follows `engine.js` function by function, proved against fixtures recorded from the
prototype, with the three bugs fixed and every resulting difference listed.

**D20 · The OpenAPI document is generated from the route contracts**

Sunrise ruled out OpenAPI-driven validation because a separate schema drifts. Generating the
document from the Zod schemas the routes validate with removes that reason; a test keeps
every route in the registry.

**D21 · Project context is background, never instruction**

The brief and retrieved passages are framed as the author's description of their situation.
They inform the judges' reading of audience, ethos and kairos; they cannot change the
rubric or the output.

**D22 · Signed-in people land on `/home`**

Through the auth-landing seam, so the platform's dashboard is not edited.

**D23 · Pages live in Sunrise's `(public)` and `(protected)` groups** (code review of this
plan, 2026-11-10)

New public pages go in `(public)` and signed-in ones in `(protected)`, with their prefixes in
`protected-routes.ts`, themed through the brand, nav and footer seams and `brand-theme.css`
(CUSTOMIZATION.md's default). New `(site)` and `(app)` groups were rejected: `/` and `/about`
must stay in `(public)`, because a second file cannot own a URL, and `/settings` lives in
`(protected)`, so new groups would split the product across two frames. Where the chosen look
needs a layout edit, it carries a ledger row (`a2`). `(print)` stays its own group, because the
PDF view has no frame.

### Decided — 2026-11-13

From the owner's additions to the plan on 2026-11-13.

**D24 · The AI can revise a selected passage, to the writer's direction** (owner)

A writer selects part of the copy and asks for it to be revised against the model, saying
what they want ("with some guidance from the user"). Only the selection changes; the writer
chooses the focus and gets up to three suggestions, each naming the moves it used, which
they accept or reject. Rejected: revising the whole draft with a direction (that is a
rewrite, `f-rewrite`), and applying a suggestion without the writer accepting it. §8.6
gives the rules.

**D25 · Writers edit the copy in their own words, and each saved round is a new draft**
(owner)

The draft editor lets the writer change the copy directly. Drafts are immutable and
numbered, because assessments must keep describing the text they read; one save is one
round of changes. Rejected: editing a draft in place (breaks every earlier report), and
saving a draft on every keystroke (floods the history with drafts nobody chose to keep).

**D26 · UK or US English: a personal default, overridden per project and per piece**
(owner)

Each person picks UK or US English as their default; a project can set its own, and a single
piece of copy can override both. The order is the piece, the project, the person, then UK
English (the model's language). Judges, the editor, rewrites, revisions and the house-style
check all use the resolved variant, and every result records it. A workspace-wide default
was not asked for and is left for later (§12): a team that shares a convention sets it on
its projects.

**D27 · The product speaks the copywriting profession's language** (owner)

Everything a person reads uses the terms copywriters, editors and their clients use, listed
in §4 "The words we use", which every PR that adds visible words is checked against. Code
and already-planned API names are not renamed, so the API stays stable; new public names
take the profession's word. The terms the owner has not yet chosen are open question 5.

### Still open

1. **Where it deploys.** Sunrise's Docker production set-up or a serverless host. It decides
   how Chromium runs for PDFs (`x1`) and how the tick's cron is set (`l1`). Default:
   Docker. Needed by `x1`.
2. **The default monthly AI budget per workspace** in the prototype. Proposal: $10. Needed by
   `w2`.
3. **The culture data's terms.** The owner checks Hofstede's and Lewis's licensing. Needed by
   `l2`.
4. **CHANGELOG.** This fork publishes no releases. Proposal: no entries, and the CLAUDE.md
   rule is updated to say so. A Housekeeping task if accepted.
5. **The copywriting names still to choose** (D27): what people see in place of
   _assessment_, _judges_, _content type_, and one piece of work in a project (job or
   assignment), listed under "Proposed" in §4. Needed by `r1` and `b1`, the first pages
   that show them; the API names stay either way.

---

## 11. Risks

| Risk                                                                                   | Mitigation                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A self-serve signup lands in the install org** and sees the vendor's workspace.      | `w2` checks the hook ordering first; if it cannot be race-free, a generic seam under `B19` with an upstream issue. The smoke run proves exactly one membership. |
| **Nine judges are slow or costly**, and the influence judge's reply is large.          | Profiles let callers run fewer; limits per judge; models chosen by measurement (`k3`); the quick scan shows at once; cost refused before a run (`u1`).          |
| **OpenAI rate limits** under concurrent assessments.                                   | Per-workspace and global concurrency limits; backoff on 429; measured in the load test (`l3`).                                                                  |
| **Strict JSON schemas reject parts of a judge's shape** (OpenAI's strict subset).      | `j2` generates within the subset and tests every judge's schema against the provider in the smoke run; Zod still validates.                                     |
| **Judges invent quotes or ids.**                                                       | Enum ids in the schema, quotes located or dropped, and the counts recorded per judge run and shown in calibration.                                              |
| **Prompt injection** through content or context documents.                             | Framed as data, no tools, output validated; injection cases added to the calibration set (`k1`).                                                                |
| **A model or prompt change silently shifts scores.**                                   | Assessments pin version and judge models; calibration compares each run with the last; publishing needs a run.                                                  |
| **The tick does not run in production**, so stalled jobs and retention never happen.   | `l1` scripts and checks the cron; `noteMaintenanceWork()` on enqueue; the launch done-when requires the tick.                                                   |
| **Chromium is too heavy** for the deploy target.                                       | `x1` starts with a spike; a PDF-native renderer is the fallback, at the cost of a second layout.                                                                |
| **The generic framework layer is over-built** for one framework.                       | Generic only where storage and interfaces need it; nothing framework-specific is abstracted until a second framework exists (§12).                              |
| **Culture data cannot be used commercially.**                                          | The switch (D11), tested in `e2`, set at `l2`.                                                                                                                  |
| **The knowledge base's per-workspace dedupe** deletes a document another project uses. | Reference counting by `ProjectDocument` links (`c2`, tested).                                                                                                   |
| **A revision changes more than the selection**, or lands on a passage that moved.      | The reply replaces the selection only; offsets and selected text checked on the server and again in the editor; a stale base refused with 409 (`ed1`, `ed3`).   |
| **The wrong English slips through**: a judge marks a correct UK spelling as an error.  | The variant is a run setting on every call, recorded on the result; fixtures in both variants and mixed copy (`lg2`); calibration cases in each (`k1`).         |
| **Interface words drift from the trade's language** as features land separately.       | One list (§4), a ground rule (§5), and a check on every PR that adds visible words.                                                                             |

---

## 12. Later

**Next after launch:**

- **Billing and ad-hoc payments**, including pay-per-report for anonymous visitors, once
  Sunrise ships billing (D6, D7).
- **A second framework** (brand voice, compliance or accessibility review), which tests the
  generic layer for real (D2).
- **Editing a framework in the app**: draft, calibrate, publish (D5).
- **White-label reports** with a workspace's logo and colours (D13).
- **A long-document mode** that assesses by section and summarises (§8.2).
- **A workspace or client house style**: a default English for the whole workspace, and
  rules beyond spelling (serial comma, capitalisation of headings, banned words) (D26).
- **More English variants** (Australian, Canadian), which the stored tags already allow.
- **Formatting in the draft editor** (bold, links, lists), once intake and the report carry
  more than plain text (§8.6).
- **Revisions through MCP**, so an assistant can revise a passage in a writer's own tools.

**Considered and not planned:**

- **An advisor over the model's research and moves** by vector search (D4).
- **Project-level permissions** inside a workspace (D1).
- **Running the pipeline as a Sunrise workflow** (D16). Instead, the `assess` capability from
  `f-mcp` lets a workspace's own workflows call it.

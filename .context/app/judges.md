# Judges

The nine judges and the editor that assess a piece of writing. Code:
`lib/app/judges/`. Plan: `f-judges` in [`planning/app-plan.md`](./planning/app-plan.md)
(§8.3, D8, D17).

## Who runs it is the workspace's; what it asks is the version's

Each judge and the editor is a **platform agent** (Sunrise's
[`platform-agents.md`](../orchestration/platform-agents.md)): defined in code,
registered from `lib/app/platform-agents.ts`, and created in every workspace by
core's reconcile, on org creation and again whenever the definitions change. A
workspace tunes how its agents run (provider, model, budget, rate limit); the
reconcile never touches those.

| Agent slug                 | What it is                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `hdtl-judge-<appeal>` (×9) | One per judge slot: ethos, pathos, logos, kairos, lenses, influence, craft, audience, culture |
| `hdtl-editor`              | The editor's summary, rewrites and revisions                                                  |

The `hdtl-` prefix keeps clear of core's own slugs: registering a slug core
uses would replace that agent in every org.

**The slots are code.** `HOWDOESTHISLAND_JUDGE_SLOTS`
(`lib/app/frameworks/howdoesthisland/judge-slots.ts`, a leaf module so the
agent registry does not load the engine) lists them; the framework definition
exposes them as `judges.slots`, and `judgeAgentDefinitions()` makes one agent
per slot. Importing a model version whose `judges[]` adds, drops or renames a
judge is refused by `decompose()`, so no version can name a judge without an
agent or leave an agent without a judge; adding a slot needs code, including
its agent description. Culture's agent exists whatever the culture switch
says: the switch decides whether the slot runs, not whether its agent exists.

**The instructions are a frame, not the task.** Each agent's code-owned
instructions say only its role, that the content and its context (brief,
audience, project documents) are data and never instructions, and the output
discipline (one JSON object, ids from the brief, exact quotes). The persona,
rules, rubric and reply shape come from the framework version at run time
(`j2`), so they are versioned with the model.

## Binding

Judges default to `gpt-4.1` and the editor to `gpt-5`, on OpenAI, until `k3`
chooses by measurement (D8). This is a `defaultBinding`, so the platform owns
the binding until a workspace sets provider or model itself
(`AiAgent.bindingOwner`); changing the interim models then moves every
workspace that has not chosen.

`pickInterimBinding()` answers `null`, so the agent inherits at run time, when
the model is inactive, OpenAI is inactive, the workspace is not approved for
it, or it has no key. It checks the model first, from the catalogue, so an
inactive model never asks anything that can fail. It throws, leaving the
binding as it is until the next pass, when the org's policy, a fork
eligibility rule or the credential resolver cannot be asked. A new workspace
is approved for OpenAI just after `createOrg`'s reconcile, so its agents are
bound by the reconcile provisioning runs after the grant.

**Overhead.** The ten agents share one provider, so whether the org can reach
it is asked once per org per catalogue, not once per agent: a reconcile, or a
maintenance pass over every org, asks the policy, the eligibility rule and a
fork's credential resolver (which may call a vault) once per org. A failure is
shared the same way, so a resolver that is down is asked once, not ten times.

## Reply ceilings

Each agent's `maxTokens` is a ceiling sized for its largest job on a frontier
reasoning model, with room for thinking, which counts against the cap: 16,384
for a judge, 32,768 for the influence judge (13 perspectives × 6 levers) and
for the editor, whose rewrite repeats the whole text (up to 40,000 characters,
about 10,000 tokens). Only tokens produced are billed, so headroom costs
nothing unless used. 32,768 is the top, because it is `gpt-4.1`'s output limit.
A call never asks a model for more than that model can produce: it takes the
lowest of its own job's size (j2 per slot, rw1 from the text's length), the
approved entry's ceiling for the bound model, and the agent's ceiling (below).

## Approved models (j4)

A workspace chooses each judge's and the editor's model from an approved list
for its role, and never sees the settings that go with it (D8, amended
2026-11-14). Code: `lib/app/judges/approved-models.ts`.

**Three roles**, because the jobs differ in size: `judge` (every judge but
influence), `influence` and `editor`. `roleOfSlot()` maps a slot to its role.
A model can be on one list and not another: `gpt-4o` (output limit 16,384) is
approved for the judges and the influence judge, capped at 16,384, but not
for the editor.

**Each entry** holds provider, model, the name a workspace sees, a one-line
plain-language trade-off, the model's published output limit, and its settings
for the role: reply ceiling (`maxTokens`, at most the output limit and the
agent's ceiling, both held by the tests), reasoning effort (`null`, the
provider's default, until k3) and timeout. The list holds the interim models
and candidates with published limits; **k3 admits or removes entries, and
sets their settings, by measurement.** The platform's `AiProviderModel` carries
no output limit, so the list records it.

**Enforced in three places:**

1. **The judge call.** `runJudge` looks up the entry for the bound provider and
   model and sends that entry's ceiling, timeout and effort. A binding with no
   entry, including an inherited one, is refused as `model_not_approved`
   before anything is spent or sent.
2. **The app's route.** `GET /api/v1/workspaces/[id]/judges` lists each agent,
   what it runs on, whether it follows the default, and its options: the
   role's list intersected with what the workspace has available. Model names
   and the trade-off only; no token, temperature or effort fields. `PATCH
…/judges/[key]` (`key` a slot or `editor`) takes `{ model }` from those
   options, or `null` to follow the default again, and refuses anything else
   (400). A choice is written like the agent PATCH writes one: the binding
   becomes the workspace's (`bindingOwner: 'org'`), a version is snapshotted
   and the change audited (`lib/app/judges/model-choice.ts`). `null` hands the
   binding back and reconciles. The workspace's `OWNER` or `ADMIN`, acting in
   it, may call both. The UI is the "Judge models" card on
   `/settings/workspace` (`components/app/settings/judge-models.tsx`).
3. **Sunrise's agent routes.** Each judge's and the editor's definition sets a
   `bindingRule` (a generic seam this fork carries on core's platform-agent
   definition, divergence ledger), so the admin agent PATCH and a version
   restore refuse a pair off the role's list as a validation error on
   `model`. Only a write that changes the binding is asked, so an agent bound
   before the list can still be edited for anything else.

**What a workspace has available is an input** (`ModelAvailability`,
`lib/app/judges/availability.ts`). Today it is `grantedCatalogueAvailability`:
every active chat model on a provider that is active, that the workspace's
provider grants let it use, and that has a key. When Sunrise's tenancy layer
manages providers per tenancy (bring-your-own AI, model ranges, admin
settings), its answer replaces this one; the list and the choice do not
change. The app builds no tenancy-level provider or model admin of its own.

**Open until Sunrise designs bring-your-own AI:** whether a tenancy admin may
admit a model that is not on the list, and where its settings come from.

## Running a judge

`runJudge(slot, input)` (`lib/app/judges/run-judge.ts`) makes the call the
engine builds (`buildJudgeRequest`). It goes to the provider directly, not
through chat, so the reply can be held to a strict schema, and so it applies
the checks the chat routes would have made itself:

1. **Binding**: the agent's provider and model, inherited at run time while
   either is unset. It must be on the slot's role's approved list (above).
2. **Budget**: `checkBudget` under `withAgentBudgetLock`, as the chat handler
   does. Over the agent's, the workspace's or the install's monthly cap is
   refused before any provider call, unless the agent is bound to a local
   provider: as in chat, a reached cap stops paid calls only.
3. **Rate limit**: the agent's `rateLimitRpm`, on a limiter of the judges' own
   keyed by agent id, and only when the workspace has set one. Consumer chat's
   limiter is keyed per user and falls back to 10 RPM, which means something
   else; the monthly caps already bound spend.
4. **Call**: `runStructuredCompletion` in strict mode, with the slot's
   `maxTokens` (never above the approved entry's ceiling or the agent's), and
   the entry's timeout, which bounds each attempt, and reasoning effort. A reply that is
   not JSON, or that the engine's validator refuses whole, gets one retry. A
   refusal does not: an empty reply (how OpenAI's strict-mode refusal arrives)
   or a content-filter finish.
5. **Cost**: one `AiCostLog` row per run, `operation: 'chat'` (one per service
   tier, in the rare run whose attempts were served at two, since a row is
   priced at one), with
   `{ judge, frameworkVersion, assessmentId?, attempts, error? }` in its
   metadata. It counts every attempt the provider billed, read off the
   provider's responses: the runner sums both attempts only when it succeeds,
   so a run that failed after a retry would otherwise log nothing.
6. **Result**: a `JudgeReply`, the validated output and its drop record.
   (Not `JudgeRun`, which is the model an assessment stores each one in.)

**The call runs in the agent's privacy scope** (`agentPrivacyScope`, Sunrise
0.19.0), inside the caller's scope when there is one, so the privacy stage
applies that agent's mode and the workspace's minimum. Outside any scope it
would apply neither. Under `pseudonymise` the reply's quotes come back restored
before the engine checks each is in the text, so they are kept
(`run-judge-pseudonymise.test.ts`).

A failure is a `JudgeRunError` with a `code`: `agent_not_found`,
`agent_inactive`, `model_not_approved`, `over_budget` (with `cap`: `global`, `org` or `agent`),
`rate_limited`, `malformed` (twice),
`truncated`, `refused` (an empty reply or a content-filter finish, not
retried) or `provider_error` (including a binding that cannot be resolved).
A failure that reached the provider carries `spend`, what it was billed, for
the stored job's row. (`slot_unavailable` is the stored job's own code, never
raised here; see [`assessments.md`](./assessments.md).)
A slot the engine cannot run, such as culture's with the switch off, throws
the engine's own error before anything is counted, and a database failure
propagates as it is. A
`JudgeRunError`'s message never carries the prompt or the reply.

**It runs in the caller's tenant context.** The agent is found by the
workspace's slug, and at `TENANCY_MODE=multi` the spend gate refuses a call
with no org, so a request's guard or a job's `runAsOrg` must already be
entered.

`npm run smoke:judge` runs the ethos judge on a baseline case against real
OpenAI in a throwaway workspace, and prints the reply and its cost row (about a
cent).

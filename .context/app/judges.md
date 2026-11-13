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

**The slots are code.** `howDoesThisLand.judgeSlots` in the framework
definition lists them, and `judgeAgentDefinitions()` makes one agent per slot.
`tests/unit/lib/app/judges/agents.test.ts` pins the list to the bundled model's
`judges[]`, so a model version that adds a judge fails there until the slot is
added. Culture's agent exists whatever the culture switch says: the switch
decides whether the slot runs, not whether its agent exists.

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
OpenAI is inactive, the workspace is not approved for it, it has no key, or
the model is inactive. A new workspace is approved for OpenAI just after
`createOrg`'s reconcile, so its agents are bound by the reconcile provisioning
runs after the grant. It throws, leaving the binding as it is until the next
pass, when the org's policy, a fork eligibility rule or the credential
resolver cannot be asked.

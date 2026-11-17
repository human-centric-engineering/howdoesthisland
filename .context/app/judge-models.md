# Judge and editor models

Which model each judge and the editor run on by default, what workspaces may choose
instead, and what was measured to decide it (t-39, D8). Code:
`lib/app/judges/agents.ts` (defaults) and `lib/app/judges/approved-models.ts` (the lists).

## The choice

| Role            | Default           | Also approved                                             |
| --------------- | ----------------- | --------------------------------------------------------- |
| Judge (8 slots) | Claude Sonnet 5.5 | Claude Haiku 5.5, Claude Opus 5.5, GPT-4.1, GPT-5, GPT-4o |
| Influence judge | Claude Sonnet 5.5 | Claude Haiku 5.5, Claude Opus 5.5, GPT-4.1, GPT-5, GPT-4o |
| Editor          | Claude Sonnet 5.5 | Claude Opus 5.5, GPT-5, GPT-4.1                           |

- **Anthropic, the current generation**, by owner ruling (2026-11-17).
- **Sonnet over Haiku for the judges**, on the one comparison measured (below): 5 points
  more agreement, most of it on the group checks. Haiku stays on the list as the cheap
  choice.
- **Sonnet for the editor is a judgement, not a measurement.** Calibration does not
  exercise the editor. Haiku is not offered for it: a rewrite of the longest text is the
  hardest job any agent here does.
- **The OpenAI models stay approved**, so a workspace that chose one keeps working. The
  Claude 4.x entries were removed: the current generation replaces them, and the Haiku 4.5
  entry's id (`claude-haiku-4.5`) is not one the API accepts.

## Settings

Every Claude entry runs at **medium effort**, the depth the candidates were compared at,
with a **32,768-token ceiling** (the agent's own, `agents.ts`) and a reasoning model's
timeout: 180 s for a judge, 300 s for the influence judge and the editor.

The judge ceiling went from 16,384 to 32,768 because Claude thinks on every call and the
thinking counts against the cap. 32,768 stays the top for every agent, because it is
GPT-4.1's output limit and nothing clamps an agent's ceiling to the model's on Sunrise's
own routes. The slot's own size (`JUDGE_LIMITS`, 8,192 for most judges, 24,576 for
influence) still bounds a judge call; the largest reply measured, thinking included, was
about 4k for a judge and 9k for the influence judge, all finishing normally.

## What was measured

Version 0.5.1's calibration set (26 cases, 296 checks), AI mode, in the development
install org, every judge bound to the candidate, medium effort. Run with
`scripts/app/calibration/measure-judge-model.ts`.

| Model             | Run                                    | Agreement | Appeal | Group | Flag  | Duty  | Cost per run | Per case | Wall time |
| ----------------- | -------------------------------------- | --------- | ------ | ----- | ----- | ----- | ------------ | -------- | --------- |
| Claude Haiku 5.5  | `12c9b891-7025-489b-a8c7-3aba0e81653e` | 72.3%     | 64 ok  | 15 ok | 38 ok | 17 ok | $0.43        | $0.017   | 18.8 min  |
| Claude Sonnet 5.5 | `0c11a134-04b3-4bf9-938c-b789a450da51` | 77.4%     | 71 ok  | 25 ok | 38 ok | 15 ok | $6.97        | $0.27    | 19.7 min  |
| Claude Opus 5.5   | `94d7641d-b6ee-4d11-b57f-ea88922fed22` | —         | —      | —     | —     | —     | stopped      | ~$0.73   | —         |

Of 104 appeal, 31 group, 38 flag and 23 duty checks. No judge failed on any case in either
complete run. A case is one assessment's nine judges, so the per-case cost is the judges'
cost of one assessment (the editor not included).

The Opus run was stopped part-way on cost, so Opus has no agreement figure. A one-case
probe of each model (case ev01) found all nine judges answering on all three, at $0.02
(Haiku), $0.31 (Sonnet) and $0.73 (Opus) for the case.

## Still to calibrate

Left for the end-of-project checks, with no paid run before then:

- **Run-to-run noise.** One run per model, so the 5-point gap has no error bar yet. The
  publish gate's agreement floor waits on this too.
- **Opus 5.5's agreement**, and whether it earns its cost over Sonnet.
- **Effort.** Only medium was measured; low may hold agreement for less.
- **The editor's model**, which calibration cannot measure.
- **Production's own run** of 0.5.1 against these models, before it publishes there.

## Moving an environment to these defaults

1. Create the `anthropic` provider row (`scripts/app/dev-tenancy.ts` in development,
   `/admin/orchestration/providers` elsewhere), and set `ANTHROPIC_API_KEY`.
2. Seed the models (`npm run db:seed`, unit `app-howdoesthisland/001-claude-models`).
3. Run `scripts/app/grant-judge-provider.ts` **before** deploying the build: a workspace
   not approved for Anthropic would have its judges bound to nothing, not left on OpenAI.
   It also hands back to the platform any judge or editor a workspace bound to a model no
   longer approved (the Claude 4.x entries). It moves no binding itself, so the running
   build is unaffected; the new build's maintenance job rebinds once it is serving. New
   workspaces are approved for Anthropic and OpenAI when they are made.

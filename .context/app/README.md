# HowDoesThisLand app docs

This is the fork's own documentation tier. Sunrise never writes here, so these
files merge cleanly on every upstream sync. Sunrise's platform docs live in the
domain folders beside this one: start at [`../substrate.md`](../substrate.md).

| Doc                                                    | What it is                                                                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`../../prototype/BRIEF.md`](../../prototype/BRIEF.md) | The planning brief: where the artefact came from, what it does, what it depends on, and what the plan must answer.                                                                           |
| [`planning/app-plan.md`](./planning/app-plan.md)       | The app plan: phases, features, decisions D1–D23 and the design they rest on. The spec the Hub's tasks point at.                                                                             |
| [`platform-divergences.md`](./platform-divergences.md) | The divergence ledger: every edit carried to a Sunrise-owned file, why, what to do on conflict, and what deletes it.                                                                         |
| [`dev-environment.md`](./dev-environment.md)           | Setting up the multi-tenant development database: the `.env.local` lines, the order, and `scripts/app/dev-tenancy.ts`.                                                                       |
| [`workspaces.md`](./workspaces.md)                     | Workspaces: what each new one gets, the ownership cap, the switcher and settings page, and which core routes they use.                                                                       |
| [`frameworks.md`](./frameworks.md)                     | Frameworks: importing and publishing a model version, what the import refuses, how versions are stored.                                                                                      |
| [`calibration.md`](./calibration.md)                   | The calibration set and how a case is scored; running it (`npm run calibrate`, or from `/admin/frameworks`), the runs it stores, and the gate that refuses to publish an uncalibrated draft. |
| [`engine-baseline.md`](./engine-baseline.md)           | The prototype engine's recorded outputs: what is covered, how to re-record, how a port is compared.                                                                                          |
| [`engine.md`](./engine.md)                             | The engine: getting one from a definition, its modules, where it differs from the prototype, the culture switch.                                                                             |
| [`intake.md`](./intake.md)                             | Intake: turning an uploaded file into text, the formats, each refusal and its code, and the limits.                                                                                          |
| [`judges.md`](./judges.md)                             | Judges: the nine judge agents and the editor, what their instructions hold and what comes from the version, the default models.                                                              |
| [`judge-models.md`](./judge-models.md)                 | Judge and editor models: the defaults (Claude Sonnet 5.5), what each role may choose, the settings, the calibration runs behind them, and what is still to calibrate.                        |
| [`assessments.md`](./assessments.md)                   | Assessments: the stored rows, the job's states and lease, its limits, cancel, the recovery job, and the smoke run.                                                                           |
| [`api.md`](./api.md)                                   | The API contract: the route registry every app route is declared in, what an entry says, adding a route, and the test that keeps it in step.                                                 |
| [`report.md`](./report.md)                             | The report: where its data comes from, what decides each section, the web, print and shared variants, and the print styles.                                                                  |
| [`usage.md`](./usage.md)                               | Usage: what `/usage` and `GET /api/v1/usage` show, where each figure comes from, and the demo-usage seed.                                                                                    |
| [`projects.md`](./projects.md)                         | Projects: the brief and defaults, the routes, how a review takes a project's defaults, and the demo seed's projects.                                                                         |
| [`workbench.md`](./workbench.md)                       | The assess workbench: `/assess`, how a project's defaults fill its settings, the kept draft, live progress over the event stream, and how refusals are shown.                                |
| [`rewrites.md`](./rewrites.md)                         | Rewrites: the API, what the editor reads, how a rewrite runs on its own and is kept, what it costs and how it is charged, and recovery.                                                      |

Features add their own page here as they land, and a row to this table.

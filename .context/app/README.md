# HowDoesThisLand app docs

This is the fork's own documentation tier. Sunrise never writes here, so these
files merge cleanly on every upstream sync. Sunrise's platform docs live in the
domain folders beside this one: start at [`../substrate.md`](../substrate.md).

| Doc                                                    | What it is                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| [`../../prototype/BRIEF.md`](../../prototype/BRIEF.md) | The planning brief: where the artefact came from, what it does, what it depends on, and what the plan must answer.              |
| [`planning/app-plan.md`](./planning/app-plan.md)       | The app plan: phases, features, decisions D1–D23 and the design they rest on. The spec the Hub's tasks point at.                |
| [`platform-divergences.md`](./platform-divergences.md) | The divergence ledger: every edit carried to a Sunrise-owned file, why, what to do on conflict, and what deletes it.            |
| [`dev-environment.md`](./dev-environment.md)           | Setting up the multi-tenant development database: the `.env.local` lines, the order, and `scripts/app/dev-tenancy.ts`.          |
| [`workspaces.md`](./workspaces.md)                     | Workspaces: what each new one gets, the ownership cap, the switcher and settings page, and which core routes they use.          |
| [`frameworks.md`](./frameworks.md)                     | Frameworks: importing and publishing a model version, what the import refuses, how versions are stored.                         |
| [`engine-baseline.md`](./engine-baseline.md)           | The prototype engine's recorded outputs: what is covered, how to re-record, how a port is compared.                             |
| [`engine.md`](./engine.md)                             | The engine: getting one from a definition, its modules, where it differs from the prototype, the culture switch.                |
| [`intake.md`](./intake.md)                             | Intake: turning an uploaded file into text, the formats, each refusal and its code, and the limits.                             |
| [`judges.md`](./judges.md)                             | Judges: the nine judge agents and the editor, what their instructions hold and what comes from the version, the interim models. |

Features add their own page here as they land, and a row to this table.

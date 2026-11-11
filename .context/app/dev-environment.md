# The development environment

HowDoesThisLand runs at `TENANCY_MODE=multi`: every person works in a workspace
(an org), and Postgres row-level security keeps one workspace's rows from
another's. Your development database has to run the same way, or the work that
depends on it (signup into a workspace, isolation between workspaces, judges
calling OpenAI) cannot be checked locally.

One script gets a database into that shape and proves it:
`scripts/app/dev-tenancy.ts`. It is idempotent. Run it after any setup step
below, and again whenever you are unsure. A run on a database already in shape
reports every step `unchanged` and writes nothing.

## Set it up

1. **Postgres.** Any local Postgres with the `pgvector` extension available, or the `db` service in
   `docker-compose.yml` (superuser `postgres`, database `sunrise`). Create a
   database for this app if you are not using Compose's.
2. **`.env.local`.** Copy `.env.example`. Then, using the fork block at the end
   of `.env.example`, set these lines and remove the other `DATABASE_URL`,
   `MIGRATE_DATABASE_URL` and `TENANCY_MODE` lines:

   ```bash
   TENANCY_MODE="multi"
   TENANCY_APP_ROLE="howdoesthisland_app"
   TENANCY_APP_ROLE_PASSWORD="<a password you choose>"
   DATABASE_URL="postgresql://howdoesthisland_app:<that password>@localhost:5432/<database>"
   MIGRATE_DATABASE_URL="postgresql://<owner>:<owner password>@localhost:5432/<database>"
   OPENAI_API_KEY="<your key>"
   ```

   `DATABASE_URL` is the app role: `LOGIN NOBYPASSRLS`, subject to the policies.
   The running app and the drift check use it. `MIGRATE_DATABASE_URL` is the
   database's owner (`postgres` under Compose, often your own user on a
   Homebrew Postgres). Migrations, seeds and the tenancy scripts use it.

   **The role name must be project-specific.** Roles belong to the whole
   Postgres server, not one database, and other apps on the same server would
   share the platform's default `sunrise_app`. The script refuses that name.

3. **Schema and seed data, as the owner:**

   ```bash
   npm run db:migrate:deploy
   npm run db:seed
   ```

4. **The tenancy setup:**

   ```bash
   npx tsx --env-file=.env.local scripts/app/dev-tenancy.ts
   ```

   Exit 0 means the database is in shape. 1 means a step failed, and the last
   line says which and why. 2 means it could not run, for example because
   Postgres is down.

## What the script does

In order. The first failure stops the run.

| Step            | What it does                                                                                                                                                                                                                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment     | Checks the lines above: `multi`, `DATABASE_URL` connecting as `TENANCY_APP_ROLE`, `MIGRATE_DATABASE_URL` connecting as someone else, and a password set.                                                                                                                                                                   |
| App role        | Logs in as the app role and checks it can use the schema. If it cannot, runs `npm run db:tenancy:role -- --create`, which creates the role or re-applies its grants.                                                                                                                                                       |
| Policies        | Runs `npm run db:tenancy:enable`, which turns row-level security on and forces it on every tenant-owned table. It prints `no change` when they are already on.                                                                                                                                                             |
| OpenAI provider | Creates the `openai` provider row from the platform's known-provider entry if it is missing: OpenAI-compatible, `https://api.openai.com/v1`, key read from `OPENAI_API_KEY`. No seed creates it. An inactive row is reported, not changed.                                                                                 |
| Embedding model | Sets `text-embedding-3-small` (1536 dimensions, the size of the vector columns) as the active embedding model if none is set. Another model already set is reported, not overwritten: switching models means re-embedding, so do it on `/admin/orchestration/settings`. The model row itself comes from `npm run db:seed`. |
| Drift check     | Runs `npm run db:drift-check` at `multi` as the app role: every policy exists, and RLS is enabled and forced on every tenant-owned table.                                                                                                                                                                                  |

The platform's own account of each step is in
[`multi-tenancy.md`](../architecture/multi-tenancy.md#enabling-it-end-to-end)
and [`isolation.md`](../tenancy/isolation.md#the-role-split).

## After `npm run db:reset`

A reset rebuilds the schema from the migrations. The app role survives but
loses its grants, and the policies come back switched off. **Run the script
before you start the app again.** Until it has run, an app at `multi` sees every
workspace's rows. The reset re-seeds as the owner on its own. The script then
re-grants the role, re-enables the policies, and puts back the provider row and
the embedding model.

## Gotchas

- **Never point `DATABASE_URL` at the owner.** On a superuser or a `BYPASSRLS`
  role the policies do nothing, and every isolation check passes without
  checking anything. The script refuses a `DATABASE_URL` that does not connect
  as `TENANCY_APP_ROLE`.
- **`docker-compose.yml`'s `web` service connects as `postgres`.** That is the
  single-tenant shape. To run the app at `multi` under Compose, give it the app
  role's DSN as above, with host `db` in place of `localhost`.
- **Changing the app role's password.** Change it in both
  `TENANCY_APP_ROLE_PASSWORD` and `DATABASE_URL`, then run the script. The app
  role can no longer log in, so the script runs `db:tenancy:role -- --create`,
  which sets the new password.

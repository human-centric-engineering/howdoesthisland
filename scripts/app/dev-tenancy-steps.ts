/**
 * The steps behind `scripts/app/dev-tenancy.ts`: bring a development database
 * to the multi-tenant shape this app runs on, and prove it.
 *
 * Kept apart from the CLI entry so each step can be tested with its
 * dependencies injected. Every step is idempotent: on a database already in
 * shape, each reports `unchanged` and a second run writes nothing.
 *
 *  1. **Environment.** `TENANCY_MODE=multi`, the app role's DSN in
 *     `DATABASE_URL` and the owner's in `MIGRATE_DATABASE_URL`. The role name
 *     must be project-specific: roles are cluster-wide, and other HCE apps
 *     share this Postgres, so the platform default `sunrise_app` would be
 *     shared with them.
 *  2. **App role.** If the app role can log in and use the schema, it is left
 *     alone. Otherwise `db:tenancy:role -- --create` makes it, or re-grants it
 *     after a `db:reset` dropped its grants.
 *  3. **Policies.** `db:tenancy:enable`, which is idempotent on its own.
 *  4. **OpenAI provider row.** Created from the platform's known-provider entry
 *     if missing. No seed creates it (the provider models are seeded, the
 *     provider row is not), and the embedder needs it.
 *  5. **Active embedding model.** `text-embedding-3-small` (1536 dimensions,
 *     the size of the vector columns), set if none is set. A different model
 *     already set is reported, not overwritten: changing it means re-embedding.
 *  6. **Drift check.** `db:drift-check` at `multi`, as the app role.
 *
 * @see .context/app/dev-environment.md
 * @see .context/architecture/multi-tenancy.md#enabling-it-end-to-end
 */

import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { KNOWN_PROVIDERS } from '@/lib/orchestration/llm/known-providers';

/** The platform's default app-role name, which this app must not use. */
export const PLATFORM_DEFAULT_ROLE = 'sunrise_app';

/** The provider the app's judges and embedder run on (D8). */
export const PROVIDER_SLUG = 'openai';

/** The embedding model, by its `AiProviderModel.slug` from seed 009. */
export const EMBEDDING_MODEL_SLUG = 'openai-text-embedding-3-small';

/** The dimension the vector columns are sized for. */
export const EMBEDDING_DIMENSIONS = 1536;

/** A setup step could not bring the database into shape. Exit 1. */
export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

export type StepOutcome = 'created' | 'updated' | 'unchanged';

export interface StepResult {
  step: string;
  outcome: StepOutcome;
  detail: string;
}

function dsnPart(dsn: string, part: 'username' | 'password' | 'pathname'): string | null {
  try {
    return decodeURIComponent(new URL(dsn)[part]) || null;
  } catch {
    return null;
  }
}

function dsnUser(dsn: string): string | null {
  return dsnPart(dsn, 'username');
}

const postgresDsn = z
  .string()
  .min(1)
  .refine((v) => /^postgres(ql)?:\/\//.test(v) && dsnUser(v) !== null, {
    message: 'must be a postgresql:// URL with a user name',
  });

const envSchema = z
  .object({
    TENANCY_MODE: z.literal('multi', { message: 'must be "multi"' }),
    DATABASE_URL: postgresDsn,
    MIGRATE_DATABASE_URL: postgresDsn,
    TENANCY_APP_ROLE: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/, { message: 'must be a lowercase Postgres role name' })
      .refine((v) => v !== PLATFORM_DEFAULT_ROLE, {
        message: `must be project-specific, not "${PLATFORM_DEFAULT_ROLE}": roles are cluster-wide and other apps share this Postgres`,
      }),
    TENANCY_APP_ROLE_PASSWORD: z.string().min(1, { message: 'must be set' }),
  })
  .superRefine((env, ctx) => {
    if (dsnUser(env.DATABASE_URL) !== env.TENANCY_APP_ROLE) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'must connect as TENANCY_APP_ROLE',
      });
    }
    // db:tenancy:role sets the password from TENANCY_APP_ROLE_PASSWORD; a DSN
    // carrying another one could never log in, however often the role is reset.
    if (dsnPart(env.DATABASE_URL, 'password') !== env.TENANCY_APP_ROLE_PASSWORD) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'must carry TENANCY_APP_ROLE_PASSWORD as its password',
      });
    }
    // The role is granted, and the policies enabled, through the owner DSN;
    // the probe and the drift check run through the app DSN.
    if (dsnPart(env.DATABASE_URL, 'pathname') !== dsnPart(env.MIGRATE_DATABASE_URL, 'pathname')) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'must name the same database as MIGRATE_DATABASE_URL',
      });
    }
    if (dsnUser(env.MIGRATE_DATABASE_URL) === env.TENANCY_APP_ROLE) {
      ctx.addIssue({
        code: 'custom',
        path: ['MIGRATE_DATABASE_URL'],
        message: 'must connect as the owner, not TENANCY_APP_ROLE',
      });
    }
  });

export type DevTenancyEnv = z.infer<typeof envSchema>;

/** Validate the environment the setup needs; throws a `SetupError` naming every problem. */
export function parseEnv(env: Record<string, string | undefined>): DevTenancyEnv {
  const parsed = envSchema.safeParse(env);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'} ${i.message}`);
  throw new SetupError(`the environment is not set up for multi:\n  - ${problems.join('\n  - ')}`);
}

/** What the app role can do, asked as the app role itself. */
export interface AppRoleProbe {
  /** It logged in with the DSN's password. */
  connected: boolean;
  /** It has USAGE on the schema and DML on a tenant table. */
  usable: boolean;
}

/** Runs `npm run <script> -- <args>`; resolves to its exit status. */
export type RunNpm = (script: string, args?: readonly string[]) => number;

export async function ensureAppRole(
  probe: () => Promise<AppRoleProbe>,
  runNpm: RunNpm
): Promise<StepResult> {
  const before = await probe();
  if (before.connected && before.usable) {
    return { step: 'app role', outcome: 'unchanged', detail: 'logs in and can use the schema' };
  }
  const status = runNpm('db:tenancy:role', ['--create']);
  if (status !== 0) throw new SetupError(`db:tenancy:role --create exited ${status}`);
  const after = await probe();
  if (!after.connected || !after.usable) {
    throw new SetupError(
      'the app role still cannot log in and use the schema after db:tenancy:role --create'
    );
  }
  return {
    step: 'app role',
    outcome: before.connected ? 'updated' : 'created',
    // A refused login is a missing role or a changed password; Postgres does not say which.
    detail: before.connected ? 'grants re-applied' : 'created, or password reset, and granted',
  };
}

export function enablePolicies(runNpm: RunNpm): StepResult {
  const status = runNpm('db:tenancy:enable');
  if (status !== 0) throw new SetupError(`db:tenancy:enable exited ${status}`);
  // The enable script prints its own "no change" or what it enabled.
  return { step: 'policies', outcome: 'unchanged', detail: 'db:tenancy:enable passed' };
}

/** The slice of the client these steps use: global rows, not tenant-owned. */
export type SetupDb = Pick<
  PrismaClient,
  'aiProviderConfig' | 'aiProviderModel' | 'aiOrchestrationSettings'
>;

export async function ensureOpenAiProvider(db: SetupDb): Promise<StepResult> {
  const known = KNOWN_PROVIDERS.find((p) => p.slug === PROVIDER_SLUG);
  if (!known) throw new SetupError(`no known provider "${PROVIDER_SLUG}"`);

  const existing = await db.aiProviderConfig.findUnique({
    where: { slug: PROVIDER_SLUG },
    select: { isActive: true, apiKeyEnvVar: true },
  });
  if (existing) {
    if (!existing.isActive) {
      throw new SetupError(
        `the "${PROVIDER_SLUG}" provider exists but is inactive; reactivate it at /admin/orchestration/providers`
      );
    }
    return {
      step: 'OpenAI provider',
      outcome: 'unchanged',
      detail: `active, key from ${existing.apiKeyEnvVar ?? '(none)'}`,
    };
  }

  const apiKeyEnvVar = known.apiKeyEnvVars[0];
  await db.aiProviderConfig.create({
    data: {
      name: known.name,
      slug: known.slug,
      providerType: known.providerType,
      baseUrl: known.defaultBaseUrl,
      apiKeyEnvVar,
      isLocal: known.isLocal,
      isActive: true,
    },
  });
  return { step: 'OpenAI provider', outcome: 'created', detail: `key from ${apiKeyEnvVar}` };
}

export async function ensureEmbeddingModel(db: SetupDb): Promise<StepResult> {
  const model = await db.aiProviderModel.findUnique({
    where: { slug: EMBEDDING_MODEL_SLUG },
    select: { id: true, isActive: true, dimensions: true, capabilities: true },
  });
  if (!model) {
    throw new SetupError(`model "${EMBEDDING_MODEL_SLUG}" is missing; run npm run db:seed first`);
  }
  if (
    !model.isActive ||
    !model.capabilities.includes('embedding') ||
    model.dimensions !== EMBEDDING_DIMENSIONS
  ) {
    throw new SetupError(
      `model "${EMBEDDING_MODEL_SLUG}" must be active, embedding-capable and ${EMBEDDING_DIMENSIONS}-dimensional`
    );
  }

  const settings = await db.aiOrchestrationSettings.findUnique({
    where: { slug: 'global' },
    select: { activeEmbeddingModelId: true },
  });
  if (settings?.activeEmbeddingModelId === model.id) {
    return { step: 'embedding model', outcome: 'unchanged', detail: EMBEDDING_MODEL_SLUG };
  }
  if (settings?.activeEmbeddingModelId) {
    throw new SetupError(
      `a different active embedding model is set; switching it means re-embedding, so change it deliberately at /admin/orchestration/settings`
    );
  }

  // The platform creates this singleton lazily on first read, and merges an
  // empty `defaultModels` with its computed defaults, so `{}` is its own shape.
  await db.aiOrchestrationSettings.upsert({
    where: { slug: 'global' },
    create: { slug: 'global', defaultModels: {}, activeEmbeddingModelId: model.id },
    update: { activeEmbeddingModelId: model.id },
  });
  return {
    step: 'embedding model',
    outcome: settings ? 'updated' : 'created',
    detail: EMBEDDING_MODEL_SLUG,
  };
}

export function runDriftCheck(runNpm: RunNpm): StepResult {
  const status = runNpm('db:drift-check');
  if (status !== 0) throw new SetupError(`db:drift-check exited ${status}`);
  return { step: 'drift check', outcome: 'unchanged', detail: 'passed at multi' };
}

export interface SetupDeps {
  env: Record<string, string | undefined>;
  probeAppRole: () => Promise<AppRoleProbe>;
  runNpm: RunNpm;
  /** Opened only after the role and policies are in place; closed by the caller. */
  db: () => SetupDb;
}

/** Run every step in order; the first failure stops the run. */
export async function runDevTenancySetup(deps: SetupDeps): Promise<StepResult[]> {
  parseEnv(deps.env);
  const results: StepResult[] = [];
  results.push(await ensureAppRole(deps.probeAppRole, deps.runNpm));
  results.push(enablePolicies(deps.runNpm));
  const db = deps.db();
  results.push(await ensureOpenAiProvider(db));
  results.push(await ensureEmbeddingModel(db));
  results.push(runDriftCheck(deps.runNpm));
  return results;
}

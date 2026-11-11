/**
 * Bring the development database to the multi-tenant shape this app runs on,
 * and prove it. Idempotent: a second run reports every step `unchanged`.
 *
 *   npx tsx --env-file=.env.local scripts/app/dev-tenancy.ts
 *
 * Run after `npm run db:migrate:deploy` and `npm run db:seed`, and again after
 * `npm run db:reset`. The steps and their reasons are in
 * `scripts/app/dev-tenancy-steps.ts`; the setup is in
 * `.context/app/dev-environment.md`.
 *
 * Exit 0 in shape, 1 a step failed, 2 could not run.
 */

import { spawnSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client, Pool } from 'pg';
import { logger } from '@/lib/logging';
import { ownerDsn } from '@/lib/tenancy/isolation';
import {
  SetupError,
  runDevTenancySetup,
  type AppRoleProbe,
  type RunNpm,
} from '@/scripts/app/dev-tenancy-steps';

/** Postgres refuses the login: wrong password, or no such role. */
const LOGIN_REFUSED = new Set(['28P01', '28000']);

/**
 * The role logged in but cannot use the schema. Without USAGE the schema drops
 * out of the search path, so `"user"` does not resolve (42P01) — the state a
 * `db:reset` leaves, since it recreates the schema and its grants go with it.
 * With USAGE but no table grant, the privilege check itself can refuse (42501).
 */
const SCHEMA_UNUSABLE = new Set(['42501', '42P01']);

function errorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  return typeof err.code === 'string' ? err.code : undefined;
}

async function probeAppRole(): Promise<AppRoleProbe> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
  } catch (err) {
    if (LOGIN_REFUSED.has(errorCode(err) ?? '')) return { connected: false, usable: false };
    throw err;
  }
  try {
    const { rows } = await client.query<{ usable: boolean }>(
      `SELECT has_schema_privilege(current_schema(), 'USAGE')
          AND has_table_privilege('"user"', 'SELECT,INSERT,UPDATE,DELETE') AS usable`
    );
    return { connected: true, usable: rows[0]?.usable === true };
  } catch (err) {
    if (SCHEMA_UNUSABLE.has(errorCode(err) ?? '')) return { connected: true, usable: false };
    throw err;
  } finally {
    await client.end();
  }
}

const runNpm: RunNpm = (script, args = []) => {
  const npmArgs = ['run', '--silent', script, ...(args.length > 0 ? ['--', ...args] : [])];
  const result = spawnSync('npm', npmArgs, {
    stdio: 'inherit',
    env: { ...process.env, TENANCY_MODE: 'multi' },
  });
  return result.status ?? 1;
};

async function main(): Promise<number> {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY is not set: the provider row will exist, but calls will fail');
  }
  const pool = new Pool({ connectionString: ownerDsn() });
  const opened: { prisma?: PrismaClient } = {};
  try {
    const results = await runDevTenancySetup({
      env: process.env,
      probeAppRole,
      runNpm,
      db: () => {
        opened.prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
        return opened.prisma;
      },
    });
    for (const r of results) logger.info(`${r.step}: ${r.outcome} (${r.detail})`);
    logger.info('Dev database is multi-tenant and in shape');
    return 0;
  } catch (err) {
    if (err instanceof SetupError) {
      logger.error(`Dev tenancy setup failed: ${err.message}`);
      return 1;
    }
    logger.error('Dev tenancy setup could not run', err);
    return 2;
  } finally {
    await opened.prisma?.$disconnect();
    await pool.end();
  }
}

void main().then((code) => process.exit(code));

/**
 * The app's own slice of `Org.settings`: the `app` key (t-26).
 *
 * Core owns the other keys (`retention`, `quotas`, `providers`,
 * `platformAgents`, `privacy`) and writes each with its own slice writer. This
 * is the one writer for `app`, used by everything that keeps workspace config
 * there: the signup-workspace marker (`./provision.ts`) and the retention
 * window (`lib/app/retention/settings.ts`). It never touches another key.
 *
 * The write is a serializable read-modify-write, as core's own (unexported)
 * `writeSettingsSlice` in `lib/tenancy/org-settings.ts` is: two writes to the
 * same org, to any key, cannot both commit from the same read, so neither
 * loses the other's change. The loser fails with `P2034`, and the writer
 * retries it on a fresh read.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { isSettingsWriteConflict } from '@/lib/tenancy/org-settings';

/** The key this app keeps its own org config under, inside `Org.settings`. */
export const APP_SETTINGS_KEY = 'app';

/**
 * Tries at a settings write. A concurrent write to the same org (the
 * platform-agents marker `createOrg`'s reconcile writes, an admin saving
 * another slice) fails one of them with `P2034`, which a retry clears.
 */
const SETTINGS_WRITE_ATTEMPTS = 3;

/** Run a settings write, retrying it on a serializable clash. */
export async function withSettingsConflictRetry<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (attempt >= SETTINGS_WRITE_ATTEMPTS || !isSettingsWriteConflict(error)) throw error;
    }
  }
}

/** The `app` slice of a stored `settings` column, or `{}` when it has none. */
export function readAppSettings(settings: unknown): Record<string, unknown> {
  if (!isJsonObject(settings)) return {};
  const app = settings[APP_SETTINGS_KEY];
  return isJsonObject(app) ? { ...app } : {};
}

/**
 * Change the `app` slice of one org's settings, keeping every other key.
 *
 * `edit` gets a copy of the slice as stored and changes it in place; it may
 * run more than once (a retried clash re-reads the row). An emptied slice
 * drops the `app` key. An emptied column is stored as `{}`, which every
 * slice reader reads as nothing set: SQL `NULL` would need `Prisma.DbNull`,
 * a runtime Prisma import `lib/app/**` may not make.
 *
 * @returns the slice as written, or `null` when there is no such org.
 */
export async function writeAppSettings(
  orgId: string,
  edit: (app: Record<string, unknown>) => void,
  db: Pick<PrismaClient, '$transaction'> = prisma
): Promise<Record<string, unknown> | null> {
  return withSettingsConflictRetry(() =>
    db.$transaction(
      async (tx) => {
        const row = await tx.org.findUnique({ where: { id: orgId }, select: { settings: true } });
        if (!row) return null;
        const settings: Record<string, unknown> = isJsonObject(row.settings)
          ? { ...row.settings }
          : {};
        const app = readAppSettings(row.settings);
        edit(app);
        if (Object.keys(app).length > 0) settings[APP_SETTINGS_KEY] = app;
        else delete settings[APP_SETTINGS_KEY];
        await tx.org.update({
          where: { id: orgId },
          data: { settings: settings as Prisma.InputJsonObject },
        });
        return app;
      },
      { isolationLevel: 'Serializable' }
    )
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

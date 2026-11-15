/**
 * A workspace's retention window for its content and assessments (t-26, D10).
 *
 * Stored at `Org.settings.app.retention` as `{ days }`; absent means no
 * window, and the workspace keeps what it submits. Set through
 * `PATCH /api/v1/workspaces/{id}/settings` and applied by the purge job
 * (`./purge.ts`).
 *
 * This is not core's `settings.retention` slice. That one governs core's own
 * history (conversations, executions, cost logs, evaluations, webhooks) and
 * knows nothing of the app's tables; this governs only the app's.
 */
import { z } from 'zod';
import { logger } from '@/lib/logging';
import { readAppSettings, writeAppSettings } from '@/lib/app/workspaces/app-settings';

/** The key inside the `app` slice. */
export const APP_RETENTION_KEY = 'retention';

/** The longest window a workspace may set: ten years, as core's longest. */
export const MAX_RETENTION_DAYS = 3650;

/**
 * How long a judge run's reply is kept, whatever the window (D10). The
 * assembled result on the assessment is what is read afterwards.
 */
export const JUDGE_REPLY_RETENTION_DAYS = 30;

export const appRetentionSchema = z
  .object({
    days: z
      .number()
      .int('Retention must be a whole number of days')
      .min(1, 'Retention must be at least 1 day')
      .max(MAX_RETENTION_DAYS, `Retention can be at most ${MAX_RETENTION_DAYS} days`),
  })
  .strict();

export type AppRetention = z.infer<typeof appRetentionSchema>;

/** `PATCH /api/v1/workspaces/{id}/settings`: a window, or `null` for none. */
export const updateWorkspaceSettingsSchema = z
  .object({ retention: appRetentionSchema.nullable() })
  .strict();

export type WorkspaceSettings = { retention: AppRetention | null };

/**
 * The window a stored `settings` column sets, or `null` for none. A stored
 * value that does not parse is read as none and logged: purging on a window
 * nobody can read would delete what the workspace may have meant to keep.
 */
export function readAppRetention(settings: unknown, orgId?: string): AppRetention | null {
  const stored = readAppSettings(settings)[APP_RETENTION_KEY];
  if (stored === undefined || stored === null) return null;
  const parsed = appRetentionSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  logger.warn('Unreadable app retention window; keeping everything', { orgId });
  return null;
}

/**
 * Set (`{ days }`) or clear (`null`) a workspace's window.
 *
 * @returns the settings as written, or `null` when there is no such org.
 */
export async function writeAppRetention(
  orgId: string,
  retention: AppRetention | null
): Promise<WorkspaceSettings | null> {
  const app = await writeAppSettings(orgId, (slice) => {
    if (retention) slice[APP_RETENTION_KEY] = { days: retention.days };
    else delete slice[APP_RETENTION_KEY];
  });
  if (!app) return null;
  return { retention: retention ? { days: retention.days } : null };
}

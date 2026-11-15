/**
 * A workspace's retention windows (t-26, D10).
 *
 * Two, both in `Org.settings.app` and both set through
 * `PATCH /api/v1/workspaces/{id}/settings` by an owner or admin:
 *
 * - `retention: { days }` — how long content and its assessments are kept.
 *   Absent means no window: the workspace keeps what it submits.
 * - `judgeReplyRetention: { days }` — how long each judge's reply
 *   (`JudgeReply`) is kept. Absent means {@link DEFAULT_JUDGE_REPLY_DAYS}.
 *   The judge run itself, with its model, cost and timing, stays as long as
 *   its assessment.
 *
 * A stored window that does not parse is never purged on: for content that
 * is the same as no window, and for replies it means none are deleted until
 * the window is set again (read as `null`). Falling back to the default
 * could delete replies a longer stored window meant to keep.
 *
 * The purge job (`./purge.ts`) applies both.
 *
 * Neither is core's `settings.retention` slice. That one governs core's own
 * history (conversations, executions, cost logs, evaluations, webhooks) and
 * knows nothing of the app's tables.
 */
import { z } from 'zod';
import { logger } from '@/lib/logging';
import { readAppSettings, writeAppSettings } from '@/lib/app/workspaces/app-settings';

/** The content window's key inside the `app` slice. */
export const APP_RETENTION_KEY = 'retention';

/** The reply window's key inside the `app` slice. */
export const JUDGE_REPLY_RETENTION_KEY = 'judgeReplyRetention';

/** The longest content window: ten years, as core's longest. */
export const MAX_RETENTION_DAYS = 3650;

/** How long a judge's reply is kept when the workspace has not said (D10). */
export const DEFAULT_JUDGE_REPLY_DAYS = 30;

/**
 * The longest reply window. A reply quotes the text, and D10 keeps it for
 * weeks, not years; a year leaves room for a workspace that audits replies.
 */
export const MAX_JUDGE_REPLY_DAYS = 365;

const days = (max: number, what: string) =>
  z
    .number()
    .int(`${what} must be a whole number of days`)
    .min(1, `${what} must be at least 1 day`)
    .max(max, `${what} can be at most ${max} days`);

export const appRetentionSchema = z
  .object({ days: days(MAX_RETENTION_DAYS, 'Retention') })
  .strict();

export const judgeReplyRetentionSchema = z
  .object({ days: days(MAX_JUDGE_REPLY_DAYS, 'Judge reply retention') })
  .strict();

export type AppRetention = z.infer<typeof appRetentionSchema>;
export type JudgeReplyRetention = z.infer<typeof judgeReplyRetentionSchema>;

/**
 * `PATCH /api/v1/workspaces/{id}/settings`. A key left out is unchanged.
 * `retention: null` keeps content for good; `judgeReplyRetention: null`
 * returns replies to the default.
 */
export const updateWorkspaceSettingsSchema = z
  .object({
    retention: appRetentionSchema.nullable().optional(),
    judgeReplyRetention: judgeReplyRetentionSchema.nullable().optional(),
  })
  .strict()
  .refine((body) => body.retention !== undefined || body.judgeReplyRetention !== undefined, {
    message: 'Give retention, judgeReplyRetention or both',
  });

export type WorkspaceSettingsPatch = z.infer<typeof updateWorkspaceSettingsSchema>;

/**
 * The windows in force. `judgeReplyRetention` is the default when unset, and
 * `null` only when the stored window is unreadable: no reply is deleted then.
 */
export type WorkspaceSettings = {
  retention: AppRetention | null;
  judgeReplyRetention: JudgeReplyRetention | null;
};

/** A stored window: absent, read, or present but not readable. */
type Stored<T> = { state: 'absent' } | { state: 'set'; value: T } | { state: 'unreadable' };

function readWindow<T>(
  app: Record<string, unknown>,
  key: string,
  schema: z.ZodType<T>,
  purgeOrgId?: string
): Stored<T> {
  const stored = app[key];
  if (stored === undefined || stored === null) return { state: 'absent' };
  const parsed = schema.safeParse(stored);
  if (parsed.success) return { state: 'set', value: parsed.data };
  if (purgeOrgId) {
    logger.warn('Unreadable app retention window; purging nothing on it', {
      orgId: purgeOrgId,
      key,
    });
  }
  return { state: 'unreadable' };
}

/**
 * The windows a stored `settings` column sets, defaults filled in.
 *
 * @param purgeOrgId the purge passes its org, to log an unreadable window
 *   once a pass; a settings read or write does not, and logs nothing.
 */
export function readWorkspaceSettings(settings: unknown, purgeOrgId?: string): WorkspaceSettings {
  return settingsOf(readAppSettings(settings), purgeOrgId);
}

function settingsOf(app: Record<string, unknown>, purgeOrgId?: string): WorkspaceSettings {
  const content = readWindow(app, APP_RETENTION_KEY, appRetentionSchema, purgeOrgId);
  const reply = readWindow(app, JUDGE_REPLY_RETENTION_KEY, judgeReplyRetentionSchema, purgeOrgId);
  return {
    retention: content.state === 'set' ? content.value : null,
    judgeReplyRetention:
      reply.state === 'set'
        ? reply.value
        : reply.state === 'absent'
          ? { days: DEFAULT_JUDGE_REPLY_DAYS }
          : null,
  };
}

/**
 * Apply a settings patch: a window sets its key, `null` removes it, and a
 * key left out of the patch is left as stored.
 *
 * @returns the windows in force after the write, or `null` when there is no
 *   such org.
 */
export async function writeWorkspaceSettings(
  orgId: string,
  patch: WorkspaceSettingsPatch
): Promise<WorkspaceSettings | null> {
  const app = await writeAppSettings(orgId, (slice) => {
    for (const [key, value] of [
      [APP_RETENTION_KEY, patch.retention],
      [JUDGE_REPLY_RETENTION_KEY, patch.judgeReplyRetention],
    ] as const) {
      if (value === undefined) continue;
      if (value === null) delete slice[key];
      else slice[key] = { days: value.days };
    }
  });
  return app ? settingsOf(app) : null;
}

/**
 * Purge what the current workspace keeps past its retention (t-26, D10).
 *
 * The maintenance tick runs this once a day per workspace (`lib/app/jobs.ts`).
 * The windows are read from `settings.app` (`./settings.ts`). Each pass:
 *
 * 1. **with a content window**: deletes the assessments created before it,
 *    with their judge runs and replies (FK cascade); then the content created
 *    before it that no assessment is left on. A content row a newer
 *    assessment still uses stays until that one ages out too, so a purge
 *    never takes an assessment inside the window with it.
 * 2. **always**: deletes judge replies (`JudgeReply`) older than the reply
 *    window, 30 days unless the workspace set another. The judge run keeps
 *    its status, model, cost, tokens and timing, and the assessment's
 *    assembled `result` is what everything reads once it is final.
 *
 * Assessments still `QUEUED` or `RUNNING` are left alone, and so are their
 * judges' replies: a run re-driven by the recovery job reads its finished
 * judges' replies back. So is a `CANCELLED` one that may still have judges
 * in flight: they can land on it after the cancel (`saveJudgeRun`). Its lease
 * is no guide, because a cancelled run stops renewing it, so it lapses while
 * judges are still out. One is taken once its judges have all landed
 * (`freePlace` clears the lease) or {@link CANCEL_GRACE_MS} after the cancel,
 * past any judge's timeout and retries. The recovery job finishes or fails
 * the live ones, and a later pass takes them.
 *
 * An assessment's cached report PDFs (t-31, `lib/app/reports/pdf/cache.ts`)
 * are deleted before its row. One whose files storage would not delete is
 * kept for the next pass, so a PDF never outlives its window with nothing
 * left to find it by. They are swept once more after the rows go, for a
 * render that raced the purge (`sweepReportPdfs`).
 *
 * An unreadable stored window purges nothing on it (`./settings.ts`).
 *
 * Idempotent: a second pass finds nothing older than either window, and
 * changes nothing.
 */
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import { logger } from '@/lib/logging';
import { readWorkspaceSettings } from '@/lib/app/retention/settings';
import { deleteReportPdfs, sweepReportPdfs } from '@/lib/app/reports/pdf/cache';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses whose rows a run may still be reading or writing. */
const LIVE = ['QUEUED', 'RUNNING'] as const;

/**
 * How long after a cancel its judges in flight may still land. The longest
 * judge timeout is five minutes; an hour covers that with its retries.
 */
export const CANCEL_GRACE_MS = 60 * 60 * 1000;

/**
 * An assessment no run can still write to: not live, and either holding no
 * lease (every final state but a cancel with judges out clears it) or ended
 * (`completedAt`, which a cancel sets) more than {@link CANCEL_GRACE_MS} ago.
 */
const settled = (now: Date) => ({
  status: { notIn: [...LIVE] },
  OR: [
    { leaseExpiresAt: null },
    { completedAt: { lt: new Date(now.getTime() - CANCEL_GRACE_MS) } },
  ],
});

export interface PurgeResult {
  /** Assessments deleted past the content window (their judge runs went with them). */
  assessments: number;
  /** Content rows deleted past the content window. */
  contents: number;
  /** Judge replies deleted past the reply window. */
  replies: number;
}

export async function purgeExpiredContent(now: Date = new Date()): Promise<PurgeResult> {
  const orgId = requireOrgId();
  // `Org` is a system model: this read needs no tenant scope.
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } });
  const windows = readWorkspaceSettings(org?.settings ?? null, orgId);
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);

  let assessments = 0;
  let contents = 0;
  if (windows.retention) {
    const cutoff = before(windows.retention.days);
    const expired = { orgId, createdAt: { lt: cutoff }, ...settled(now) };
    const ids = await withoutReportPdfs(
      orgId,
      await prisma.assessment.findMany({ where: expired, select: { id: true } })
    );
    if (ids.length > 0) {
      ({ count: assessments } = await prisma.assessment.deleteMany({
        where: { ...expired, id: { in: ids } },
      }));
      await sweepReportPdfs(orgId, ids);
    }
    ({ count: contents } = await prisma.content.deleteMany({
      where: { orgId, createdAt: { lt: cutoff }, assessments: { none: {} } },
    }));
  }

  let replies = 0;
  if (windows.judgeReplyRetention) {
    ({ count: replies } = await prisma.judgeReply.deleteMany({
      where: {
        orgId,
        createdAt: { lt: before(windows.judgeReplyRetention.days) },
        judgeRun: { assessment: settled(now) },
      },
    }));
  }

  return { assessments, contents, replies };
}

/**
 * Delete each assessment's cached report PDFs, and return the ids whose files
 * are gone. One storage refused is left out and logged, so its row stays for
 * the next pass.
 */
async function withoutReportPdfs(orgId: string, rows: { id: string }[]): Promise<string[]> {
  const cleared: string[] = [];
  for (const { id } of rows) {
    try {
      await deleteReportPdfs(orgId, id);
      cleared.push(id);
    } catch (err) {
      logger.warn('Retention purge: kept an assessment whose report PDFs could not be deleted', {
        assessmentId: id,
        err,
      });
    }
  }
  return cleared;
}

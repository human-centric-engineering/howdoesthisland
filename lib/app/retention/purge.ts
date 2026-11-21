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
 * in flight: they can land on it after the cancel (`saveJudgeRun`). A lease
 * that ran out is no guide, because a renewal can fail while the run lives
 * (the run renews a cancelled one until its judges land, `run.ts`). One is taken once its judges have all landed
 * (`freePlace` clears the lease, as does the recovery job's charge of one
 * whose run died, t-58) or {@link CHARGE_SWEEP_MS} after the cancel, past any
 * judge's timeout and retries and the recovery job's charge. The recovery job
 * finishes or fails the live ones, and a later pass takes them.
 *
 * An assessment's cached report PDFs (t-31, `lib/app/reports/pdf/cache.ts`)
 * are deleted before its row. One whose files storage would not delete is
 * kept for the next pass, so a PDF never outlives its window with nothing
 * left to find it by. They are swept once more after the rows go, for a
 * render that raced the purge (`sweepReportPdfs`). This runs in batches of
 * {@link PURGE_BATCH}, and only where storage can cache PDFs at all;
 * elsewhere expired assessments go in one `deleteMany`, as before.
 *
 * An unreadable stored window purges nothing on it (`./settings.ts`).
 *
 * Idempotent: a second pass finds nothing older than either window, and
 * changes nothing.
 */
import { CHARGE_SWEEP_MS } from '@/lib/app/assessments/limits';
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import { logger } from '@/lib/logging';
import { readWorkspaceSettings } from '@/lib/app/retention/settings';
import type { Prisma } from '@prisma/client';
import { deleteReportPdfs, reportPdfStore, sweepReportPdfs } from '@/lib/app/reports/pdf/cache';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses whose rows a run may still be reading or writing. */
const LIVE = ['QUEUED', 'RUNNING'] as const;

/**
 * An assessment no run can still write to: not live, and either holding no
 * lease (every final state but a cancel with judges out clears it) or ended
 * (`completedAt`, which a cancel sets) more than {@link CHARGE_SWEEP_MS} ago.
 */
const settled = (now: Date) => ({
  status: { notIn: [...LIVE] },
  OR: [
    { leaseExpiresAt: null },
    // A cancel whose lease is still set is not charged yet: the recovery job
    // charges it and clears the lease (t-58). A day on, it never will.
    { completedAt: { lt: new Date(now.getTime() - CHARGE_SWEEP_MS) } },
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
    assessments = reportPdfStore(orgId)
      ? await purgeWithReportPdfs(orgId, expired)
      : // No store that caches PDFs: there are no files to remove first.
        (await prisma.assessment.deleteMany({ where: expired })).count;
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

/** Expired assessments taken per round when their PDFs go first. */
export const PURGE_BATCH = 500;

type ExpiredWhere = Prisma.AssessmentWhereInput;

/**
 * Delete expired assessments a batch at a time, each one's cached PDFs
 * before its row. An assessment whose files storage refused is kept for the
 * next pass and left out of later batches. A batch in which nothing could be
 * cleared ends the pass: storage is down, and trying every remaining row
 * would only fail the same way.
 */
async function purgeWithReportPdfs(orgId: string, expired: ExpiredWhere): Promise<number> {
  const kept: string[] = [];
  let deleted = 0;
  for (;;) {
    const batch = await prisma.assessment.findMany({
      where: kept.length > 0 ? { ...expired, id: { notIn: kept } } : expired,
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: PURGE_BATCH,
    });
    if (batch.length === 0) break;
    const cleared = await withoutReportPdfs(orgId, batch, kept);
    if (cleared.length === 0) break;
    deleted += (await prisma.assessment.deleteMany({ where: { ...expired, id: { in: cleared } } }))
      .count;
    await sweepReportPdfs(orgId, cleared);
    if (batch.length < PURGE_BATCH) break;
  }
  return deleted;
}

/**
 * Delete each assessment's cached report PDFs, and return the ids whose files
 * are gone. One storage refused goes into `kept` and is logged, so its row
 * stays for the next pass.
 */
async function withoutReportPdfs(
  orgId: string,
  rows: { id: string }[],
  kept: string[]
): Promise<string[]> {
  const cleared: string[] = [];
  for (const { id } of rows) {
    try {
      await deleteReportPdfs(orgId, id);
      cleared.push(id);
    } catch (err) {
      kept.push(id);
      logger.warn('Retention purge: kept an assessment whose report PDFs could not be deleted', {
        assessmentId: id,
        err,
      });
    }
  }
  return cleared;
}

/**
 * Purge what the current workspace keeps past its retention (t-26, D10).
 *
 * The maintenance tick runs this once per workspace (`lib/app/jobs.ts`).
 * Each pass:
 *
 * 1. **with a window** (`settings.app.retention`, `./settings.ts`): deletes
 *    the assessments created before it, and their judge runs (FK cascade);
 *    then the content created before it that no assessment is left on. A
 *    content row with a newer assessment on it stays until that one ages
 *    out too, so a purge never takes an assessment inside the window with it.
 * 2. **always**: clears the reply (`output`) and what post-validation dropped
 *    from it (`dropped`) on judge runs older than
 *    {@link JUDGE_REPLY_RETENTION_DAYS}. The assembled result on the
 *    assessment is what everything reads afterwards; the judge run keeps its
 *    status, cost, tokens and timing.
 *
 * Assessments still `QUEUED` or `RUNNING` are left alone, and so are their
 * judge runs: a run re-driven by the recovery job reads its finished judges'
 * replies back, and a row deleted under it would lose its work. The recovery
 * job finishes or fails them, and the next pass takes them.
 *
 * Idempotent: a second pass finds nothing older than the window, and no
 * reply left to clear, and changes nothing.
 */
import { prisma } from '@/lib/db/client';
import { requireOrgId } from '@/lib/tenancy/context';
import { JUDGE_REPLY_RETENTION_DAYS, readAppRetention } from '@/lib/app/retention/settings';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses whose rows a run may still be reading or writing. */
const LIVE = ['QUEUED', 'RUNNING'] as const;

export interface PurgeResult {
  /** Assessments deleted past the window (their judge runs went with them). */
  assessments: number;
  /** Content rows deleted past the window. */
  contents: number;
  /** Judge runs whose reply was cleared. */
  repliesCleared: number;
}

export async function purgeExpiredContent(now: Date = new Date()): Promise<PurgeResult> {
  const orgId = requireOrgId();
  // `Org` is a system model: this read needs no tenant scope.
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } });
  const window = org ? readAppRetention(org.settings, orgId) : null;

  let assessments = 0;
  let contents = 0;
  if (window) {
    const cutoff = new Date(now.getTime() - window.days * DAY_MS);
    ({ count: assessments } = await prisma.assessment.deleteMany({
      where: { orgId, createdAt: { lt: cutoff }, status: { notIn: [...LIVE] } },
    }));
    ({ count: contents } = await prisma.content.deleteMany({
      where: { orgId, createdAt: { lt: cutoff }, assessments: { none: {} } },
    }));
  }

  // Raw SQL because clearing a JSON column to SQL `NULL` takes
  // `Prisma.DbNull`, a runtime Prisma import `lib/app/**` may not make. It
  // runs under the tenant scope as any query does (the tenancy extension
  // sets the org on raw SQL too), and names the org besides.
  const replyCutoff = new Date(now.getTime() - JUDGE_REPLY_RETENTION_DAYS * DAY_MS);
  const repliesCleared = await prisma.$executeRaw`
    UPDATE "app_judge_run" AS r
       SET "output" = NULL, "dropped" = NULL, "updatedAt" = ${now}
      FROM "app_assessment" AS a
     WHERE a."id" = r."assessmentId"
       AND r."orgId" = ${orgId}
       AND r."createdAt" < ${replyCutoff}
       AND a."status"::text NOT IN ('QUEUED', 'RUNNING')
       AND (r."output" IS NOT NULL OR r."dropped" IS NOT NULL)`;

  return { assessments, contents, repliesCleared };
}

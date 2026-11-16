/**
 * Share links (t-32): a link that opens one report, read-only, for someone
 * without an account, until it expires or is revoked.
 *
 * Making, listing and revoking run in the caller's tenant context (the
 * route's guard), so another workspace's assessment or link is not found, as
 * for every assessments route. Any member may make or revoke a link to any of
 * the workspace's reports, as any member may read or delete the assessment.
 *
 * Opening one ({@link readSharedReport}) enters the link's org from its token
 * (`runAsShareOrg`). A revoked, expired or unknown token, a well-formed or
 * not, all open nothing, and the caller answers each as not found.
 */
import { APIError, NotFoundError } from '@/lib/api/errors';
import { getPublicUrl } from '@/lib/api/server-fetch';
import { prisma } from '@/lib/db/client';
import type { AssessmentStatus } from '@prisma/client';
import { logger } from '@/lib/logging';
import { requireOrgId } from '@/lib/tenancy/context';
import { getAssessment } from '@/lib/app/assessments/api/service';
import type { AssessmentDetail, JudgeRunView } from '@/lib/app/assessments/api/views';
import {
  FrameworkApiError,
  resolveVersion,
  versionDocument,
} from '@/lib/app/frameworks/api/service';
import { reportResultSchema } from '@/lib/app/reports/input';
import { runAsShareOrg, type ShareOrgRefusal } from '@/lib/app/reports/share/share-org';
import { mintShareToken, sharedReportPath } from '@/lib/app/reports/share/token';
import type { CreateShareInput } from '@/lib/app/reports/share/validations';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The statuses that store a result, which are the ones with a report. */
const REPORTABLE: ReadonlySet<AssessmentStatus> = new Set(['COMPLETED', 'PARTIAL']);

/** A link as its workspace sees it. The token is never shown again. */
export interface ReportShareView {
  id: string;
  state: 'active' | 'expired' | 'revoked';
  expiresAt: Date;
  revokedAt: Date | null;
  viewCount: number;
  createdAt: Date;
}

/** A link just made: the only answer that carries its token. */
export interface CreatedReportShare extends ReportShareView {
  token: string;
  /** The link to send, on the app's public address. */
  url: string;
}

/** What a share link serves of an assessment: the report's fields, nothing else. */
export type SharedAssessment = Pick<
  AssessmentDetail,
  | 'status'
  | 'profile'
  | 'judges'
  | 'framework'
  | 'title'
  | 'wordCount'
  | 'overall'
  | 'band'
  | 'createdAt'
  | 'completedAt'
  | 'text'
  | 'context'
  | 'result'
> & { judgeRuns: Pick<JudgeRunView, 'judge' | 'status' | 'model'>[] };

/** What a share link opens. */
export interface SharedReport {
  assessment: SharedAssessment;
  /** The model version it ran on, or `null` if that version no longer resolves. */
  model: Record<string, unknown> | null;
  expiresAt: Date;
}

type ShareRow = {
  id: string;
  expiresAt: Date;
  revokedAt: Date | null;
  viewCount: number;
  createdAt: Date;
};

const shareSelect = {
  id: true,
  expiresAt: true,
  revokedAt: true,
  viewCount: true,
  createdAt: true,
} as const;

function toView(row: ShareRow, now: Date): ReportShareView {
  const state = row.revokedAt ? 'revoked' : row.expiresAt <= now ? 'expired' : 'active';
  return { ...row, state };
}

/** 404 unless the assessment is in this workspace. */
async function requireAssessment(id: string, orgId: string): Promise<AssessmentStatus> {
  const row = await prisma.assessment.findUnique({
    where: { id, orgId },
    select: { status: true },
  });
  if (!row) throw new NotFoundError('Assessment not found');
  return row.status;
}

/**
 * Make a link to an assessment's report. Refused with 409 `REPORT_NOT_READY`
 * when it has no report (still running, failed or cancelled), as the PDF is.
 */
export async function createShare(
  assessmentId: string,
  input: CreateShareInput,
  userId: string | null,
  now: Date = new Date()
): Promise<CreatedReportShare> {
  const orgId = requireOrgId();
  const status = await requireAssessment(assessmentId, orgId);
  if (!REPORTABLE.has(status)) {
    throw new APIError(
      'This review has no report yet: it is still running, or it failed or was cancelled.',
      'REPORT_NOT_READY',
      409,
      { status: status.toLowerCase() }
    );
  }
  const { token, tokenHash } = mintShareToken();
  const row = await prisma.reportShare.create({
    data: {
      orgId,
      assessmentId,
      tokenHash,
      expiresAt: new Date(now.getTime() + input.expiresInDays * DAY_MS),
      createdByUserId: userId,
    },
    select: shareSelect,
  });
  logger.info('Share link made', { shareId: row.id, assessmentId });
  return { ...toView(row, now), token, url: `${getPublicUrl()}${sharedReportPath(token)}` };
}

/** An assessment's links, newest first, live or not. */
export async function listShares(
  assessmentId: string,
  now: Date = new Date()
): Promise<ReportShareView[]> {
  const orgId = requireOrgId();
  await requireAssessment(assessmentId, orgId);
  const rows = await prisma.reportShare.findMany({
    where: { assessmentId, orgId },
    select: shareSelect,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => toView(row, now));
}

/**
 * Revoke a link. Revoking one already revoked keeps the first time, so it is
 * safe to repeat; an expired one is revoked all the same.
 */
export async function revokeShare(id: string, now: Date = new Date()): Promise<ReportShareView> {
  const orgId = requireOrgId();
  await prisma.reportShare.updateMany({
    where: { id, orgId, revokedAt: null },
    data: { revokedAt: now },
  });
  const row = await prisma.reportShare.findUnique({ where: { id, orgId }, select: shareSelect });
  if (!row) throw new NotFoundError('Share link not found');
  logger.info('Share link revoked', { shareId: id });
  return toView(row, now);
}

/** Why a link opened nothing. The callers answer every one as not found. */
export type SharedReportRefusal = ShareOrgRefusal | 'closed' | 'no-report';

export type SharedReportRead =
  { ok: true; shareId: string; report: SharedReport } | { ok: false; refused: SharedReportRefusal };

/**
 * What `token` opens, counted as a view. Live means not revoked and not
 * expired, checked in the same write that counts the view, so a link revoked
 * a moment ago is not opened once more by a read already under way.
 */
export async function readSharedReport(
  token: string,
  now: Date = new Date()
): Promise<SharedReportRead> {
  const entered = await runAsShareOrg(token, async (shareId) => {
    const orgId = requireOrgId();
    const { count } = await prisma.reportShare.updateMany({
      where: { id: shareId, orgId, revokedAt: null, expiresAt: { gt: now } },
      data: { viewCount: { increment: 1 } },
    });
    if (count === 0) return { ok: false as const, refused: 'closed' as const };

    const share = await prisma.reportShare.findUnique({
      where: { id: shareId, orgId },
      select: { assessmentId: true, expiresAt: true },
    });
    // Deleted with its assessment since the write: nothing to open.
    if (!share) return { ok: false as const, refused: 'closed' as const };

    let assessment: AssessmentDetail;
    try {
      assessment = await getAssessment(share.assessmentId);
    } catch (err) {
      if (err instanceof NotFoundError) return { ok: false as const, refused: 'closed' as const };
      throw err;
    }
    // A link is made only for a report, and a final run stays final, so
    // this is a defect rather than a state, but it must not serve a half run.
    if (assessment.result === null || !isReportable(assessment.status)) {
      logger.error('Share link: its assessment has no report', undefined, {
        shareId,
        status: assessment.status,
      });
      return { ok: false as const, refused: 'no-report' as const };
    }

    // Only what the report reads of the result: see `sharedResult`.
    const result = sharedResult(assessment.result);
    if (result === null) {
      logger.error('Share link: its result is not one the report can read', undefined, {
        shareId,
        framework: assessment.framework,
      });
      return { ok: false as const, refused: 'no-report' as const };
    }

    const report: SharedReport = {
      assessment: sharedView(assessment, result),
      model: await modelOf(assessment),
      expiresAt: share.expiresAt,
    };
    return { ok: true as const, shareId, report };
  });

  if (!entered.ok) return entered;
  if (!entered.value.ok)
    logger.info('Share link opened nothing', { refused: entered.value.refused });
  return entered.value;
}

const isReportable = (state: AssessmentDetail['status']): boolean =>
  state === 'completed' || state === 'partial';

/** The fields a share serves, picked one by one, so a field added to the detail is not shared by default. */
function sharedView(a: AssessmentDetail, result: unknown): SharedAssessment {
  return {
    status: a.status,
    profile: a.profile,
    judges: a.judges,
    framework: a.framework,
    title: a.title,
    wordCount: a.wordCount,
    overall: a.overall,
    band: a.band,
    createdAt: a.createdAt,
    completedAt: a.completedAt,
    text: a.text,
    context: a.context,
    result,
    judgeRuns: a.judgeRuns.map((r) => ({ judge: r.judge, status: r.status, model: r.model })),
  };
}

/**
 * The result as the report reads it, and nothing more, or `null` when the
 * report cannot read it.
 *
 * The stored result holds more than the report shows, and some of it a link
 * must not serve: `source`, the URL the copy was fetched from (`assemble()`),
 * which can itself be a credential (a preview link, an "anyone with the link"
 * document), and the editor's `costUsd` (`withEditor`,
 * `lib/app/assessments/editor.ts`). So the result goes through the report's
 * own parser (`reportResultSchema`), which keeps only the keys the report
 * reads: an allowlist, as `sharedView` is for the assessment, so a key the
 * engine adds later is not shared by default. A result the report cannot
 * read would only render as unreadable, so it opens nothing.
 */
function sharedResult(result: unknown): Record<string, unknown> | null {
  const parsed = reportResultSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

async function modelOf(a: AssessmentDetail): Promise<Record<string, unknown> | null> {
  try {
    const { data } = await versionDocument(
      await resolveVersion(a.framework.slug, a.framework.version)
    );
    return data;
  } catch (err) {
    if (err instanceof FrameworkApiError) return null;
    throw err;
  }
}

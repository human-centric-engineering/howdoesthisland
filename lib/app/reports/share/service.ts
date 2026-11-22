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
  reportAssessmentSchema,
  reportModelSchema,
  reportResultSchema,
} from '@/lib/app/reports/input';
import { hasReport } from '@/lib/app/reports/reportable';
import { getFrameworkDefinition } from '@/lib/app/frameworks/registry';
import { asOnTheWire, loadModelDocument } from '@/lib/app/reports/pdf/print-source';
import { runAsShareOrg, type ShareOrgRefusal } from '@/lib/app/reports/share/share-org';
import { mintShareToken, sharedReportPath } from '@/lib/app/reports/share/token';
import type { CreateShareInput } from '@/lib/app/reports/share/validations';

const DAY_MS = 24 * 60 * 60 * 1000;

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
  | 'result'
> & { judgeRuns: Pick<JudgeRunView, 'judge' | 'status' | 'model'>[] };

/** What a share link opens. */
export interface SharedReport {
  assessment: SharedAssessment;
  /**
   * What the report shows of the model version it ran on, for the
   * `/r/{token}` page to render on the server; `null` when the report cannot
   * be read. Never sent to a browser or over the API: the model is IP (t-67).
   */
  model: Record<string, unknown> | null;
  /** The version's catalogue, for the API reader only (`null` for the page, or when unreadable). */
  catalogue: Record<string, unknown> | null;
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

/**
 * Prisma's P2003, a foreign key that no longer resolves, read by its code:
 * `lib/app` does not import Prisma's runtime, only its types.
 */
function isForeignKeyFailure(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2003';
}

/** 404 unless the assessment is in this workspace. */
async function requireAssessment(
  id: string,
  orgId: string
): Promise<{ status: AssessmentStatus; completedAt: Date | null }> {
  const row = await prisma.assessment.findUnique({
    where: { id, orgId },
    select: { status: true, completedAt: true },
  });
  if (!row) throw new NotFoundError('Assessment not found');
  return row;
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
  const assessment = await requireAssessment(assessmentId, orgId);
  // The same rule the PDF gates on.
  if (!hasReport(assessment)) {
    throw new APIError(
      'This review has no report yet: it is still running, or it failed or was cancelled.',
      'REPORT_NOT_READY',
      409,
      { status: assessment.status.toLowerCase() }
    );
  }
  const { token, tokenHash } = mintShareToken();
  let row: ShareRow;
  try {
    row = await prisma.reportShare.create({
      data: {
        orgId,
        assessmentId,
        tokenHash,
        expiresAt: new Date(now.getTime() + input.expiresInDays * DAY_MS),
        createdByUserId: userId,
      },
      select: shareSelect,
    });
  } catch (err) {
    // Deleted (by a member or the retention purge) since the check above.
    if (isForeignKeyFailure(err)) {
      throw new NotFoundError('Assessment not found');
    }
    throw err;
  }
  logger.info('Share link made', { shareId: row.id, assessmentId });
  return {
    ...toView(row, now),
    token,
    url: new URL(sharedReportPath(token), getPublicUrl()).toString(),
  };
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
  const { count } = await prisma.reportShare.updateMany({
    where: { id, orgId, revokedAt: null },
    data: { revokedAt: now },
  });
  const row = await prisma.reportShare.findUnique({ where: { id, orgId }, select: shareSelect });
  if (!row) throw new NotFoundError('Share link not found');
  // Only the call that revoked it: a repeat changes nothing.
  if (count === 1) logger.info('Share link revoked', { shareId: id });
  return toView(row, now);
}

/** Why a link opened nothing. The callers answer every one as not found. */
export type SharedReportRefusal = ShareOrgRefusal | 'closed' | 'no-report';

export type SharedReportRead =
  { ok: true; shareId: string; report: SharedReport } | { ok: false; refused: SharedReportRefusal };

/**
 * What `token` opens, counted as a view when it shows a report.
 *
 * Live means not revoked and not expired. The token's row is checked first,
 * and then again in the same write that counts the view, so a link revoked
 * a moment ago is not opened once more by a read already under way. A link
 * whose model version no longer resolves, or does not parse, shows nothing
 * and is not counted.
 *
 * A view is a fetch of the link, not a person: a chat app's link preview
 * counts, as do a refresh and an API call.
 */
/**
 * Who is opening the link: the `/r/{token}` page, which renders the report
 * from `model` on the server, or `GET /api/v1/shared-reports/{token}`, which
 * answers with the version's `catalogue` and never the model (t-67). Only
 * the API builds the catalogue, so a catalogue it cannot build never stops
 * the page rendering.
 */
export type SharedReportReader = 'page' | 'api';

export async function readSharedReport(
  token: string,
  now: Date = new Date(),
  reader: SharedReportReader = 'page'
): Promise<SharedReportRead> {
  const entered = await runAsShareOrg(token, async (share) => {
    const closed = { ok: false as const, refused: 'closed' as const };
    if (share.revokedAt !== null || share.expiresAt <= now) return closed;

    let assessment: AssessmentDetail;
    try {
      assessment = await getAssessment(share.assessmentId);
    } catch (err) {
      if (err instanceof NotFoundError) return closed;
      throw err;
    }
    // A link is made only for a report, and a final run stays final, so
    // this is a defect rather than a state, but it must not serve a half run.
    if (assessment.result === null || !isReportable(assessment)) {
      logger.error('Share link: its assessment has no report', undefined, {
        shareId: share.id,
        status: assessment.status,
      });
      return { ok: false as const, refused: 'no-report' as const };
    }

    // Only what the report reads of the result: see `sharedResult`.
    const result = sharedResult(assessment.result);
    if (result === null) {
      logger.error('Share link: its result is not one the report can read', undefined, {
        shareId: share.id,
        framework: assessment.framework,
      });
      return { ok: false as const, refused: 'no-report' as const };
    }

    const view = sharedView(assessment, result);
    // The page parses the assessment as the report reads it; one that would
    // not parse shows nothing, so it is not served.
    if (!reportAssessmentSchema.safeParse(asOnTheWire(view)).success) {
      logger.error('Share link: its assessment is not one the report can read', undefined, {
        shareId: share.id,
        framework: assessment.framework,
      });
      return { ok: false as const, refused: 'no-report' as const };
    }

    const readable = await readableModel(share.id, assessment, reader);
    if (readable !== null) {
      const orgId = requireOrgId();
      const { count } = await prisma.reportShare.updateMany({
        where: { id: share.id, orgId, revokedAt: null, expiresAt: { gt: now } },
        data: { viewCount: { increment: 1 } },
      });
      if (count === 0) return closed;
    }

    const report: SharedReport = {
      assessment: view,
      model: readable?.model ?? null,
      catalogue: readable?.catalogue ?? null,
      expiresAt: share.expiresAt,
    };
    return { ok: true as const, shareId: share.id, report };
  });

  if (!entered.ok) return entered;
  if (!entered.value.ok)
    logger.info('Share link opened nothing', { refused: entered.value.refused });
  return entered.value;
}

/** `hasReport`, on the detail's wire-form status. */
const isReportable = (a: AssessmentDetail): boolean =>
  (a.status === 'completed' || a.status === 'partial') && a.completedAt !== null;

/**
 * The fields a share serves, picked one by one, so a field added to the
 * detail is not shared by default. Not `context`: it is open JSON the caller
 * supplied (briefs, client names, links) and the report never reads it.
 */
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

/**
 * What a share link needs of the model version `a` ran on, or `null` when the
 * report cannot be shown to this reader, so the open is not counted: the
 * version no longer resolves, its document does not parse, or (for the API)
 * its catalogue cannot be built.
 *
 * - `model`: only what the report shows (`reportModelSchema` strips the
 *   rest), for the `/r/{token}` page, which renders it on the server.
 * - `catalogue`: for the API only, the names of what the result names by id.
 *   The model is IP (t-67), so the API answers with this, never with `model`.
 *   Built from the one document read here, so a view materialises once.
 */
async function readableModel(
  shareId: string,
  a: AssessmentDetail,
  reader: SharedReportReader
): Promise<{ model: Record<string, unknown>; catalogue: Record<string, unknown> | null } | null> {
  const document = await loadModelDocument(a.framework.slug, a.framework.version);
  if (document === null) return null;
  const parsed = reportModelSchema.safeParse(document);
  if (!parsed.success) {
    logger.error('Share link: its model is not one the report can read', undefined, {
      shareId,
      framework: a.framework,
    });
    return null;
  }
  if (reader === 'page') return { model: parsed.data, catalogue: null };
  const def = getFrameworkDefinition(a.framework.slug);
  try {
    if (!def) throw new Error(`No framework definition "${a.framework.slug}"`);
    return { model: parsed.data, catalogue: def.catalogue(document) };
  } catch (err) {
    logger.error('Share link: its catalogue could not be built', err, {
      shareId,
      framework: a.framework,
    });
    return null;
  }
}

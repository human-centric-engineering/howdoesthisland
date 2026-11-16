/**
 * Entering the org a share link belongs to, from its token (t-32).
 *
 * `/r/{token}` and `GET /api/v1/shared-reports/{token}` are opened by people
 * with no account, so no guard has entered an org when they run. The token
 * names a row, a `ReportShare`, and the org is that row's. The shape is the
 * platform's for every "token naming a row" entry, and the print page's
 * (`runAsReportOrg`, `lib/app/reports/pdf/report-org.ts`):
 *
 * 1. the one read that learns the share's org, by the token's hash, runs
 *    under `runAsCredentialLookup`;
 * 2. that org goes through `resolveCredentialOrg`, so a suspended workspace's
 *    links stop working as its members' sessions do;
 * 3. the rest runs inside `runAsOrg`.
 *
 * **The source is `'approval-token'`**, the decision t-31 made for the print
 * page, which its docblock said this entry would need too. The platform's
 * sources are a closed union (`TenantContextSource`), and this is the one whose
 * documented meaning fits: a token naming a row, the org the row's, read under
 * a system scope before it is entered. Nothing downstream reads that source as
 * meaning an approval (the only source checks are for `'support'` and for a
 * personal key's `'session'` / `'resolver'`). If an approval-specific rule
 * ever appears, both entries need a source of their own, and an upstream issue.
 *
 * Whether the link is still live (not revoked, not expired) is decided inside
 * the org, by the caller, not here: this only learns where the row lives.
 */
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { runAsCredentialLookup, runAsOrg } from '@/lib/tenancy/context';
import { isOrgRefusal, resolveCredentialOrg } from '@/lib/tenancy/entry';
import { hashShareToken, SHARE_TOKEN_PATTERN } from '@/lib/app/reports/share/token';

/** Why a token was not entered. Every one answers "not found". */
export type ShareOrgRefusal = 'malformed' | 'missing' | 'org';

export type ShareOrgResult<T> = { ok: true; value: T } | { ok: false; refused: ShareOrgRefusal };

/** The share a token names, as read by its hash. */
export interface ShareTarget {
  id: string;
  assessmentId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * Find the share `token` names and run `fn(share)` inside its org. Never
 * throws for a token that opens nothing; what `fn` throws propagates.
 */
export async function runAsShareOrg<T>(
  token: string,
  fn: (share: ShareTarget) => Promise<T>
): Promise<ShareOrgResult<T>> {
  // Not a token at all: answered without a read.
  if (!SHARE_TOKEN_PATTERN.test(token)) return { ok: false, refused: 'malformed' };

  const share = await runAsCredentialLookup('report-share', () =>
    prisma.reportShare.findUnique({
      where: { tokenHash: hashShareToken(token) },
      select: {
        id: true,
        orgId: true,
        assessmentId: true,
        expiresAt: true,
        revokedAt: true,
        org: { select: { status: true } },
      },
    })
  );
  if (!share) return { ok: false, refused: 'missing' };

  const org = resolveCredentialOrg(
    { orgId: share.orgId, orgStatus: share.org?.status ?? null },
    'approval-token'
  );
  if (isOrgRefusal(org)) {
    logger.warn('Share link: its workspace cannot be entered', {
      shareId: share.id,
      refused: org.refused,
    });
    return { ok: false, refused: 'org' };
  }

  const target: ShareTarget = {
    id: share.id,
    assessmentId: share.assessmentId,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
  };
  const value = await runAsOrg(org.orgId, () => fn(target), {
    source: org.source,
    role: org.role,
  });
  return { ok: true, value };
}

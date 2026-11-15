/**
 * Entering the org a report belongs to, from a render token (t-31).
 *
 * The print page is requested by the PDF route's headless browser, with a
 * render token and nothing else, so no guard has entered an org when it
 * runs. The token names a row, an assessment, and the org is that row's.
 * This is the shape every "signed token naming a row" route in the platform
 * has (`runAsExecutionOrg` in `lib/orchestration/approval-route-helpers.ts`,
 * `runAsWaitlistEntryOrg` in `lib/waitlist/entry-org.ts`):
 *
 * 1. the one read that learns the row's org runs under `runAsCredentialLookup`;
 * 2. that org goes through `resolveCredentialOrg`, the rule every credential's
 *    org does, so a suspended workspace's reports stop rendering as its
 *    members' sessions stop working;
 * 3. the rest runs inside `runAsOrg`.
 *
 * **The source is `'approval-token'`.** The platform's list of sources is
 * closed (`TenantContextSource`, `lib/tenancy/context.ts`), and adding one
 * means editing Sunrise. `'approval-token'` is documented as "an HMAC token
 * over a row id, where the org is the row's, read under a system scope
 * before it is entered", which describes this entry exactly. Nothing
 * downstream reads that source as meaning an approval: the only checks on a
 * context's source are the support-session check (`'support'`) and the
 * personal-API-key check (`'session'` or `'resolver'`), and neither matches
 * it. If a source-specific rule for approvals ever appears, this entry needs
 * its own source (and an upstream issue). x2's share links will need the
 * same decision.
 */
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { runAsCredentialLookup, runAsOrg } from '@/lib/tenancy/context';
import { isOrgRefusal, resolveCredentialOrg } from '@/lib/tenancy/entry';
import { RenderTokenError, verifyRenderToken } from '@/lib/app/reports/pdf/render-token';

/** Why the print page would not render. All of them render as "not found". */
export type ReportOrgRefusal =
  | { refused: 'token'; reason: RenderTokenError['reason'] }
  | { refused: 'missing' }
  | { refused: 'wrong-org' }
  | { refused: 'org' };

export type ReportOrgResult<T> = { ok: true; value: T } | ({ ok: false } & ReportOrgRefusal);

/**
 * Verify `token` for assessment `id`, and run `fn` inside the assessment's
 * org. Never throws for a refused token or an org that cannot be entered:
 * those come back as `{ ok: false }`, logged, for the page to answer as not
 * found. What `fn` throws propagates.
 */
export async function runAsReportOrg<T>(
  token: string | null,
  id: string,
  fn: () => Promise<T>
): Promise<ReportOrgResult<T>> {
  if (!token) return refuse({ refused: 'token', reason: 'malformed' }, id);
  let claimedOrg: string;
  try {
    claimedOrg = verifyRenderToken(token, id).orgId;
  } catch (err) {
    if (err instanceof RenderTokenError) {
      return refuse({ refused: 'token', reason: err.reason }, id);
    }
    throw err;
  }

  const row = await runAsCredentialLookup('report-render', () =>
    prisma.assessment.findUnique({
      where: { id },
      select: { orgId: true, org: { select: { status: true } } },
    })
  );
  if (!row) return refuse({ refused: 'missing' }, id);

  const org = resolveCredentialOrg(
    { orgId: row.orgId, orgStatus: row.org?.status ?? null },
    'approval-token'
  );
  if (isOrgRefusal(org)) return refuse({ refused: 'org' }, id);
  // The row's org, as resolved, must be the one the token was minted in.
  if (org.orgId !== claimedOrg) return refuse({ refused: 'wrong-org' }, id);

  const value = await runAsOrg(org.orgId, fn, { source: org.source, role: org.role });
  return { ok: true, value };
}

function refuse(refusal: ReportOrgRefusal, assessmentId: string): { ok: false } & ReportOrgRefusal {
  logger.warn('Report print page refused', { assessmentId, ...refusal });
  return { ok: false, ...refusal };
}

/**
 * CopyCredits for platform admins (t-57): what `/admin/credits` lists, and a
 * grant or adjustment made from it.
 *
 * **Across workspaces, so in the system scope.** The page lists every active
 * workspace, which no one org's scope can read; each read and write still
 * names its org. Platform admins only: the routes' guard and the admin layout
 * refuse anyone else.
 *
 * **The cap is the safety ceiling, not the allowance.** A workspace's monthly
 * AI cap (`quotas.monthlyBudgetUsd`, Sunrise's, checked before every paid AI
 * call) still bounds what it can spend in a month, whatever its credits. So a
 * change answers with `capWarning` when the balance is worth more than the cap
 * leaves this month: its reviews would stop at the cap with credits unspent.
 * Raising the cap is the workspace's admin page (`PATCH
 * /api/v1/admin/orgs/[id]`), not this.
 */
import { NotFoundError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { orgCapStateOrSkip, utcMonthStart } from '@/lib/orchestration/llm/spend-caps';
import { runAsSystem } from '@/lib/tenancy/context';
import { readOrgQuotas } from '@/lib/tenancy/org-settings';
import { getCreditBalance, getCreditBalances, recordCreditEntry } from '@/lib/app/credits/ledger';
import { usdForCredits } from '@/lib/app/credits/rate';
import {
  ADMIN_CREDITS_LIST_LIMIT,
  type AdminCreditsList,
  type CreditChange,
  type CreditChangeResult,
} from '@/lib/app/credits/wire';

/** A dollar figure to the millionth, as the cost rows are priced. */
function usd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Active workspaces, by name, with their balance and what their cap leaves
 * this month. `q` narrows by name or slug. At most
 * {@link ADMIN_CREDITS_LIST_LIMIT}; `truncated` says more matched.
 *
 * Three reads whatever the number of workspaces: the orgs, their balances,
 * and their month's spend, each one query.
 *
 * **What the cap leaves is read here, not through the gate's cache.** The
 * gate (`getOrgCapState`) caches each org's cap for 30 seconds and adds spend
 * this process logged a moment ago; reading that per row would be a query per
 * workspace. So for those seconds after a cap is raised, or a review spends,
 * this column and a change's `capWarning` (which reads through the gate) can
 * differ by that much. It is a guide for an admin, not the gate.
 */
/**
 * `q` as a literal for Prisma's `contains`, which becomes `ILIKE '%q%'` and
 * does not escape LIKE's own wildcards: without this, `a_b` matches `axb` and
 * `%` matches every workspace.
 */
export function likeLiteral(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listWorkspaceCredits(q?: string): Promise<AdminCreditsList> {
  const term = q ? likeLiteral(q) : undefined;
  return runAsSystem('app.credits: admin list', async () => {
    const orgs = await prisma.org.findMany({
      where: {
        status: 'ACTIVE',
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { slug: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, slug: true, settings: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: ADMIN_CREDITS_LIST_LIMIT + 1,
    });
    const listed = orgs.slice(0, ADMIN_CREDITS_LIST_LIMIT);
    const ids = listed.map((org) => org.id);

    const [balances, spend] = await Promise.all([
      getCreditBalances(ids),
      ids.length > 0
        ? prisma.aiCostLog.groupBy({
            by: ['orgId'],
            where: { orgId: { in: ids }, createdAt: { gte: utcMonthStart() } },
            _sum: { totalCostUsd: true },
          })
        : Promise.resolve([]),
    ]);
    const spentBy = new Map(spend.map((row) => [row.orgId, row._sum.totalCostUsd ?? 0]));

    return {
      workspaces: listed.map((org) => {
        const limit = readOrgQuotas(org.settings, { orgId: org.id }).monthlyBudgetUsd;
        return {
          orgId: org.id,
          name: org.name,
          slug: org.slug,
          balance: balances.get(org.id) ?? 0,
          cap:
            limit === undefined
              ? null
              : {
                  limitUsd: limit,
                  remainingUsd: usd(Math.max(0, limit - (spentBy.get(org.id) ?? 0))),
                },
        };
      }),
      truncated: orgs.length > ADMIN_CREDITS_LIST_LIMIT,
    };
  });
}

/**
 * Grant or adjust a workspace's credits, recording who and why. Throws
 * `NotFoundError` for a workspace that does not exist or is not active.
 *
 * **Once the entry is written, the answer cannot fail.** An admin who is told
 * a saved grant failed presses Grant again, and an admin's change carries no
 * reference to make it happen once. So the balance is read in the entry's own
 * transaction, and the cap, which only feeds `capWarning`, is read through
 * `orgCapStateOrSkip`: a cap that cannot be read gives no warning rather than
 * a failed request.
 */
export async function changeWorkspaceCredits(
  orgId: string,
  change: CreditChange,
  actorUserId: string
): Promise<CreditChangeResult> {
  return runAsSystem('app.credits: admin change', async () => {
    const { entry, balance } = await prisma.$transaction(async (tx) => {
      // In the transaction, holding the org row, so a workspace suspended or
      // deleted by someone else at the same moment is not credited after its
      // check passed.
      const [org] = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status::text AS status FROM "org" WHERE id = ${orgId} FOR SHARE`;
      if (!org || org.status !== 'ACTIVE') throw new NotFoundError('Workspace not found');

      const written = await recordCreditEntry(
        {
          orgId,
          amount: change.amount,
          kind: change.kind === 'grant' ? 'GRANT' : 'ADJUST',
          reason: change.reason,
          actorUserId,
        },
        tx
      );
      return { entry: written, balance: await getCreditBalance(orgId, tx) };
    });
    const cap = await orgCapStateOrSkip(orgId, { source: 'app.credits: admin change' });

    const balanceUsd = usdForCredits(balance);
    const remainingUsd = cap ? usd(Math.max(0, cap.limit - cap.spent)) : null;
    return {
      entry: {
        id: entry.id,
        amount: entry.amount,
        kind: entry.kind,
        reason: entry.reason,
        createdAt: entry.createdAt.toISOString(),
      },
      balance,
      capWarning:
        cap && remainingUsd !== null && balanceUsd > remainingUsd
          ? { balanceUsd: usd(balanceUsd), remainingUsd, limitUsd: cap.limit }
          : null,
    };
  });
}

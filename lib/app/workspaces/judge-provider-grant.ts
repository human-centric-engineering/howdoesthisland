/**
 * Approve existing workspaces for the judges' provider (t-39).
 *
 * A new workspace is granted `WORKSPACE_PROVIDER_SLUGS` when it is made
 * (`provision.ts`). One made before the judges moved to Anthropic (D8, ruled
 * 2026-11-17) is approved for OpenAI only, and that matters more than it
 * looks: the platform's reconcile does not leave a platform-owned binding on
 * the old provider when the org cannot use the new one. It binds the agent to
 * nothing, and every judge call is then refused. So every such workspace is
 * granted the judges' provider before the change of default reaches it.
 *
 * Adds to the org's approved list and keeps the rest of its policy (other
 * providers, any jurisdictions). The install org is skipped: at `multi` its
 * policy is open, so it needs no grant. Each grant clears the org's cached
 * policy and reconciles its platform agents, as the admin grant route does.
 */
import { withSettingsConflictRetry } from '@/lib/app/workspaces/app-settings';
import { JUDGE_PROVIDER_SLUG } from '@/lib/app/workspaces/provider-slug';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { forgetOrgProviderPolicy } from '@/lib/orchestration/llm/org-provider-policy';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { runAsSystem } from '@/lib/tenancy/context';
import { readOrgProviderPolicy, writeOrgProviderPolicy } from '@/lib/tenancy/org-settings';

export type GrantOutcome = 'granted' | 'already' | 'missing';

export interface GrantSummary {
  /** The provider granted; `null` when it has no row, so nothing was granted. */
  providerSlug: string | null;
  granted: string[];
  already: string[];
}

/**
 * Add `providerId` to one org's approved providers. `missing` when the org
 * does not exist. Retried on a clash with a concurrent settings write, each
 * try on a fresh read.
 */
export async function grantProviderToOrg(orgId: string, providerId: string): Promise<GrantOutcome> {
  // System scope: an org's settings are written by a platform operator here,
  // from no org's context.
  return withSettingsConflictRetry(() =>
    runAsSystem('judge provider grant', async (): Promise<GrantOutcome> => {
      const org = await prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } });
      if (!org) return 'missing';
      const policy = readOrgProviderPolicy(org.settings, { orgId });
      if (policy.approved.includes(providerId)) return 'already';
      const written = await writeOrgProviderPolicy(orgId, {
        ...policy,
        approved: [...policy.approved, providerId],
      });
      return written ? 'granted' : 'missing';
    })
  );
}

/** Grant the judges' provider to every org but the install org. */
export async function grantJudgeProviderToAllOrgs(): Promise<GrantSummary> {
  const provider = await runAsSystem('judge provider grant: provider', () =>
    prisma.aiProviderConfig.findUnique({
      where: { slug: JUDGE_PROVIDER_SLUG },
      select: { id: true },
    })
  );
  if (!provider) return { providerSlug: null, granted: [], already: [] };

  const orgs = await runAsSystem('judge provider grant: orgs', () =>
    prisma.org.findMany({ where: { id: { not: INSTALL_ORG_ID } }, select: { id: true } })
  );
  const summary: GrantSummary = { providerSlug: JUDGE_PROVIDER_SLUG, granted: [], already: [] };
  for (const { id } of orgs) {
    const outcome = await grantProviderToOrg(id, provider.id);
    if (outcome === 'already') summary.already.push(id);
    if (outcome !== 'granted') continue;
    summary.granted.push(id);
    forgetOrgProviderPolicy(id);
    // Never throws; the maintenance job catches up on a failure.
    await import('@/lib/orchestration/agents/reconcile-platform-agents')
      .then(({ tryReconcilePlatformAgents }) =>
        tryReconcilePlatformAgents(id, 'app: judge provider grant')
      )
      .catch((error: unknown) => {
        logger.error('Granted org not reconciled; the maintenance job catches up', error, {
          orgId: id,
        });
      });
  }
  return summary;
}

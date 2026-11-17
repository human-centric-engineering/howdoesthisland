/**
 * Get existing workspaces ready for the judges' provider (t-39).
 *
 * A new workspace is granted `WORKSPACE_PROVIDER_SLUGS` when it is made
 * (`provision.ts`). One made before the judges moved to Anthropic (D8, ruled
 * 2026-11-17) is approved for OpenAI only, and that matters more than it
 * looks: the platform's reconcile does not leave a platform-owned binding on
 * the old provider when the org cannot use the new one. It binds the agent to
 * nothing, and every judge call is then refused. So every such workspace is
 * granted the judges' provider before the change of default reaches it.
 *
 * Two writes, both safe to make while the previous build is still serving,
 * since neither moves a binding itself:
 *
 * - **The grant.** Puts the provider first on each org's approved list, as a
 *   new workspace's has it, and keeps the rest of its policy (other
 *   providers, any jurisdictions), read and written in one serializable
 *   transaction so a concurrent grant is not lost. The install org is
 *   skipped: at `multi` its policy is open. **Only a policy the app wrote is
 *   changed**: OpenAI alone (what a workspace was given before t-39), or
 *   nothing (a workspace whose grant failed when it was made), with no
 *   jurisdiction restriction. Any other policy may be a platform admin's
 *   choice (other providers, a jurisdiction, a provider left off on
 *   purpose), so it is reported for an admin to decide on `/admin`, never
 *   overridden.
 * - **Handing back stale choices.** A judge or editor a workspace bound to a
 *   model no longer on its role's approved list (the Claude 4.x entries t-39
 *   removed) would have every call refused. Such a binding is handed back to
 *   the platform (`bindingOwner: 'platform'`), so the reconcile moves it to the
 *   default.
 *
 * Neither reconciles. The build being deployed does, through the
 * platform-agent maintenance job, once it is serving: reconciling from here
 * would bind agents to models the running build does not approve yet.
 *
 * **Run it twice: before the deploy, and again once the new build serves.**
 * A workspace the previous build makes in between is granted OpenAI alone,
 * and a workspace can still choose a Claude 4.x model there; the second run
 * catches both. Both writes are idempotent.
 */
import type { Prisma } from '@prisma/client';
import { EDITOR_AGENT_SLUG, judgeAgentSlug } from '@/lib/app/judges/agents';
import { approvedEntry, roleOfSlot, type JudgeRole } from '@/lib/app/judges/approved-models';
import { HOWDOESTHISLAND_JUDGE_SLOTS } from '@/lib/app/frameworks/howdoesthisland/judge-slots';
import { withSettingsConflictRetry } from '@/lib/app/workspaces/app-settings';
import { JUDGE_PROVIDER_SLUG } from '@/lib/app/workspaces/provider-slug';
import { prisma } from '@/lib/db/client';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { runAsSystem } from '@/lib/tenancy/context';
import { ORG_PROVIDERS_KEY, readOrgProviderPolicy } from '@/lib/tenancy/org-settings';
import { orgProviderPolicySchema } from '@/lib/validations/tenancy';
import { isRecord } from '@/lib/utils';

/** The provider every workspace was approved for, alone, before t-39. */
const PREVIOUS_PROVIDER_SLUG = 'openai';

export type GrantOutcome = 'granted' | 'already' | 'restricted' | 'missing';

export interface GrantSummary {
  /** The provider granted; `null` when it has no row, so nothing was granted. */
  providerSlug: string | null;
  granted: string[];
  already: string[];
  /** Orgs whose policy the app did not write, left for an admin to decide. */
  restricted: string[];
}

/**
 * Put `providerId` first on one org's approved providers, when the org's
 * policy is one the app wrote: approved for nothing, or for `appDefault`
 * alone (the providers a workspace was given before), with no jurisdiction
 * restriction. `restricted` for any other policy, left alone; `missing` when
 * the org does not exist. The read and the write are one serializable
 * transaction, retried on a clash with a concurrent settings write.
 */
export async function grantProviderToOrg(
  orgId: string,
  providerId: string,
  appDefault: readonly string[]
): Promise<GrantOutcome> {
  // System scope: an org's settings are written by a platform operator here,
  // from no org's context.
  return withSettingsConflictRetry(() =>
    runAsSystem('judge provider grant', () =>
      prisma.$transaction(
        async (tx): Promise<GrantOutcome> => {
          const row = await tx.org.findUnique({ where: { id: orgId }, select: { settings: true } });
          if (!row) return 'missing';
          const policy = readOrgProviderPolicy(row.settings, { orgId });
          if (policy.approved.includes(providerId)) return 'already';
          const appWritten =
            !policy.jurisdictions &&
            (policy.approved.length === 0 ||
              (policy.approved.length === appDefault.length &&
                policy.approved.every((id) => appDefault.includes(id))));
          if (!appWritten) return 'restricted';
          const settings: Record<string, unknown> = isRecord(row.settings)
            ? { ...row.settings }
            : {};
          // Through core's schema, and stored as `writeOrgProviderPolicy`
          // stores it: no key when there is no jurisdiction restriction.
          const approved = [providerId, ...policy.approved];
          settings[ORG_PROVIDERS_KEY] = orgProviderPolicySchema.parse(
            policy.jurisdictions ? { approved, jurisdictions: policy.jurisdictions } : { approved }
          );
          await tx.org.update({
            where: { id: orgId },
            data: { settings: settings as Prisma.InputJsonObject },
          });
          return 'granted';
        },
        { isolationLevel: 'Serializable' }
      )
    )
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
  if (!provider) return { providerSlug: null, granted: [], already: [], restricted: [] };
  // What a workspace was approved for before the judges moved: OpenAI alone.
  const previous = await runAsSystem('judge provider grant: previous default', () =>
    prisma.aiProviderConfig.findUnique({
      where: { slug: PREVIOUS_PROVIDER_SLUG },
      select: { id: true },
    })
  );
  const appDefault = previous ? [previous.id] : [];

  // Suspended orgs too: one reinstated later should find its judges working.
  const orgs = await runAsSystem('judge provider grant: orgs', () =>
    prisma.org.findMany({ where: { id: { not: INSTALL_ORG_ID } }, select: { id: true } })
  );
  const summary: GrantSummary = {
    providerSlug: JUDGE_PROVIDER_SLUG,
    granted: [],
    already: [],
    restricted: [],
  };
  for (const { id } of orgs) {
    const outcome = await grantProviderToOrg(id, provider.id, appDefault);
    if (outcome !== 'missing') summary[outcome].push(id);
  }
  return summary;
}

/** Each of the app's agents by slug, with the role whose approved list it is held to. */
function rolesBySlug(): Map<string, JudgeRole> {
  const roles = new Map<string, JudgeRole>(
    HOWDOESTHISLAND_JUDGE_SLOTS.map((slot) => [judgeAgentSlug(slot), roleOfSlot(slot)])
  );
  roles.set(EDITOR_AGENT_SLUG, 'editor');
  return roles;
}

/**
 * Hand back to the platform every judge or editor a workspace bound to a model
 * no longer on its role's approved list. Returns the agents' ids.
 */
export async function releaseUnapprovedBindings(): Promise<string[]> {
  const roles = rolesBySlug();
  const chosen = await runAsSystem('judge provider grant: chosen bindings', () =>
    prisma.aiAgent.findMany({
      // The agents a workspace can choose for, as `model-choice.ts` reads them.
      where: {
        slug: { in: [...roles.keys()] },
        bindingOwner: 'org',
        isSystem: true,
        deletedAt: null,
      },
      select: { id: true, slug: true, provider: true, model: true },
    })
  );
  const stale = chosen.filter((a) => {
    const role = roles.get(a.slug);
    return role !== undefined && !approvedEntry(role, { provider: a.provider, model: a.model });
  });
  if (stale.length === 0) return [];
  await runAsSystem('judge provider grant: release stale bindings', () =>
    prisma.aiAgent.updateMany({
      where: { id: { in: stale.map((a) => a.id) }, bindingOwner: 'org' },
      data: { bindingOwner: 'platform' },
    })
  );
  return stale.map((a) => a.id);
}

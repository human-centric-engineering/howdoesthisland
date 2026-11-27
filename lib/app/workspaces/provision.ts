/**
 * What every new workspace starts with (t-7, D1; on Sunrise's seams since t-91).
 *
 * Under D1 every person works in a workspace, and must be able to run an
 * assessment from their first minute. Sunrise makes the workspace: a
 * self-serve signup gets an org of their own, as its `OWNER`
 * (`lib/app/signup-org.ts`), and a team workspace is made by
 * `createTeamWorkspace()` (`./create.ts`, t-8). This module equips it, from the
 * org-created hook (`lib/app/org-created.ts`) that Sunrise runs for every new
 * org, however it was made:
 *
 * - **granted its providers** (`WORKSPACE_PROVIDER_SLUGS`): Anthropic, which
 *   the judges and editor run on (D8, t-39), and OpenAI, which the embedder
 *   runs on. At `multi` every org but the install org starts approved for no
 *   provider, so without this the workspace could call no model at all;
 * - **given the default monthly AI budget**, $10 (D6, owner ruling on open
 *   question 2), a safety ceiling while reviews are paid for in credits.
 *
 * **Idempotent**, as the hook must be: Sunrise retries a hook that throws, and
 * a retry must not undo what a platform admin set since. So each value is
 * written only while the org has none: a provider policy already stored, or a
 * monthly budget already set, is left as it is.
 *
 * Sunrise runs the hooks before it places the new org's platform agents, so
 * the agents pick their models from the grant. On a retry the agents are
 * already placed, so the hook asks for them again (`reconcile`).
 *
 * A failure throws: the hook stays owed and Sunrise's `orgCreatedHooks`
 * maintenance job runs it again. A provider with no row is logged at `error`
 * and not thrown, since retrying cannot create it.
 */
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { createOrg, OrgLifecycleError, type OrgRecord } from '@/lib/tenancy/lifecycle';
import {
  ORG_PROVIDERS_KEY,
  readOrgProviderPolicy,
  readOrgQuotas,
  writeOrgProviderPolicy,
  writeOrgQuotas,
} from '@/lib/tenancy/org-settings';
import { forgetOrgProviderPolicy } from '@/lib/orchestration/llm/org-provider-policy';
import { forgetOrgCap } from '@/lib/orchestration/llm/spend-caps';
import { forgetOrgRequestCap } from '@/lib/security/org-request-cap';
import { JUDGE_PROVIDER_SLUG, WORKSPACE_PROVIDER_SLUGS } from '@/lib/app/workspaces/provider-slug';
import {
  APP_SETTINGS_KEY,
  withSettingsConflictRetry as withConflictRetry,
} from '@/lib/app/workspaces/app-settings';
import { isRecord } from '@/lib/utils';

export { APP_SETTINGS_KEY, WORKSPACE_PROVIDER_SLUGS };

/**
 * The monthly AI spending limit every new workspace starts with, in USD.
 *
 * Since t-57 a **safety ceiling, not an allowance**: reviews are paid for in
 * CopyCredits, and a new workspace starts with none (.context/app/credits.md).
 * This bounds what any one workspace's AI can spend in a month, whatever the
 * path. It must stay set: Sunrise reads no cap as unlimited.
 *
 * **$10 is a testing value**, to stop overspending while we test. The
 * production value is the owner's call at launch (f-launch, l1).
 */
export const WORKSPACE_MONTHLY_BUDGET_USD = 10;

/** Longest slug stem taken from a name; the suffix and the cap leave room. */
const SLUG_STEM_MAX = 40;

/** Attempts at a free slug before giving up. Each retry adds a random suffix. */
const SLUG_ATTEMPTS = 4;

/**
 * A slug stem from a name: lowercase ASCII letters and digits joined by
 * single hyphens, accents folded. A name with nothing usable in it (a name
 * in a non-Latin script) gives `workspace`.
 */
export function slugStem(name: string): string {
  const stem = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_STEM_MAX)
    .replace(/-+$/, '');
  return stem || 'workspace';
}

/** Six hex characters, from Web Crypto (a `node:` import is outside the `lib/app` boundary). */
function randomSuffix(): string {
  return globalThis.crypto.randomUUID().slice(0, 6);
}

/**
 * Create the org under a slug derived from its name. `Org.slug` is unique
 * across every org, so a taken slug is retried with a random suffix. With an
 * `ownerUserId` the founding `OWNER` is written in the same transaction as
 * the org (a team workspace, t-8). `createOrg` runs the org-created hook, so
 * the org comes back equipped unless that failed (and is then retried).
 */
export async function createWorkspaceOrg(
  name: string,
  stem: string,
  ownerUserId?: string
): Promise<OrgRecord> {
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? stem : `${stem}-${randomSuffix()}`;
    try {
      return await createOrg({ slug, name, ...(ownerUserId ? { ownerUserId } : {}) });
    } catch (error) {
      if (error instanceof OrgLifecycleError && error.code === 'SLUG_TAKEN') continue;
      throw error;
    }
  }
  throw new Error(`No free workspace slug for "${stem}" after ${SLUG_ATTEMPTS} attempts`);
}

/**
 * Approve the workspace for its providers (`WORKSPACE_PROVIDER_SLUGS`): those
 * of them that exist. Returns whether a grant was written, and whether it
 * includes the judges' provider.
 *
 * A provider with no row is left out and logged at `error`; the judges'
 * missing means the workspace's judges and editor have no model until a
 * platform admin creates it and grants it on `/admin`.
 */
async function grantProviders(orgId: string): Promise<{ written: boolean; judges: boolean }> {
  const providers = await prisma.aiProviderConfig.findMany({
    where: { slug: { in: [...WORKSPACE_PROVIDER_SLUGS] } },
    select: { id: true, slug: true },
  });
  const missing = WORKSPACE_PROVIDER_SLUGS.filter((s) => !providers.some((p) => p.slug === s));
  if (missing.length > 0) {
    logger.error(
      missing.includes(JUDGE_PROVIDER_SLUG)
        ? 'The judges’ provider does not exist; the new workspace’s judges have no model'
        : 'A workspace provider does not exist; the new workspace is not granted it',
      { orgId, missing }
    );
  }
  if (providers.length === 0) return { written: false, judges: false };
  // In the list's order, so the stored policy reads the same in every org.
  const approved = WORKSPACE_PROVIDER_SLUGS.flatMap((s) =>
    providers.filter((p) => p.slug === s).map((p) => p.id)
  );
  // No jurisdiction restriction: none is ruled for this app yet.
  await withConflictRetry(() => writeOrgProviderPolicy(orgId, { approved }));
  return { written: true, judges: providers.some((p) => p.slug === JUDGE_PROVIDER_SLUG) };
}

/** What {@link equipWorkspace} did. */
export interface EquipResult {
  /** The judges' provider was granted by this run. */
  granted: boolean;
  /** The org already had a provider policy, so none was written. */
  grantKept: boolean;
  /** The org already had a monthly budget, so none was written. */
  budgetKept: boolean;
}

/**
 * Give a new workspace what every workspace starts with: its provider grant
 * and the default budget, each only while the org has none (see the module
 * header). The body of the `app:equip-workspace` org-created hook.
 *
 * Throws on a failed read or write, so the hook stays owed and is retried.
 *
 * @param source the reconcile's trigger label, for its logs.
 * @param options.reconcile give the org's platform agents out again after a
 *   grant. Only a retry needs it: on the run straight after a create Sunrise
 *   places the agents itself, after the hooks.
 */
export async function equipWorkspace(
  orgId: string,
  source: string,
  options: { reconcile?: boolean } = {}
): Promise<EquipResult> {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } });
  if (!org) throw new Error(`equipWorkspace: no org ${orgId}`);
  const settings = isRecord(org.settings) ? org.settings : {};

  const grantKept =
    settings[ORG_PROVIDERS_KEY] !== undefined && settings[ORG_PROVIDERS_KEY] !== null;
  const grant = grantKept ? { written: false, judges: false } : await grantProviders(orgId);

  const budgetKept = readOrgQuotas(org.settings, { orgId }).monthlyBudgetUsd !== undefined;
  if (!budgetKept) {
    // Keeps any other cap already set; `writeOrgQuotas` replaces the caps
    // whole, so each attempt reads them afresh: a retry after a clash with a
    // concurrent quotas write merges onto that write, not over it.
    await withConflictRetry(async () => {
      const current = await prisma.org.findUnique({
        where: { id: orgId },
        select: { settings: true },
      });
      const quotas = readOrgQuotas(current?.settings, { orgId });
      if (quotas.monthlyBudgetUsd !== undefined) return;
      await writeOrgQuotas(orgId, { ...quotas, monthlyBudgetUsd: WORKSPACE_MONTHLY_BUDGET_USD });
    });
  }

  // This process at once; other processes within each cache's TTL. A policy
  // read before the grant would otherwise answer "no provider" for up to a
  // minute.
  forgetOrgProviderPolicy(orgId);
  forgetOrgCap(orgId);
  forgetOrgRequestCap(orgId);

  // Never throws; the platformAgents maintenance job catches up on a failure.
  // Imported on use, as `createOrg` does; an import failure is logged too.
  // On a retry it runs whenever the org has a grant, not only when this run
  // wrote it: an earlier attempt may have written the grant and then thrown
  // (or timed out) before its reconcile, and that retry would otherwise skip
  // it for good. The reconcile is idempotent.
  if (options.reconcile && (grant.written || grantKept)) {
    await import('@/lib/orchestration/agents/reconcile-platform-agents')
      .then(({ tryReconcilePlatformAgents }) => tryReconcilePlatformAgents(orgId, source))
      .catch((error: unknown) => {
        logger.error('New workspace agents not reconciled; the maintenance job catches up', error, {
          orgId,
        });
      });
  }

  logger.info('Workspace equipped', { orgId, granted: grant.judges, grantKept, budgetKept });
  return { granted: grant.judges, grantKept, budgetKept };
}

/**
 * Whether the org's provider policy approves the judges' provider. For the
 * smokes, which check that `createWorkspaceOrg` (through the equip hook) left
 * the workspace able to run its judges.
 */
export async function workspaceHasJudgeProvider(orgId: string): Promise<boolean> {
  const [org, provider] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } }),
    prisma.aiProviderConfig.findUnique({
      where: { slug: JUDGE_PROVIDER_SLUG },
      select: { id: true },
    }),
  ]);
  if (!org || !provider) return false;
  return readOrgProviderPolicy(org.settings, { orgId }).approved.includes(provider.id);
}

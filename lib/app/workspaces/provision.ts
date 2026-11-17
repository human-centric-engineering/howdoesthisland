/**
 * A workspace of one's own for every new account (t-7, D1).
 *
 * Under D1 every person works in a workspace, and must be able to run an
 * assessment from their first minute. So an uninvited signup gets a new org,
 * named for them, which they join as its first member and so its `OWNER`
 * (the signup-org seam, `lib/app/signup-org.ts`, does the joining). Before it
 * is handed back the workspace is:
 *
 * - **granted its providers** (`WORKSPACE_PROVIDER_SLUGS`): Anthropic, which
 *   the judges and editor run on (D8, t-39), and OpenAI, which the embedder
 *   runs on. At `multi` every org but the install org starts approved for no
 *   provider, so without this the workspace could call no model at all;
 * - **given the default monthly AI budget**, $10 (D6, owner ruling on open
 *   question 2). There is no billing yet, and every assessment costs money;
 * - **re-reconciled for its platform agents.** `createOrg` gives the org its
 *   platform agents right after the commit, before the grant exists, so the
 *   agents whose provider the platform picks would choose from nothing. The
 *   reconcile runs again once the grant is written.
 * - **marked as a signup workspace** (`settings.app.signupWorkspace`), so the
 *   sweep in `./sweep.ts` can find one whose signup failed after it was made.
 *
 * The org must exist before the user row does (the seam's contract), so a
 * signup that fails after this ran (a double submit racing itself) leaves a
 * workspace nobody belongs to. That sweep erases those.
 *
 * Failures after the org exists are logged at `error` and do not throw: the
 * workspace is still theirs, and a platform admin can grant the provider or
 * set the budget on `/admin`. Throwing would send the person to the install
 * org, the vendor's own, which is worse. A failure to create the org throws,
 * and the seam then falls back to the install org, logged.
 */
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { createOrg, OrgLifecycleError, type OrgRecord } from '@/lib/tenancy/lifecycle';
import { writeOrgProviderPolicy, writeOrgQuotas } from '@/lib/tenancy/org-settings';
import { forgetOrgProviderPolicy } from '@/lib/orchestration/llm/org-provider-policy';
import { forgetOrgCap } from '@/lib/orchestration/llm/spend-caps';
import { forgetOrgRequestCap } from '@/lib/security/org-request-cap';
import type { UninvitedSignup } from '@/lib/tenancy/signup-org';
import { JUDGE_PROVIDER_SLUG, WORKSPACE_PROVIDER_SLUGS } from '@/lib/app/workspaces/provider-slug';
import {
  APP_SETTINGS_KEY,
  withSettingsConflictRetry as withConflictRetry,
  writeAppSettings,
} from '@/lib/app/workspaces/app-settings';

export { APP_SETTINGS_KEY, WORKSPACE_PROVIDER_SLUGS };

/** The monthly AI budget every new workspace starts with, in USD (D6). */
export const WORKSPACE_MONTHLY_BUDGET_USD = 10;

/** The marker a signup workspace carries until someone has joined it. */
export const SIGNUP_WORKSPACE_MARKER = 'signupWorkspace';

/** Longest slug stem taken from a name; the suffix and the cap leave room. */
const SLUG_STEM_MAX = 40;

/** Attempts at a free slug before giving up. Each retry adds a random suffix. */
const SLUG_ATTEMPTS = 4;

/** Longest part of a person's name used in the workspace name. */
const NAME_MAX = 150;

/**
 * The display name a workspace is named for: the name they gave, or the local
 * part of their address when they gave none (an OAuth profile can lack one).
 */
export function workspaceOwnerName(signup: Pick<UninvitedSignup, 'name' | 'email'>): string {
  const name = signup.name.trim() || signup.email.split('@')[0]?.trim() || '';
  return (name || 'My').slice(0, NAME_MAX).trim();
}

/** The workspace's name: "Ada Lovelace's workspace". */
export function workspaceName(signup: Pick<UninvitedSignup, 'name' | 'email'>): string {
  const owner = workspaceOwnerName(signup);
  return owner === 'My' ? 'My workspace' : `${owner}\u2019s workspace`;
}

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
 * the org (a team workspace, t-8); without one the first member becomes it
 * (the signup workspace, joined by the seam).
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
 * Set or clear the signup-workspace marker, preserving every other key in
 * `settings` (the platform's slices and the rest of `app`), through the one
 * writer of the `app` key.
 */
export async function writeSignupWorkspaceMarker(orgId: string, marked: boolean): Promise<void> {
  await writeAppSettings(orgId, (app) => {
    if (marked) app[SIGNUP_WORKSPACE_MARKER] = true;
    else delete app[SIGNUP_WORKSPACE_MARKER];
  });
}

/**
 * Approve the workspace for its providers (`WORKSPACE_PROVIDER_SLUGS`): those
 * of them that exist. Returns whether a grant was written.
 *
 * A provider with no row is left out and logged at `error`; the judges'
 * missing means the workspace's judges and editor have no model until a
 * platform admin creates it and grants it on `/admin`.
 */
async function grantProvider(orgId: string): Promise<boolean> {
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
  if (providers.length === 0) return false;
  // In the list's order, so the stored policy reads the same in every org.
  const approved = WORKSPACE_PROVIDER_SLUGS.flatMap((s) =>
    providers.filter((p) => p.slug === s).map((p) => p.id)
  );
  // No jurisdiction restriction: none is ruled for this app yet.
  await withConflictRetry(() => writeOrgProviderPolicy(orgId, { approved }));
  return true;
}

/**
 * Give a newly created workspace what every workspace starts with: its
 * provider grant and the default budget, then its platform agents again now the
 * grant exists. Shared by the signup workspace and the team workspace (t-8),
 * so the two cannot drift.
 *
 * `firstSteps` run before the grant (the signup workspace's marker). Each
 * step runs on its own and a failure is logged at `error`, never thrown: the
 * org already exists and is the caller's, and a platform admin can finish the
 * set-up on `/admin`.
 *
 * @param source the reconcile's trigger label, for its logs.
 */
export async function equipWorkspace(
  orgId: string,
  source: string,
  firstSteps: Array<[string, () => Promise<unknown>]> = []
): Promise<{ granted: boolean }> {
  /** Runs one step; a failure is logged, never thrown (see above). */
  const attempt = async <T>(step: string, run: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await run();
    } catch (error) {
      logger.error('New workspace not fully set up', error, { orgId, step });
      return undefined;
    }
  };

  for (const [step, run] of firstSteps) await attempt(step, run);
  // Read off the grant's own call, not off a step label a caller could reuse.
  const granted = (await attempt('grant', () => grantProvider(orgId))) === true;
  await attempt('budget', () =>
    withConflictRetry(() =>
      writeOrgQuotas(orgId, { monthlyBudgetUsd: WORKSPACE_MONTHLY_BUDGET_USD })
    )
  );

  // This process at once; other processes within each cache's TTL. A policy
  // read before the grant (the reconcile in `createOrg` reads it) would
  // otherwise answer "no provider" for up to a minute.
  forgetOrgProviderPolicy(orgId);
  forgetOrgCap(orgId);
  forgetOrgRequestCap(orgId);

  // The agents were given out before the grant; give them out again now it
  // exists. Never throws; the maintenance job catches up on a failure.
  // Imported on use, as `createOrg` does; an import failure is logged too.
  if (granted) {
    await import('@/lib/orchestration/agents/reconcile-platform-agents')
      .then(({ tryReconcilePlatformAgents }) => tryReconcilePlatformAgents(orgId, source))
      .catch((error: unknown) => {
        logger.error('New workspace agents not reconciled; the maintenance job catches up', error, {
          orgId,
        });
      });
  }

  return { granted };
}

/**
 * Create a workspace for a person signing up and return its id. See the
 * module header for what it is given and what a failure does.
 */
export async function provisionSignupWorkspace(
  signup: Pick<UninvitedSignup, 'name' | 'email'>
): Promise<string> {
  const name = workspaceName(signup);
  const org = await createWorkspaceOrg(name, slugStem(workspaceOwnerName(signup)));
  const orgId = org.id;

  // The mark goes first: it is what lets the sweep reclaim the org if the
  // signup fails.
  const { granted } = await equipWorkspace(orgId, 'app.signup-workspace', [
    // The writer retries a serializable clash itself.
    ['mark', () => writeSignupWorkspaceMarker(orgId, true)],
  ]);

  logger.info('Signup workspace created', { orgId, slug: org.slug, granted });
  return orgId;
}

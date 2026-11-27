/**
 * Smoke: an uninvited signup gets a workspace of its own (t-7, on Sunrise's
 * seams since t-91), against the real development database at
 * `TENANCY_MODE=multi`.
 *
 *   npx tsx --env-file=.env.local scripts/app/smoke-signup-workspace.ts
 *
 * Signs two people up through the real better-auth hooks, uninvited:
 *
 *   • a password signup — `auth.api.signUpEmail`, as the signup form calls it;
 *   • an OAuth signup — better-auth's own `createOAuthUser` (the call its OAuth
 *     callback makes, address verified) and then `createSession`, as the
 *     callback signs the person in. No real identity provider is reached.
 *
 * For each it reads back what the unit tests cannot, because they mock Prisma:
 *
 *   • exactly one membership: `OWNER` of a new org named "My workspace"
 *     (`lib/app/signup-org.ts`), none in the install org;
 *   • the session's active org is that workspace;
 *   • the workspace is approved for its providers (Anthropic and OpenAI,
 *     `WORKSPACE_PROVIDER_SLUGS`) and has a $10 monthly budget, given by the
 *     org-created hook (`lib/app/org-created.ts`), which is no longer owed.
 *     Sunrise may run the hook after the response, so this waits for it;
 *   • its platform agents exist, and the clean-up assistant (the agent whose
 *     provider the platform picks) is bound to one of them, so it was given
 *     out with the grant in place, not before it.
 *
 * Then an org made by a direct `createOrg` call, as a platform admin's is, is
 * equipped the same way; and running the hook's body again keeps a budget a
 * platform admin changed since (the hook is retried, so it must be
 * idempotent). Sunrise's own sweep of abandoned signup orgs is Sunrise's to
 * test.
 *
 * Needs the setup in `.context/app/dev-environment.md` (the `anthropic` and
 * `openai` provider rows, their models seeded). No provider is called. Email is off for the run
 * (`RESEND_API_KEY=`). Self-cleaning: every user and org it made is erased in
 * `finally`, by tracked id.
 *
 * Exit 0 passed, 1 a check failed.
 *
 * FORK NOTE: this reads the real `lib/app/org-created.ts` and
 * `lib/app/signup-org.ts` on purpose, unmocked: it checks this app's filled
 * seams end to end (the "My workspace" name, the equip hook's grant and
 * budget). Changing either seam should fail it; update the checks with it.
 */
import { randomUUID } from 'node:crypto';
import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';
import { eraseOrg } from '@/lib/privacy/erase-org';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { isMultiTenant, runAsOrg, runAsSystem } from '@/lib/tenancy/context';
import { createOrg } from '@/lib/tenancy/lifecycle';
import {
  readOrgCreatedOwed,
  readOrgProviderPolicy,
  readOrgQuotas,
  writeOrgQuotas,
} from '@/lib/tenancy/org-settings';
import { ORG_OWNER_ROLE } from '@/lib/tenancy/roles';
import {
  WORKSPACE_MONTHLY_BUDGET_USD,
  WORKSPACE_PROVIDER_SLUGS,
  equipWorkspace,
} from '@/lib/app/workspaces/provision';
import { SIGNUP_WORKSPACE_NAME } from '@/lib/app/signup-org';
import { EQUIP_WORKSPACE_HOOK } from '@/lib/app/org-created';

const stamp = `${Date.now()}`;
const userIds: string[] = [];
const orgIds = new Set<string>();
let failures = 0;

function check(ok: boolean, what: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
}

const system = <T>(fn: () => Promise<T>) => runAsSystem('smoke: signup workspace', fn);

/** How long to wait for the org-created hook, which may run after the response. */
const HOOK_WAIT_MS = 15_000;

/** Wait until the org no longer owes the equip hook, or the wait runs out. */
async function hookSettled(orgId: string): Promise<boolean> {
  const until = Date.now() + HOOK_WAIT_MS;
  for (;;) {
    const org = await system(() =>
      prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } })
    );
    const owed = org ? readOrgCreatedOwed(org.settings) : null;
    if (!owed?.owed.includes(EQUIP_WORKSPACE_HOOK)) return true;
    if (Date.now() > until) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** The grant and the budget, read back for one org once its hook has run. */
async function verifyEquipped(orgId: string): Promise<void> {
  check(
    await hookSettled(orgId),
    `the equip hook is no longer owed (waited up to ${HOOK_WAIT_MS} ms)`
  );
  const org = await system(() =>
    prisma.org.findUnique({ where: { id: orgId }, select: { settings: true } })
  );
  const providers = await system(() =>
    prisma.aiProviderConfig.findMany({
      where: { slug: { in: [...WORKSPACE_PROVIDER_SLUGS] } },
      select: { id: true },
    })
  );
  const policy = readOrgProviderPolicy(org?.settings, { orgId });
  check(
    providers.length === WORKSPACE_PROVIDER_SLUGS.length &&
      policy.approved.length === providers.length &&
      providers.every((p) => policy.approved.includes(p.id)),
    `approved for ${WORKSPACE_PROVIDER_SLUGS.join(' and ')}, and nothing else`
  );
  check(
    readOrgQuotas(org?.settings, { orgId }).monthlyBudgetUsd === WORKSPACE_MONTHLY_BUDGET_USD,
    `$${WORKSPACE_MONTHLY_BUDGET_USD} monthly budget`
  );
}

/** Everything the done-when names, read back for one new user. */
async function verify(userId: string): Promise<void> {
  const memberships = await system(() =>
    prisma.orgMembership.findMany({
      where: { userId },
      select: { orgId: true, role: true, org: { select: { name: true } } },
    })
  );
  check(memberships.length === 1, `exactly one membership (found ${memberships.length})`);
  const [membership] = memberships;
  if (!membership) return;
  const orgId = membership.orgId;
  orgIds.add(orgId);

  check(orgId !== INSTALL_ORG_ID, 'not in the install org');
  check(membership.role === ORG_OWNER_ROLE, `OWNER (is ${membership.role})`);
  check(
    membership.org.name === SIGNUP_WORKSPACE_NAME,
    `named "${SIGNUP_WORKSPACE_NAME}" (is "${membership.org.name}")`
  );

  const sessions = await system(() =>
    prisma.session.findMany({ where: { userId }, select: { activeOrgId: true } })
  );
  check(
    sessions.length > 0 && sessions.every((s) => s.activeOrgId === orgId),
    `session active in the workspace (${sessions.length} session(s))`
  );

  await verifyEquipped(orgId);

  // Sunrise places the agents after the hooks, after the response: wait for
  // the clean-up assistant, the last one this smoke reads.
  const readAgents = () =>
    runAsOrg(orgId, () =>
      prisma.aiAgent.findMany({ where: { orgId }, select: { slug: true, provider: true } })
    );
  let agents = await readAgents();
  for (
    const until = Date.now() + HOOK_WAIT_MS;
    !agents.some((a) => a.slug === 'cleanup-agent') && Date.now() < until;
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    agents = await readAgents();
  }
  check(agents.length > 0, `platform agents given out (${agents.length})`);
  const cleanup = agents.find((a) => a.slug === 'cleanup-agent');
  check(
    cleanup !== undefined && WORKSPACE_PROVIDER_SLUGS.includes(cleanup.provider),
    `clean-up assistant bound to a granted provider (is "${cleanup?.provider ?? 'missing'}")`
  );
}

async function main(): Promise<void> {
  if (!isMultiTenant()) {
    console.error('Run at TENANCY_MODE=multi (see .context/app/dev-environment.md).');
    process.exit(1);
  }

  console.log('password signup');
  const ada = { name: `Ada Smoke ${stamp}`, email: `smoke-ws-ada-${stamp}@example.com` };
  const signedUp = await auth.api.signUpEmail({
    body: { ...ada, password: `Smoke-${stamp}-pw!` },
  });
  userIds.push(signedUp.user.id);
  await verify(signedUp.user.id);

  console.log('OAuth signup');
  const grace = { name: `Grace Smoke ${stamp}`, email: `smoke-ws-grace-${stamp}@example.com` };
  const ctx = await auth.$context;
  const created = await ctx.internalAdapter.createOAuthUser(
    { ...grace, emailVerified: true },
    { providerId: 'google', accountId: `smoke-${randomUUID()}` }
  );
  userIds.push(created.user.id);
  await ctx.internalAdapter.createSession(created.user.id);
  await verify(created.user.id);

  console.log('an org made directly, as a platform admin makes one');
  // In a system scope, as the admin route's guard enters one for its handler.
  const direct = await system(() =>
    createOrg({ slug: `smoke-ws-direct-${stamp}`, name: 'Direct Smoke' })
  );
  orgIds.add(direct.id);
  await verifyEquipped(direct.id);

  console.log('the hook run again keeps what an admin set');
  await system(() => writeOrgQuotas(direct.id, { monthlyBudgetUsd: 25 }));
  const again = await system(() => equipWorkspace(direct.id, 'smoke:signup-workspace'));
  const after = await system(() =>
    prisma.org.findUnique({ where: { id: direct.id }, select: { settings: true } })
  );
  check(again.budgetKept && again.grantKept, `the run kept both (${JSON.stringify(again)})`);
  check(
    readOrgQuotas(after?.settings, { orgId: direct.id }).monthlyBudgetUsd === 25,
    'the $25 budget an admin set is still there'
  );
}

main()
  .catch((error: unknown) => {
    console.error('smoke:signup-workspace crashed:', error);
    failures++;
  })
  .finally(async () => {
    // Synthetic accounts, deleted as the platform's smokes delete theirs: no
    // erasure receipt for a person who never existed.
    await system(() => prisma.user.deleteMany({ where: { id: { in: userIds } } })).catch(
      (error: unknown) => console.error('cleanup: users not deleted', error)
    );
    for (const orgId of orgIds) {
      await system(() => eraseOrg({ orgId, actorUserId: 'smoke' })).catch(() => undefined);
    }
    await prisma.$disconnect();
    console.log(
      failures === 0 ? '\nsmoke:signup-workspace passed' : `\n${failures} check(s) failed`
    );
    process.exit(failures === 0 ? 0 : 1);
  });

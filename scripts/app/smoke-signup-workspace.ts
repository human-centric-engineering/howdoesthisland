/**
 * Smoke: an uninvited signup gets a workspace of its own (t-7), against the
 * real development database at `TENANCY_MODE=multi`.
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
 *   • exactly one membership: `OWNER` of a new org named for them, none in the
 *     install org;
 *   • the session's active org is that workspace;
 *   • the workspace is approved for OpenAI and has a $10 monthly budget;
 *   • its platform agents exist, and the clean-up assistant (the agent whose
 *     provider the platform picks) is bound to OpenAI, so it was given out
 *     with the grant in place, not before it.
 *
 * Then it runs the abandoned-workspace sweep with a clock past the grace
 * period: a memberless signup workspace is erased, and the two that were
 * joined are left alone, their marker cleared.
 *
 * Needs the setup in `.context/app/dev-environment.md` (the `openai` provider
 * row, OpenAI models seeded). Nothing reaches OpenAI. Email is off for the run
 * (`RESEND_API_KEY=`). Self-cleaning: every user and org it made is erased in
 * `finally`, by tracked id.
 *
 * Exit 0 passed, 1 a check failed.
 */
import { randomUUID } from 'node:crypto';
import { auth } from '@/lib/auth/config';
import { prisma } from '@/lib/db/client';
import { eraseOrg } from '@/lib/privacy/erase-org';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { isMultiTenant, runAsOrg, runAsSystem } from '@/lib/tenancy/context';
import { readOrgProviderPolicy, readOrgQuotas } from '@/lib/tenancy/org-settings';
import { ORG_OWNER_ROLE } from '@/lib/tenancy/roles';
import {
  WORKSPACE_MONTHLY_BUDGET_USD,
  WORKSPACE_PROVIDER_SLUG,
  provisionSignupWorkspace,
} from '@/lib/app/workspaces/provision';
import { ABANDONED_AFTER_MS, sweepSignupWorkspaces } from '@/lib/app/workspaces/sweep';

const stamp = `${Date.now()}`;
const userIds: string[] = [];
const orgIds = new Set<string>();
let failures = 0;

function check(ok: boolean, what: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures++;
}

const system = <T>(fn: () => Promise<T>) => runAsSystem('smoke: signup workspace', fn);

/** Everything the done-when names, read back for one new user. */
async function verify(userId: string, name: string): Promise<void> {
  const memberships = await system(() =>
    prisma.orgMembership.findMany({
      where: { userId },
      select: { orgId: true, role: true, org: { select: { name: true, settings: true } } },
    })
  );
  check(memberships.length === 1, `exactly one membership (found ${memberships.length})`);
  const [membership] = memberships;
  if (!membership) return;
  const orgId = membership.orgId;
  orgIds.add(orgId);

  check(orgId !== INSTALL_ORG_ID, 'not in the install org');
  check(membership.role === ORG_OWNER_ROLE, `OWNER (is ${membership.role})`);
  check(membership.org.name === `${name}’s workspace`, `named for them ("${membership.org.name}")`);

  const sessions = await system(() =>
    prisma.session.findMany({ where: { userId }, select: { activeOrgId: true } })
  );
  check(
    sessions.length > 0 && sessions.every((s) => s.activeOrgId === orgId),
    `session active in the workspace (${sessions.length} session(s))`
  );

  const provider = await system(() =>
    prisma.aiProviderConfig.findUnique({
      where: { slug: WORKSPACE_PROVIDER_SLUG },
      select: { id: true },
    })
  );
  const policy = readOrgProviderPolicy(membership.org.settings, { orgId });
  check(
    provider !== null && policy.approved.length === 1 && policy.approved[0] === provider.id,
    'approved for OpenAI, and nothing else'
  );
  check(
    readOrgQuotas(membership.org.settings, { orgId }).monthlyBudgetUsd ===
      WORKSPACE_MONTHLY_BUDGET_USD,
    `$${WORKSPACE_MONTHLY_BUDGET_USD} monthly budget`
  );

  const agents = await runAsOrg(orgId, () =>
    prisma.aiAgent.findMany({ where: { orgId }, select: { slug: true, provider: true } })
  );
  check(agents.length > 0, `platform agents given out (${agents.length})`);
  const cleanup = agents.find((a) => a.slug === 'cleanup-agent');
  check(
    cleanup?.provider === WORKSPACE_PROVIDER_SLUG,
    `clean-up assistant bound to OpenAI (is "${cleanup?.provider ?? 'missing'}")`
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
  await verify(signedUp.user.id, ada.name);

  console.log('OAuth signup');
  const grace = { name: `Grace Smoke ${stamp}`, email: `smoke-ws-grace-${stamp}@example.com` };
  const ctx = await auth.$context;
  const created = await ctx.internalAdapter.createOAuthUser(
    { ...grace, emailVerified: true },
    { providerId: 'google', accountId: `smoke-${randomUUID()}` }
  );
  userIds.push(created.user.id);
  await ctx.internalAdapter.createSession(created.user.id);
  await verify(created.user.id, grace.name);

  console.log('abandoned-workspace sweep');
  // A workspace whose signup never finished: provisioned, nobody joined.
  const orphan = await provisionSignupWorkspace({
    name: `Orphan Smoke ${stamp}`,
    email: `smoke-ws-orphan-${stamp}@example.com`,
  });
  orgIds.add(orphan);
  const later = new Date(Date.now() + ABANDONED_AFTER_MS + 60_000);
  const result = await system(() => sweepSignupWorkspaces(later));
  const remaining = await system(() =>
    prisma.org.findMany({
      where: { id: { in: [...orgIds] } },
      select: { id: true, settings: true },
    })
  );
  check(!remaining.some((o) => o.id === orphan), 'the memberless workspace is erased');
  check(
    remaining.length === orgIds.size - 1,
    `the joined workspaces remain (${remaining.length} of ${orgIds.size - 1})`
  );
  check(
    remaining.every((o) => JSON.stringify(o.settings).includes('signupWorkspace') === false),
    'their marker is cleared'
  );
  check(result.failed === 0, `no failures in the pass (${JSON.stringify(result)})`);
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

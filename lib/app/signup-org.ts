/**
 * App signup-org resolver: which org a person who signs up without an
 * invitation joins.
 *
 * **Fork-owned scaffold**, added by this fork with the seam it feeds
 * (`lib/tenancy/signup-org.ts`, t-6). `null` means no resolver: an uninvited
 * signup joins the install org, exactly as before.
 *
 * Set it to a function, and `userCreateBeforeHook` treats an uninvited signup
 * as an invitation into the org it returns. The first member of an org becomes
 * its `OWNER`, and the first session starts in it. Invited signups and the
 * first human on a fresh database (a platform admin) are never asked, nor is a
 * signup whose first-admin bootstrap check failed before it could rule out the
 * first human: that signup takes the install-org default.
 *
 * **Contract.**
 * - Return the id of an org that already exists: it runs before the user row
 *   does. An org it creates for a signup that then fails (a duplicate email,
 *   a double submit) is left with no members, and nothing in this repo sweeps
 *   those yet: a resolver that creates orgs must ship that sweep with it.
 * - A throw, an empty answer, or an org that does not exist or is not `ACTIVE`
 *   falls back to the install org, logged at `error`. The signup is never refused.
 * - Never return an org the person should not be in: every org it names, they
 *   join. A password signup's address is not verified yet (`emailVerified` is
 *   `false`), so never place one by email domain alone: anyone can type
 *   `x@acme.com`.
 * - The first member of an org becomes its `OWNER`, with no admin in the loop.
 *   Never name an org that could have no members but still holds data (one
 *   whose members all left), or that two concurrent signups could both find
 *   empty: both would be recorded as `OWNER`. And if reading the org's member
 *   count fails, the signup is recorded as `MEMBER`, so a new org can end up
 *   with no `OWNER` until a platform admin promotes one.
 * - It runs inside the signup request, so keep it cheap. `createOrg` also runs
 *   the platform-agent reconcile for the new org before it returns.
 *
 * Example — a new workspace per signup:
 *
 *   export const appSignupOrgResolver: SignupOrgResolver | null = async ({ name }) =>
 *     (await createOrg({ slug: `ws-${randomUUID()}`, name: `${name}'s workspace` })).id;
 */
import type { SignupOrgResolver } from '@/lib/tenancy/signup-org';
import { provisionSignupWorkspace } from '@/lib/app/workspaces/provision';

/**
 * HowDoesThisLand (t-7, D1): every uninvited signup gets a workspace of its
 * own, granted OpenAI and the default budget. The orgs it creates for a signup
 * that then fails are erased by the sweep in `lib/app/workspaces/sweep.ts`,
 * registered in `lib/app/jobs.ts`.
 */
export const appSignupOrgResolver: SignupOrgResolver | null = (signup) =>
  provisionSignupWorkspace(signup);

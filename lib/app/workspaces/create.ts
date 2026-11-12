/**
 * Team workspaces: a workspace a person creates for working with others (t-8, D1).
 *
 * The creator is its founding `OWNER`, written in the same transaction as the
 * org (`createOrg`'s `ownerUserId`), so it is never memberless and never
 * carries the signup marker the sweep looks for. It is then equipped exactly
 * as a signup workspace is (`equipWorkspace`): OpenAI granted, the default
 * monthly budget, platform agents reconciled.
 *
 * **The cap.** A person may own at most {@link MAX_OWNED_WORKSPACES}
 * workspaces, their own signup workspace included. It counts the workspaces
 * they hold `OWNER` in rather than the ones they created, because that needs
 * no record of who created what: a workspace they hand to someone else frees
 * a place, and one they are made owner of takes one. The install org is never
 * counted (a platform admin owns it by role, not by choice).
 *
 * The count and the create cannot share a transaction (`createOrg` runs its
 * own), so creates racing from one person can each pass the first check. So
 * the count is taken again once the org exists and **before** it is equipped:
 * one over the cap is erased, never granted a provider or a budget, and the
 * request answers 409 like any other refusal. Racing creates that all see the
 * overshoot all undo themselves, which leaves the person under the cap to try
 * again; that is the price of not holding a lock per person.
 */
import { APIError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { eraseOrg } from '@/lib/privacy/erase-org';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { runAsSystem } from '@/lib/tenancy/context';
import { ORG_OWNER_ROLE } from '@/lib/tenancy/roles';
import { MAX_OWNED_WORKSPACES } from '@/lib/app/workspaces/validations';
import { createWorkspaceOrg, equipWorkspace, slugStem } from '@/lib/app/workspaces/provision';

/** The workspace a caller gets back: what the switcher needs to show it. */
export interface CreatedWorkspace {
  id: string;
  slug: string;
  name: string;
  role: typeof ORG_OWNER_ROLE;
}

/**
 * Refused because the person already owns as many workspaces as allowed. An
 * `APIError`, so a route that lets it propagate answers 409
 * `WORKSPACE_LIMIT_REACHED` through the guard with no mapping of its own.
 */
export class WorkspaceLimitError extends APIError {
  constructor(readonly limit: number) {
    super(
      `You can own at most ${limit} workspaces. Hand one over or leave one to make another.`,
      'WORKSPACE_LIMIT_REACHED',
      409,
      { limit }
    );
    this.name = 'WorkspaceLimitError';
  }
}

/** How many workspaces this person holds `OWNER` in, the install org aside. */
export async function countOwnedWorkspaces(userId: string): Promise<number> {
  return prisma.orgMembership.count({
    where: { userId, role: ORG_OWNER_ROLE, orgId: { not: INSTALL_ORG_ID } },
  });
}

/**
 * Create a team workspace owned by `ownerUserId`. Throws
 * {@link WorkspaceLimitError} past the cap; a failure to create the org
 * propagates. A failure equipping it is logged and does not throw (see
 * `equipWorkspace`): the workspace exists and is theirs.
 */
export async function createTeamWorkspace(input: {
  name: string;
  ownerUserId: string;
}): Promise<CreatedWorkspace> {
  const owned = await countOwnedWorkspaces(input.ownerUserId);
  if (owned >= MAX_OWNED_WORKSPACES) throw new WorkspaceLimitError(MAX_OWNED_WORKSPACES);

  const org = await createWorkspaceOrg(input.name, slugStem(input.name), input.ownerUserId);
  if ((await countOwnedWorkspaces(input.ownerUserId)) > MAX_OWNED_WORKSPACES) {
    await undoOverCapWorkspace(org.id, input.ownerUserId);
    throw new WorkspaceLimitError(MAX_OWNED_WORKSPACES);
  }
  const { granted } = await equipWorkspace(org.id, 'app.team-workspace');

  logger.info('Team workspace created', {
    orgId: org.id,
    slug: org.slug,
    ownerUserId: input.ownerUserId,
    granted,
  });
  return { id: org.id, slug: org.slug, name: org.name, role: ORG_OWNER_ROLE };
}

/** Who `eraseOrg` records as the actor when a create past the cap is undone. */
export const CAP_UNDO_ACTOR = 'app:team-workspace-cap';

/**
 * Erase a workspace a racing create made past the cap. System scope, as the
 * signup sweep erases: the request entered the caller's current org, not this
 * one. A failure is logged and swallowed, since the refusal stands either way:
 * the org has its owner but no grant or budget, so it can spend nothing, and a
 * platform admin can erase it.
 */
async function undoOverCapWorkspace(orgId: string, ownerUserId: string): Promise<void> {
  try {
    await runAsSystem('app.team-workspace: undo a create past the ownership cap', () =>
      eraseOrg({ orgId, actorUserId: CAP_UNDO_ACTOR })
    );
    logger.warn('Team workspace past the ownership cap was undone', { orgId, ownerUserId });
  } catch (error) {
    logger.error('Team workspace past the ownership cap could not be undone', error, {
      orgId,
      ownerUserId,
    });
  }
}

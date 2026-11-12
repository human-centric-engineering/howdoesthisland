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
 * The count and the create are not one transaction, so two creates racing
 * from the same person can each pass the check and land one over. The cap is
 * a limit on clutter and spend, not a security boundary, and the section rate
 * limit bounds how far a race can go; a lock per person was judged not worth
 * its cost.
 */
import { APIError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
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
  const { granted } = await equipWorkspace(org.id, 'app.team-workspace');

  logger.info('Team workspace created', {
    orgId: org.id,
    slug: org.slug,
    ownerUserId: input.ownerUserId,
    granted,
  });
  return { id: org.id, slug: org.slug, name: org.name, role: ORG_OWNER_ROLE };
}

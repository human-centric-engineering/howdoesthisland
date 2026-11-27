/**
 * Where a workspace falls among those its owner owns (t-8, t-91).
 *
 * Shared by the team-workspace create (`./create.ts`), which erases a racer
 * ranked past {@link MAX_OWNED_WORKSPACES}, and the equip hook
 * (`lib/app/org-created.ts`), which leaves that racer unequipped, so a failed
 * erase leaves an org with no provider and no budget. Its own module because
 * `create.ts` imports `provision.ts`, which `createOrg` loads through the hook.
 *
 * `OrgMembership` is a system model, so the ranking reads every org's rows
 * whatever tenant scope it runs in.
 */
import { prisma } from '@/lib/db/client';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { ORG_OWNER_ROLE } from '@/lib/tenancy/roles';
import { MAX_OWNED_WORKSPACES } from '@/lib/app/workspaces/validations';

/**
 * Where `orgId` falls among the workspaces this person owns, earliest first
 * (0-based; ties broken by membership id so every reader agrees). The
 * install org is left out, as the count leaves it out.
 */
export async function ownedWorkspaceRank(userId: string, orgId: string): Promise<number> {
  const owned = await prisma.orgMembership.findMany({
    where: { userId, role: ORG_OWNER_ROLE, orgId: { not: INSTALL_ORG_ID } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { orgId: true },
  });
  const rank = owned.findIndex((membership) => membership.orgId === orgId);
  // Not found means the membership is not visible: treat it as past the cap
  // rather than equip a workspace the ranking could not place.
  return rank === -1 ? Number.POSITIVE_INFINITY : rank;
}

/** Whether `orgId` ranks past the cap among the workspaces `userId` owns. */
export async function isPastOwnershipCap(userId: string, orgId: string): Promise<boolean> {
  return (await ownedWorkspaceRank(userId, orgId)) >= MAX_OWNED_WORKSPACES;
}

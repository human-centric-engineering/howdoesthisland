/**
 * Erase signup workspaces nobody ever joined (t-7).
 *
 * The signup-org seam needs the org to exist before the user row does, so
 * `provisionSignupWorkspace` creates it first. A signup that then fails (two
 * submits of the same form racing, a database error writing the user) leaves
 * a workspace with no members. Nobody can reach it, and it holds nothing but
 * what was given to it at creation: its platform agents and settings.
 *
 * Each workspace carries a marker from creation until someone has joined it.
 * This sweep, for every marked workspace:
 *
 * - **with a member**: clears the marker. The signup succeeded, and from now
 *   on the workspace is never this sweep's to touch, even if everyone later
 *   leaves it or erases their account.
 * - **with no member, older than {@link ABANDONED_AFTER_MS}**: erases it with
 *   `eraseOrg`, the platform's own org erasure. The grace period is far longer
 *   than any signup request, so a signup still in flight is never swept.
 *
 * An org a platform admin creates is never marked, so never swept.
 *
 * Idempotent: a second pass finds nothing marked that the first did not
 * settle. Registered in `lib/app/jobs.ts` under a system scope, since `Org`
 * is a system model and the pass spans every org.
 */
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { eraseOrg } from '@/lib/privacy/erase-org';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import {
  APP_SETTINGS_KEY,
  SIGNUP_WORKSPACE_MARKER,
  writeSignupWorkspaceMarker,
} from '@/lib/app/workspaces/provision';

/** How long a memberless signup workspace is left before it is erased. */
export const ABANDONED_AFTER_MS = 60 * 60 * 1000;

/** Who `eraseOrg` logs as the actor: this job, not a person. */
export const SWEEP_ACTOR = 'app:signup-workspace-sweep';

export interface SignupWorkspaceSweepResult {
  /** Marked workspaces someone had joined; their marker was cleared. */
  settled: number;
  /** Memberless workspaces past the grace period that were erased. */
  erased: number;
  /** Workspaces a step failed on; retried next pass. */
  failed: number;
}

export async function sweepSignupWorkspaces(
  now: Date = new Date()
): Promise<SignupWorkspaceSweepResult> {
  const marked = await prisma.org.findMany({
    where: { settings: { path: [APP_SETTINGS_KEY, SIGNUP_WORKSPACE_MARKER], equals: true } },
    select: { id: true, createdAt: true, _count: { select: { memberships: true } } },
  });

  const result: SignupWorkspaceSweepResult = { settled: 0, erased: 0, failed: 0 };
  const cutoff = now.getTime() - ABANDONED_AFTER_MS;

  for (const org of marked) {
    // Never the install org, whatever its settings say.
    if (org.id === INSTALL_ORG_ID) continue;
    try {
      if (org._count.memberships > 0) {
        await writeSignupWorkspaceMarker(org.id, false);
        result.settled++;
      } else if (org.createdAt.getTime() <= cutoff) {
        await eraseOrg({ orgId: org.id, actorUserId: SWEEP_ACTOR });
        logger.info('Abandoned signup workspace erased', { orgId: org.id });
        result.erased++;
      }
    } catch (error) {
      logger.error('Signup workspace sweep failed for an org; retried next pass', error, {
        orgId: org.id,
      });
      result.failed++;
    }
  }
  return result;
}

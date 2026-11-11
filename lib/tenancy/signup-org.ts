/**
 * Which org an uninvited signup joins — a fork-carried seam (t-6; see the
 * divergence ledger, `.context/app/platform-divergences.md`).
 *
 * Without a resolver, an uninvited signup joins the install org: `MEMBER`, or
 * `OWNER` for a real platform admin ({@link initialMembershipFor}). At
 * `TENANCY_MODE=multi` the install org is the vendor's own, so an app whose
 * customers sign themselves up needs them to land somewhere else. The
 * user-created hooks run too late to do that safely: the person is already a
 * member of the vendor's org, the first session is already pinned to it, and a
 * hook that fails is swallowed.
 *
 * So `userCreateBeforeHook` asks {@link uninvitedSignupAdmission} while it
 * decides the membership, and treats the answer as an invitation into that org.
 * The rules an invitation follows then apply unchanged: the first member of an
 * org becomes its `OWNER`; at `single` the install-org floor is added too
 * (#872); the decision is recorded on the user row and carried to the session,
 * so the first session's `activeOrgId` is the resolved org.
 *
 * The resolver is not asked for an invited signup (the invitation decides), nor
 * for a platform admin — the first human on a fresh database, whose home is the
 * install org they administer.
 *
 * Every failure falls back to the install org, logged at `error`: a resolver
 * that throws, answers nothing, or names an org that does not exist. Failing
 * the signup instead would turn a fault in the fork's code into a person who
 * cannot create an account.
 *
 * @see lib/app/signup-org.ts — the fork-owned registration
 */
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { isPlatformAdmin } from '@/lib/auth/roles';
import { appSignupOrgResolver } from '@/lib/app/signup-org';
import type { AcceptedInvitation, NewUserShape } from '@/lib/tenancy/membership';

/** What the resolver is told about the person signing up. */
export interface UninvitedSignup {
  /** The address they signed up with. Not yet verified for a password signup. */
  email: string;
  /** Their display name, as supplied at signup. */
  name: string;
}

/**
 * Answers the id of the org an uninvited signup joins. Runs before the user row
 * exists, so the org it names must already exist.
 */
export type SignupOrgResolver = (
  signup: UninvitedSignup
) => Promise<string | null | undefined> | string | null | undefined;

/**
 * The admission an uninvited signup gets from the fork's resolver: the org it
 * names, shaped as an invitation naming that org and nothing else, or `null`
 * for today's install-org default.
 */
export async function uninvitedSignupAdmission(
  user: NewUserShape & UninvitedSignup,
  resolver: SignupOrgResolver | null = appSignupOrgResolver,
  db: Pick<PrismaClient, 'org'> = prisma
): Promise<AcceptedInvitation | null> {
  if (!resolver || isPlatformAdmin(user)) return null;

  let orgId: unknown;
  try {
    orgId = await resolver({ email: user.email, name: user.name });
  } catch (error) {
    logger.error('Signup org resolver failed; the signup joins the install org', error, {
      email: user.email,
    });
    return null;
  }
  if (typeof orgId !== 'string' || orgId.length === 0) {
    logger.error('Signup org resolver named no org; the signup joins the install org', {
      email: user.email,
    });
    return null;
  }

  try {
    const org = await db.org.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) {
      logger.error(
        'Signup org resolver named an org that does not exist; the signup joins the install org',
        {
          email: user.email,
          orgId,
        }
      );
      return null;
    }
  } catch (error) {
    logger.error(
      'Failed to read the org the signup org resolver named; the signup joins the install org',
      error,
      {
        email: user.email,
        orgId,
      }
    );
    return null;
  }
  return { orgId };
}

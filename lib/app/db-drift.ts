/**
 * App database drift-probe registrations.
 *
 * **Fork-owned scaffold** — Sunrise ships this empty and does NOT change it
 * after release, so your edits here merge cleanly on upgrade (the stable
 * contract is this file's export, not its body). Treat it like the landing
 * page: a starting point you're expected to modify.
 *
 * Auto-wired: `scripts/db/check-drift.ts` (run by `npm run db:drift-check`, in
 * CI, and by `/pre-pr`) calls this once, then probes everything you register
 * here alongside Sunrise's own A-series objects.
 *
 * Register the Prisma-*unmodelled* objects your app adds: custom indexes,
 * CHECK constraints, and the hand-written FK behind a satellite `User` table
 * built with the plain-FK pattern (CUSTOMIZATION.md §5). Prisma can't see
 * those, so without a probe a future `migrate dev` can silently drop one and
 * CI won't notice. A new satellite table uses a Prisma `@relation` instead,
 * with its back-relation in `User`'s app zone; Prisma models that FK, so it
 * needs no probe here.
 *
 * Example (a plain-FK satellite table from CUSTOMIZATION.md §5):
 *
 *   import {
 *     registerAppDriftProbe,
 *     constraintExists,
 *   } from '@/lib/db/drift-probes';
 *
 *   export function registerAppDriftProbes(): void {
 *     registerAppDriftProbe({
 *       name: 'AppUserProfile_userId_fkey (hand-written FK → User)',
 *       kind: 'FK constraint',
 *       table: 'AppUserProfile',
 *       // 2nd arg asserts the constraint definition text — pin the ON DELETE
 *       // action so a fork can't quietly drop the GDPR cascade.
 *       probe: constraintExists('AppUserProfile_userId_fkey', 'ON DELETE CASCADE'),
 *     });
 *   }
 *
 * Available probe factories from `@/lib/db/drift-probes`: `indexExists`,
 * `constraintExists` (optional definition-substring assertion), `columnExists`,
 * `generatedColumnExists`, plus `rlsEnabled` (asserts ENABLE and, by default,
 * FORCE) and `policyExists`. You do NOT need the last two for a model that
 * carries `orgId`: `db:drift-check` already derives them for every
 * tenant-owned table (`tenancyDriftProbes`, §107 — `policyExists` in both
 * modes, `rlsEnabled` at TENANCY_MODE=multi), yours included. They are
 * for RLS you hand-roll on a table OUTSIDE that set — and then register BOTH
 * per table: a policy can exist while RLS is disabled, and vice versa. For a
 * `GENERATED ALWAYS` column use `generatedColumnExists` —
 * `columnExists` passes on a plain column of the same name, which is never
 * populated, so the check goes green while the feature is silently broken.
 *
 * Full guide: CUSTOMIZATION.md §5 · .context/database/prisma-unmodelled-objects.md
 */
import { registerAppDriftProbe, constraintExists } from '@/lib/db/drift-probes';

export function registerAppDriftProbes(): void {
  // t-9: the hand-written FKs from a workspace invitation to `user` (the
  // migration header says why they are not Prisma relations). The ON DELETE
  // action is pinned: CASCADE takes an invitee's invitations with their
  // account, SET NULL keeps the workspace's record when the inviter goes.
  registerAppDriftProbe({
    name: 'app_workspace_invitation_userId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_workspace_invitation',
    probe: constraintExists('app_workspace_invitation_userId_fkey', 'ON DELETE CASCADE'),
  });
  registerAppDriftProbe({
    name: 'app_workspace_invitation_invitedByUserId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_workspace_invitation',
    probe: constraintExists('app_workspace_invitation_invitedByUserId_fkey', 'ON DELETE SET NULL'),
  });
  // t-22: the hand-written FKs from content and assessments to `user` and
  // `ai_api_key` (the migration header says why). All SET NULL: the rows are
  // the workspace's and outlive a member's erasure or a revoked key.
  for (const [table, constraint, target] of [
    ['app_content', 'app_content_createdByUserId_fkey', 'user'],
    ['app_assessment', 'app_assessment_createdByUserId_fkey', 'user'],
    ['app_assessment', 'app_assessment_apiKeyId_fkey', 'ai_api_key'],
  ] as const) {
    registerAppDriftProbe({
      name: `${constraint} (hand-written FK → ${target})`,
      kind: 'FK constraint',
      table,
      probe: constraintExists(constraint, 'ON DELETE SET NULL'),
    });
  }
  // t-32: the hand-written FK from a share link to `user`. SET NULL: the link
  // is the workspace's and outlives its maker's erasure.
  registerAppDriftProbe({
    name: 'app_report_share_createdByUserId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_report_share',
    probe: constraintExists('app_report_share_createdByUserId_fkey', 'ON DELETE SET NULL'),
  });
  // t-37: the hand-written FK from a calibration run to `user`. SET NULL: the
  // run is the install's record of a version's calibration.
  registerAppDriftProbe({
    name: 'app_calibration_run_startedByUserId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_calibration_run',
    probe: constraintExists('app_calibration_run_startedByUserId_fkey', 'ON DELETE SET NULL'),
  });
  // t-57: the hand-written FK from a credit entry to `user`. SET NULL: the
  // ledger is the workspace's and outlives its actor's erasure.
  registerAppDriftProbe({
    name: 'app_credit_entry_actorUserId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_credit_entry',
    probe: constraintExists('app_credit_entry_actorUserId_fkey', 'ON DELETE SET NULL'),
  });
  // t-59: the hand-written FK from a free review code to its maker. SET NULL:
  // the code outlives its maker's erasure.
  registerAppDriftProbe({
    name: 'app_review_code_createdByUserId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_review_code',
    probe: constraintExists('app_review_code_createdByUserId_fkey', 'ON DELETE SET NULL'),
  });
  // t-60: the hand-written FK from a redemption to who redeemed. SET NULL: a
  // use outlives the person's erasure, so the code's count never goes down.
  registerAppDriftProbe({
    name: 'app_review_code_redemption_userId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_review_code_redemption',
    probe: constraintExists('app_review_code_redemption_userId_fkey', 'ON DELETE SET NULL'),
  });
  // t-70: the hand-written FK from a project to its maker. SET NULL: the
  // project is the workspace's and outlives its maker's erasure.
  registerAppDriftProbe({
    name: 'app_project_createdByUserId_fkey (hand-written FK → user)',
    kind: 'FK constraint',
    table: 'app_project',
    probe: constraintExists('app_project_createdByUserId_fkey', 'ON DELETE SET NULL'),
  });
}

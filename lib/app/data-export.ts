/**
 * App subject-data export seam (GDPR Art. 15).
 *
 * **Fork-owned scaffold** — Sunrise ships this returning nothing and does NOT
 * change it after release, so your edits here merge cleanly on upgrade (the
 * stable contract is this file's `collectAppSubjectData` export, not its body).
 * Treat it like the other `lib/app/*` seams.
 *
 * Auto-wired: `exportUserData()` (`lib/privacy/export-user.ts`) calls this and
 * folds the result into the `app` section of the export bundle, so both the
 * self-service and admin export endpoints pick it up with no core edit.
 *
 * Declare every app-owned table that holds data about a person. Core covers its
 * own tables via `lib/privacy/export-sources.ts`; it cannot see yours.
 *
 * ```ts
 * export async function collectAppSubjectData({ userId }: AppSubjectQuery): Promise<AppSubjectData> {
 *   const [invoices, bookings] = await Promise.all([
 *     prisma.appInvoice.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
 *     prisma.appBooking.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
 *   ]);
 *   return { invoices, bookings };
 * }
 * ```
 *
 * **Why a plain function and not a registry.** The erasure sibling
 * (`lib/privacy/erasure-hooks.ts`) is a boot-time registry, and this seam
 * deliberately is not. Erasure fails loudly if a hook never registers — the
 * rows are still there afterwards. An export fails *silently*: an unregistered
 * collector yields a bundle that looks complete and is not, and neither the
 * subject nor the operator can tell. A static import cannot be missed.
 *
 * **Keep it complete — and core now checks that you did.** Declare your tables
 * in `initAppSubjectSources()` below. The core guard test
 * (`export-sources.test.ts`) diffs `prisma/schema/*.prisma` against the core
 * manifest so a new core table can't quietly narrow the export, and it holds
 * your tier's schema file to the same rule against your declarations: **every**
 * model in a schema file that is not one of Sunrise's own — `app.prisma`,
 * `framework-*.prisma`, or any other name you choose — must be declared as a
 * source or excluded with a reason, or the suite fails naming it.
 *
 * Full accounting, rather than the user-id heuristic core applies to itself,
 * because core reads its own column vocabulary and cannot read yours: a table
 * keyed `authorId` or `respondentId` is invisible to that scan, and the tables
 * it cannot see are exactly the ones nobody remembers. A lookup or join table
 * holding no personal data is an `excluded` row with a one-line reason — which
 * is the note a DPO wants anyway, and it costs you a line once per table.
 *
 * Full guide: .context/privacy/data-export.md · CUSTOMIZATION.md §4
 */
import { prisma } from '@/lib/db/client';
import { registerAppSubjectSources } from '@/lib/privacy/subject-source-registry';

/** Identity of the subject being exported. */
export interface AppSubjectQuery {
  /** Id of the data subject. */
  userId: string;
  /** The subject's email — for app tables keyed by address rather than user id. */
  email: string;
}

/**
 * App-owned subject data, keyed by section name. Each section lands under
 * `app.<section>` in the export bundle. Values must be JSON-serialisable.
 */
export type AppSubjectData = Record<string, unknown>;

/**
 * Declare which of your tier's models hold data about a person, and which
 * deliberately do not.
 *
 * **Fork-owned scaffold**, run once and lazily by
 * `lib/privacy/subject-source-registry.ts` before its first read — so the
 * coverage guard and the export both see your declarations with no wiring step.
 *
 * ```ts
 * export function initAppSubjectSources(): void {
 *   registerAppSubjectSources({
 *     tier: 'app',
 *     sources: [
 *       {
 *         model: 'AppInvoice',
 *         section: 'invoices',
 *         disposition: 'export',
 *         description: 'Invoices raised against your account.',
 *       },
 *     ],
 *     excluded: [
 *       { model: 'AppCountry', reason: 'Reference list of countries — holds no personal data.' },
 *     ],
 *   });
 * }
 * ```
 *
 * A framework tier declares from its own init with `tier: 'framework'`; both
 * tiers register independently, so filling this in does not consume the slot a
 * leaf fork is entitled to.
 *
 * **Every `section` you declare must appear in what `collectAppSubjectData()`
 * returns** — `exportUserData()` throws if one is missing. Return the key with
 * an empty array when the subject has no rows rather than omitting it: a bundle
 * short by a section reads exactly like a complete answer. `undefined` counts
 * as missing, because `JSON.stringify` drops the key — so
 * `rows.length ? rows : undefined` is the shape to avoid.
 */
export function initAppSubjectSources(): void {
  registerAppSubjectSources({
    tier: 'app',
    sources: [
      {
        model: 'WorkspaceInvitation',
        section: 'workspaceInvitations',
        disposition: 'export',
        description:
          'Invitations into a workspace that were sent to you, and the ones you sent (without who they went to).',
      },
      {
        model: 'Content',
        section: 'contents',
        disposition: 'export',
        description: 'Texts you added to a workspace to be assessed, with where each came from.',
      },
      {
        model: 'Assessment',
        section: 'assessments',
        disposition: 'export',
        description:
          'Assessments you asked for, with their scores and results, and what their project gave the AI reviewers.',
      },
      {
        model: 'ReportShare',
        section: 'reportShares',
        disposition: 'export',
        description:
          'Links you made to share a report, with when each expires, whether it was revoked and how often it was opened.',
      },
      {
        model: 'CalibrationRun',
        section: 'calibrationRuns',
        disposition: 'export',
        description:
          'Calibration runs you started against a framework version, with how often the judges agreed with the expected results.',
      },
      {
        model: 'CreditEntry',
        section: 'creditEntries',
        disposition: 'export',
        description:
          'Changes you made to a workspace’s CopyCredits: credits you granted or adjusted as an admin, and codes you redeemed.',
      },
      {
        model: 'Project',
        section: 'projects',
        disposition: 'export',
        description:
          'Projects you made in a workspace: their name, brief, the defaults their reviews take, and their weighting.',
      },
      {
        model: 'ProjectDocument',
        section: 'projectDocuments',
        disposition: 'export',
        description:
          'Context documents you added to a workspace’s projects: the name each is shown by, and the file or page it came from.',
      },
      {
        model: 'ReviewCode',
        section: 'reviewCodes',
        disposition: 'export',
        description:
          'Free review codes you made as an admin: their campaign, credits, limits and expiry, without the codes themselves or the keys their callers sent.',
      },
      {
        model: 'ReviewCodeRedemption',
        section: 'codeRedemptions',
        disposition: 'export',
        description:
          'Free review codes you redeemed: when, into which workspace, and the credits each gave.',
      },
    ],
    excluded: [
      // The framework store (t-10): shared model records, with no link to any person.
      ...['Framework', 'FrameworkVersion', 'FrameworkNode', 'FrameworkLink'].map((model) => ({
        model,
        reason: 'Shared model records (the persuasion framework), with no user column.',
      })),
      {
        model: 'JudgeRun',
        reason:
          'One judge’s part of an assessment, with no user column; what it found is in the assessment’s result, which is exported.',
      },
      {
        model: 'JudgeReply',
        reason:
          'One judge’s reply within an assessment, with no user column; what it found is in the assessment’s result, which is exported.',
      },
      {
        model: 'AssessmentPlace',
        reason:
          'A lease a review kept nowhere holds while it runs, deleted when it ends; it has no user column and records nothing about anyone.',
      },
      {
        model: 'BudgetHold',
        reason:
          'A lease on part of the monthly budget a review request holds until its review is stored or its run ends, deleted then; it has no user column and records nothing about anyone.',
      },
    ],
  });
}

/**
 * Collect this app's data about one subject. Ships empty — vanilla Sunrise has
 * no app tables, so the export's `app` section is `{}`.
 */
/*
 * `async` is the seam's contract, not an implementation detail: every real
 * collector awaits its queries, and the empty default must not force forks to
 * change the signature just to add one.
 */
export async function collectAppSubjectData({ userId }: AppSubjectQuery): Promise<AppSubjectData> {
  const [
    received,
    sent,
    contents,
    assessments,
    reportShares,
    calibrationRuns,
    creditEntries,
    projects,
    projectDocuments,
    reviewCodes,
    codeRedemptions,
  ] = await Promise.all([
    // The ones to them, without the inviter's id (their name is in the
    // invitation email, and the id is someone else's data).
    prisma.workspaceInvitation.findMany({
      where: { userId },
      omit: { invitedByUserId: true },
      orderBy: { createdAt: 'asc' },
    }),
    // The ones they sent, without the invitee: that is someone else's data.
    prisma.workspaceInvitation.findMany({
      where: { invitedByUserId: userId },
      omit: { userId: true },
      orderBy: { createdAt: 'asc' },
    }),
    // What they added and asked for (t-22). The workspace keeps these rows
    // after they leave; this is their copy of what they created.
    prisma.content.findMany({
      where: { createdByUserId: userId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.assessment.findMany({
      where: { createdByUserId: userId },
      // The lease is the job's bookkeeping, not data about anyone.
      omit: { leaseToken: true, leaseExpiresAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    // The links they made (t-32), without the token's hash: it is the
    // credential's verifier, not data about anyone.
    prisma.reportShare.findMany({
      where: { createdByUserId: userId },
      omit: { tokenHash: true },
      orderBy: { createdAt: 'asc' },
    }),
    // The calibration runs they started (t-37). Without the rows: those are
    // the calibration set's texts scored, the same for whoever runs them.
    prisma.calibrationRun.findMany({
      where: { startedByUserId: userId },
      omit: { rows: true },
      orderBy: { createdAt: 'asc' },
    }),
    // The changes to a workspace's credits they made (t-57). A charge carries
    // no actor, so these are an admin's grants and adjustments, and codes the
    // subject redeemed.
    prisma.creditEntry.findMany({
      where: { actorUserId: userId },
      orderBy: { createdAt: 'asc' },
    }),
    // The projects they made (t-70). The workspace keeps them after they
    // leave; this is their copy of what they wrote in the brief.
    prisma.project.findMany({
      where: { createdByUserId: userId },
      orderBy: { createdAt: 'asc' },
    }),
    // The documents they added to projects (t-74). The text is in the
    // knowledge base, whose own source gives them what they uploaded.
    prisma.projectDocument.findMany({
      where: { addedByUserId: userId },
      orderBy: { createdAt: 'asc' },
    }),
    // The codes they made as an admin (t-59), without the code, a bearer
    // credential for the install's credits, or the idempotency key, a
    // caller's bookkeeping that may carry someone else's id (a lead's).
    prisma.reviewCode.findMany({
      where: { createdByUserId: userId },
      omit: { code: true, idempotencyKey: true },
      orderBy: { createdAt: 'asc' },
    }),
    // The codes they redeemed (t-60). The row names the code by id, not the
    // code itself.
    prisma.reviewCodeRedemption.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return {
    workspaceInvitations: [
      ...received.map((row) => ({ ...row, yourPart: 'invitee' as const })),
      ...sent.map((row) => ({ ...row, yourPart: 'inviter' as const })),
    ],
    contents,
    assessments,
    reportShares,
    calibrationRuns,
    creditEntries,
    projects,
    projectDocuments,
    reviewCodes,
    codeRedemptions,
  };
}

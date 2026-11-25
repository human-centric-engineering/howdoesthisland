/**
 * App recurring-job registrations.
 *
 * **Fork-owned scaffold** — Sunrise ships this empty and does NOT change it
 * after release, so your edits here merge cleanly on upgrade (the stable
 * contract is this file's export, not its body). Treat it like the other
 * `lib/app/*` seams.
 *
 * Auto-wired: the maintenance tick calls this once before it first runs app jobs
 * (server runtime). Add `registerAppJob({ name, intervalMs, run })` calls to run
 * your own periodic work on the existing tick instead of standing up a second
 * scheduler:
 *
 *   import { registerAppJob } from '@/lib/orchestration/maintenance/app-jobs';
 *
 *   export function initAppJobs(): void {
 *     registerAppJob({
 *       name: 'app:prune-draft-invoices',
 *       intervalMs: 6 * 60 * 60 * 1000, // 6 hours
 *       run: async () => {
 *         const { count } = await prisma.appInvoice.deleteMany({ ... });
 *         return { pruned: count };   // folded into the tick's log line
 *       },
 *     });
 *   }
 *
 * `intervalMs` is a **minimum** gap, not a guarantee, and last-run times live in
 * process memory — so a multi-instance deployment runs each job about once per
 * instance per interval, and a restart re-arms everything. Write jobs to be
 * idempotent. If a job must run exactly once cluster-wide it needs its own lease;
 * see `execution-reaper` for that pattern.
 *
 * Empty registry = today's behaviour, byte-for-byte.
 *
 * Full guide: CUSTOMIZATION.md §4 · .context/orchestration/scheduling.md
 */
import { registerAppJob } from '@/lib/orchestration/maintenance/app-jobs';
import { recoverAssessments } from '@/lib/app/assessments/recover';
import { sweepSignupWorkspaces } from '@/lib/app/workspaces/sweep';
import { purgeExpiredContent } from '@/lib/app/retention/purge';
import { recoverRewrites } from '@/lib/app/rewrites/recover';
import { recoverVerdicts } from '@/lib/app/comparisons/verdict';

/** The signup-workspace sweep's name, as the tick logs it. */
export const SIGNUP_WORKSPACE_SWEEP_JOB = 'app:signup-workspace-sweep';

/** The assessment recovery job's name, as the tick logs it. */
export const ASSESSMENT_RECOVERY_JOB = 'app:assessment-recovery';

/** The rewrite recovery job's name, as the tick logs it. */
export const REWRITE_RECOVERY_JOB = 'app:rewrite-recovery';

/** The comparison-verdict recovery job's name, as the tick logs it. */
export const VERDICT_RECOVERY_JOB = 'app:comparison-verdict-recovery';

/** The retention purge's name, as the tick logs it. */
export const RETENTION_PURGE_JOB = 'app:retention-purge';

export function initAppJobs(): void {
  // Erase signup workspaces nobody joined (t-7). Org is a system model and the
  // pass spans every org, so it runs once under the system scope.
  registerAppJob({
    name: SIGNUP_WORKSPACE_SWEEP_JOB,
    intervalMs: 15 * 60 * 1000,
    scope: { system: 'signup workspaces span orgs; Org is a system model' },
    run: () => sweepSignupWorkspaces(),
  });

  // Re-drive assessments whose run died or never started, and give up on
  // those out of attempts (t-22). Per workspace: each pass sees and claims
  // only its own rows, and counts its own running limit.
  registerAppJob({
    name: ASSESSMENT_RECOVERY_JOB,
    // The backstop, not the queue's driver: a run that ends starts the
    // workspace's next queued assessment itself (`runAssessment`). At the
    // signup sweep's 15 minutes it keeps the idle gate (#442) where that job
    // already holds it, so a scale-to-zero database can still suspend.
    intervalMs: 15 * 60 * 1000,
    scope: 'per-org',
    run: () => recoverAssessments(),
  });

  // Fail and charge rewrites whose process died (t-81): until then each
  // holds its estimate of the workspace's budget. Per workspace, at the
  // assessment recovery's interval, for the same reason.
  registerAppJob({
    name: REWRITE_RECOVERY_JOB,
    intervalMs: 15 * 60 * 1000,
    scope: 'per-org',
    run: () => recoverRewrites(),
  });

  // Start comparison verdicts that are due and have none (t-88): the last
  // draft ended in a process that died before starting it, or by a delete,
  // or the verdict's own process died. Until then each holds its estimate of
  // the workspace's budget. Per workspace, at the same interval.
  registerAppJob({
    name: VERDICT_RECOVERY_JOB,
    intervalMs: 15 * 60 * 1000,
    scope: 'per-org',
    run: () => recoverVerdicts(),
  });

  // Delete content and assessments past the workspace's window, and judge
  // replies past theirs (30 days unless set) (t-26, D10). Per workspace: each
  // pass reads its own windows and touches only its own rows. Daily: the
  // windows are counted in days, so a row goes at most a day late.
  registerAppJob({
    name: RETENTION_PURGE_JOB,
    intervalMs: 24 * 60 * 60 * 1000,
    scope: 'per-org',
    run: () => purgeExpiredContent(),
  });
}

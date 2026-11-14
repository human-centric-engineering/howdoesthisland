/**
 * The assessment job's limits (t-22, app-plan §8.2).
 *
 * Constants until f-usage measures them. Each is the reason behind a rule the
 * job enforces, so a change here is a change in behaviour, not a tuning knob.
 */

/** Judges in flight at once within one assessment run. */
export const JUDGES_IN_FLIGHT = 4;

/**
 * Assessments `RUNNING` at once in one workspace, counted from rows. A run
 * that would be the next one stays `QUEUED`, and the next run to end starts
 * it (the recovery job is the backstop).
 */
export const RUNNING_PER_WORKSPACE = 3;

/** Runs started on one assessment before the recovery job gives up on it. */
export const MAX_ATTEMPTS = 3;

/**
 * How long a run holds its lease without renewing it. A run renews every
 * {@link LEASE_RENEW_MS} while it is alive, so the lease outlasts a slow judge;
 * a run whose process died stops renewing, and the recovery job takes it over
 * once the lease has run out.
 */
export const LEASE_MS = 90_000;

/** How often a live run renews its lease. */
export const LEASE_RENEW_MS = 30_000;

/** The longest text accepted (§8.2). Longer is refused, never truncated. */
export const MAX_CONTENT_CHARS = 40_000;

/** Assessments the recovery job re-drives in one workspace per tick. */
export const RECOVERY_BATCH = RUNNING_PER_WORKSPACE;

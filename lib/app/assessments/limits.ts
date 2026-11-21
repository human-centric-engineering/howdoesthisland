/**
 * The assessment job's limits (t-22, app-plan §8.2).
 *
 * Constants until f-usage measures them. Each is the reason behind a rule the
 * job enforces, so a change here is a change in behaviour, not a tuning knob.
 */

/** Judges in flight at once within one assessment run. */
export const JUDGES_IN_FLIGHT = 4;

/**
 * Assessments running at once in one workspace: stored runs, counted from
 * their rows, and runs kept nowhere (`store: false`), counted from their
 * places (`places.ts`, t-28). A stored run that would be one more stays
 * `QUEUED`, and the next run to end starts it (the recovery job is the
 * backstop). A `store: false` run that would be one more is refused.
 */
export const RUNNING_PER_WORKSPACE = 3;

/**
 * The `Retry-After` a `store: false` request refused for a full workspace
 * carries (t-28). Nothing says when a place will free, so this is a guess at
 * a judged review's length, short enough that a retry is likely to land.
 */
export const PLACE_RETRY_AFTER_SECONDS = 15;

/**
 * Failures a re-drive runs the judge again for (`run.ts`): each is about the
 * moment (a rate-limit window, a provider outage), not the judge or the text.
 * A judge run that failed with one is not settled, so the budget check holds
 * back for it as for a judge not yet run (`budget.ts`).
 */
export const RETRIED_ON_REDRIVE: ReadonlySet<string> = new Set(['rate_limited', 'provider_error']);

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

/**
 * How long after a cancel its judges in flight may still land. The longest
 * judge timeout is five minutes; an hour covers that with its retries. A run
 * stops renewing a cancelled lease after it, and the purge may take the row.
 */
export const CANCEL_GRACE_MS = 60 * 60 * 1000;

/**
 * How far back a review ended without its charge is still charged (t-58): a
 * cancelled review whose lease ran out, and a `store: false` run whose charge
 * failed or whose process died. A lease lasts at most {@link CANCEL_GRACE_MS}
 * after the cancel, and a day more covers recovery ticks that did not run.
 * Older rows ended before reviews were charged.
 */
export const CHARGE_SWEEP_MS = CANCEL_GRACE_MS + 24 * 60 * 60 * 1000;

/** The longest text accepted (§8.2). Longer is refused, never truncated. */
export const MAX_CONTENT_CHARS = 40_000;

/** Assessments the recovery job re-drives in one workspace per tick. */
export const RECOVERY_BATCH = RUNNING_PER_WORKSPACE;

/**
 * How long `POST assessments` with `wait: true` waits for the run before
 * answering 202 (t-24). The run carries on after the response, under the
 * route's `maxDuration`.
 */
export const WAIT_BOUND_MS = 60_000;

/** How often a waiting request, and the events stream, read the rows. */
export const POLL_MS = 1_000;

/** How long one events stream stays open before it ends with `assessment_timeout`. */
export const EVENTS_MAX_MS = 5 * 60_000;

/**
 * Assessments that call judges, per user per minute, across every way in
 * (t-24): a per-flow sub-cap under the proxy's section cap, because each one
 * spends money. `store: false` counts the same. A `quick` profile calls no
 * model and is not counted.
 */
export const AI_ASSESSMENTS_PER_MINUTE = 10;

/** Free quick scans per IP per minute (`POST scan`, D7). */
export const SCANS_PER_MINUTE = 30;

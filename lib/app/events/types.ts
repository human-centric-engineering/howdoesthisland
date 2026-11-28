/**
 * The events a workspace can subscribe to (t-99, `.context/app/webhooks.md`).
 *
 * Each is a core event-hook type in the app's namespace (`app.*`, #465), so
 * core signs, sends, retries and records it (`lib/orchestration/hooks/`). A
 * leaf module: the routes' schemas and the settings page read it without the
 * server's send path.
 *
 * **One `.finished` event per kind, at every final state**, with the state in
 * the payload, not one event for success and another for failure: a caller
 * waiting for its work has to be told when it failed or was cancelled too.
 */

/** A review reached a final state: completed, partial, failed or cancelled. */
export const ASSESSMENT_FINISHED = 'app.assessment.finished';

/** Every draft of a comparison reached a final state, and its verdict settled. */
export const COMPARISON_FINISHED = 'app.comparison.finished';

/** Every item of a batch reached a final state (t-101), or was purged. */
export const BATCH_FINISHED = 'app.batch.finished';

/** What a workspace may subscribe a URL to. Never a core event. */
export const APP_EVENT_TYPES = [ASSESSMENT_FINISHED, COMPARISON_FINISHED, BATCH_FINISHED] as const;

export type AppEventType = (typeof APP_EVENT_TYPES)[number];

/** The most subscriptions one workspace may have. */
export const MAX_SUBSCRIPTIONS_PER_WORKSPACE = 10;

/** The most custom headers a subscription may send. */
export const MAX_SUBSCRIPTION_HEADERS = 10;

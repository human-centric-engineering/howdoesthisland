# Webhooks

A CMS or a script that starts a review used to poll it until it ended. A
workspace can instead subscribe an address to its finished work: each time a
review or a comparison ends, the address is sent a signed `POST` saying so, and
the caller reads the rest from the API by id. Built in t-99 (f-batch-webhooks,
app-plan §21).

## Events

| Event                     | Sent when                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `app.assessment.finished` | A stored review reaches a final state: `completed`, `partial`, `failed` or `cancelled`.                  |
| `app.comparison.finished` | Every draft of a comparison is final **and** its verdict has settled (`completed`, `failed`, `skipped`). |

There is one event per kind, at every final state, with the state in the
payload. A caller waiting for its work is told when it failed or was cancelled,
not only when it succeeded. A `store: false` review has no row to read back, so
it sends nothing.

A cancelled review is sent as soon as it is cancelled, even while judges it had
in flight are still landing: to the person who asked, it is over.

## The body

```json
{
  "eventType": "app.assessment.finished",
  "timestamp": "2026-11-27T10:15:02.114Z",
  "data": {
    "eventId": "assessment:cmabc…",
    "assessmentId": "cmabc…",
    "status": "completed",
    "overall": 71,
    "band": "strong",
    "projectId": null,
    "completedAt": "2026-11-27T10:15:01.902Z"
  }
}
```

`app.comparison.finished` carries `eventId` (`comparison:<id>`),
`comparisonId`, `status` (`completed`, `partial` or `failed`, as
`GET /api/v1/comparisons/{id}` reads it), `projectId`, `verdict: { status,
draft }` and `drafts: [{ position, assessmentId, status, overall, band }]`.

**A payload holds ids, states and scores, nothing else**: no text, no titles or
draft labels, no user ids. Core keeps every delivery row as the record of what
was sent, and the row outlives the review, so it must hold nothing a review's
deletion or a person's erasure would have to reach
(`lib/privacy/delivery-payloads.ts` finds a delivery by the user ids it names,
and these name none).

**At least once.** A send can repeat: core retries a delivery your receiver
answered too slowly, and two of the app's own senders can race (below). Use
`eventId` to drop a repeat.

## Subscribing

The routes are the workspace's settings, for its `OWNER` or `ADMIN` acting in
it (or a platform admin who has entered it), by browser session only:

| Route                                                       | What it does                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /api/v1/workspaces/{id}/event-subscriptions`           | The workspace's subscriptions. Never a secret or a header's value.                   |
| `POST /api/v1/workspaces/{id}/event-subscriptions`          | `{ name, eventType, url, headers?, projectId?, isEnabled? }`. Answers `secret` once. |
| `GET/PATCH/DELETE …/event-subscriptions/{subscriptionId}`   | Read, change or delete one. A `headers` change replaces them all.                    |
| `POST …/event-subscriptions/{subscriptionId}/rotate-secret` | A new secret, answered once.                                                         |
| `GET …/event-subscriptions/{subscriptionId}/deliveries`     | Its deliveries, newest first: status, attempts, last response, `eventId`.            |

The rules, each refused with 400 `VALIDATION_ERROR` unless it says otherwise:

- `eventType` is one of the app's events above, never a core event.
- `url` starts `https://` and is a public address (`isSafeProviderUrl`), since
  the server posts to it. That check reads the address as text, so each delivery
  is also pinned to a checked address when it connects
  (`withOutboundDispatcher` in core's `postHook`, ledger row 37). A name whose DNS
  answer is private is refused. Its `lastError` then reads the same as a name that
  does not exist, so the deliveries list maps nothing of the operator's network.
- `headers`: at most 10, valid names, values of printable Latin-1 with no line
  breaks (what `fetch` can send), no two names differing only in case, and not
  `X-Sunrise-Signature`, `X-Sunrise-Timestamp`, `X-Hook-Event` or a header the sender manages
  (`Connection`, `Content-Type`, `Host`, `Transfer-Encoding` and the like).
  Their values are sent with each delivery and never read back; the audit log
  records which fields changed, never a value. **A new `url` must bring its
  `headers`** (`{}` for none): a stored value can be the receiver's credential,
  and carried over it would go to an address the admin who set it never chose.
- `projectId`: a project in this workspace, not archived (an archived project
  takes no new reviews). The subscription then gets only that project's work
  (core's equality filter on `data.projectId`).
- At most 10 subscriptions a workspace: 409 `SUBSCRIPTION_LIMIT`.

**Why not an API key.** The secret is a credential, and a key must not mint
credentials, so these routes take a browser session only, as the workspace's MCP
keys do. For the same reason, a platform admin who entered under a support grant
cannot make one, change one or rotate its secret (`orgForMint`): each outlives
the grant. They can still list, read and delete.

**A change takes up to a minute everywhere.** Core caches each org's hooks per
process for 60 seconds. The server that made a change drops its cache at once,
but another server may send with the old address or secret, or a disabled hook,
for up to a minute. After rotating, accept both secrets for a minute.

### What a subscription is

A core event hook (`AiEventHook`) in the workspace's org, with the app's event
type (#465). Core signs, sends, retries (10 s, 60 s, 5 min) and records each
delivery, and caches hooks per org. Core's own hook routes are for platform
admins only, including the one that rotates a secret, so the workspace's routes
(`lib/app/events/subscriptions.ts`) do the same on core's exported helpers
(`generateHookSecret`, `invalidateHookCache`), with no platform edit. Every
query names the workspace and the app's event types, so a hook a platform admin
made in the same org for a core event is never listed, changed or deleted here.
Core's `loadHooks` also names the org when it reads hooks to send to, rather
than leaving it to row isolation alone, and so does its retry pass (ledger row
37), so at `multi` without the policies enabled one workspace's events still
reach only its own hooks, and its retries are still pinned.

## Verifying a delivery

Each delivery carries `X-Sunrise-Timestamp` (Unix seconds) and
`X-Sunrise-Signature: sha256=<hex>`, the HMAC-SHA256 of
`<timestamp>.<raw body>` keyed with the secret. Check it against the **raw**
body, before parsing it, and refuse an old timestamp. A retry is signed afresh.

```js
// Node 18+. Verify a webhook from HowDoesThisLand.
const { createHmac, timingSafeEqual } = require('node:crypto');

const MAX_AGE_SECONDS = 300;

function verifyHowDoesThisLandWebhook(rawBody, headers, secret, nowSeconds) {
  const timestamp = headers['x-sunrise-timestamp'];
  const signature = headers['x-sunrise-signature'];
  if (!timestamp || !signature || !signature.startsWith('sha256=')) return false;

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_AGE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const given = signature.slice('sha256='.length);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}

module.exports = { verifyHowDoesThisLandWebhook };
```

In an Express receiver, read the body raw (`express.raw({ type: 'application/json' })`),
verify it, answer `2xx` quickly, then do the work. A non-`2xx` or a reply after 10
seconds is retried.

`tests/unit/lib/app/events/verify-sample.test.ts` runs this block, as written
here, against a body core signed.

## Never lost: the outbox

`Assessment.notifiedAt` and `AssessmentSet.notifiedAt` say when the event was
queued (`lib/app/events/notify.ts`):

1. The code that ends a review (the run's end in `run.ts`, and `cancelAssessment`)
   calls `notifyAfterReview`. A comparison's event goes when its verdict ends
   (`verdict.ts`), or with its last draft when it has no verdict to wait for.
2. That calls core's `emitHookEventDurably`, which resolves once every matching
   subscription's delivery row is written. Only then is `notifiedAt` stamped.
   From that row on, core sends and retries the delivery itself.
3. If the process dies first, or a review ends where nothing notifies (the
   recovery job giving up on it), the `app:finished-events` job (every 15
   minutes, per workspace) sends what is owed. It leaves rows that ended in the
   last two minutes (`SWEEP_GRACE_MS`) to the send already under way, takes the
   newest first, and gives up on a row that ended more than a day ago
   (`SWEEP_WINDOW_MS`): a send that keeps failing would otherwise resend every
   pass to the subscriptions whose rows were written.

The migration (`20261127100000_app_finished_events`) stamped every review and
comparison that had already ended, so the sweep never sends history.

A workspace with no subscription still stamps each row: core finds no hook and
resolves at once.

## Testing

- `tests/unit/lib/app/events/notify.test.ts`: end to end through core's real
  dispatcher over the in-memory store. A review that ends in each final state,
  and a comparison, are POSTed once, signed with their own workspace's secret,
  to their own workspace only. Nothing is sent while work runs. A send core could
  not queue is left unstamped and the sweep sends it. The sweep skips history and
  what just ended. Cancelling through `cancelAssessment` sends.
- `tests/unit/app/api/v1/workspaces/[id]/event-subscriptions/route.test.ts`:
  who may reach the routes, what they refuse, that nothing returns a secret or a
  header value but the two answers that must, and the limit under its lock.

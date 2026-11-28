/**
 * The developer docs' webhooks section (t-100): what a workspace's webhook
 * sends and how a receiver checks it. The public form of
 * `.context/app/webhooks.md` (t-99), which the settings page links to.
 *
 * {@link VERIFY_SAMPLE} is the same code as the `js` block in that doc, and
 * `tests/unit/lib/app/events/verify-sample.test.ts` runs the doc's block
 * against a body core signed and checks this one is identical, so neither
 * can drift from a scheme that works.
 *
 * Prose says "review" (app-plan, "The words we use"); events and fields are
 * quoted as the API names them.
 */
import { ASSESSMENT_FINISHED, COMPARISON_FINISHED } from '@/lib/app/events/types';

/** Where the settings page sends someone to read how to receive one. */
export const WEBHOOKS_DOCS_HREF = '/developers#webhooks';

/** Each event, and when it is sent. */
export const WEBHOOK_EVENTS: [event: string, sentWhen: string][] = [
  [
    ASSESSMENT_FINISHED,
    'A stored review ends: `completed`, `partial`, `failed` or `cancelled`. A `store: false` review sends nothing, since there is nothing to read back.',
  ],
  [COMPARISON_FINISHED, 'Every draft of a comparison has ended, and its verdict has settled.'],
];

export const SAMPLE_BODY = `{
  "eventType": "${ASSESSMENT_FINISHED}",
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
}`;

export const VERIFY_SAMPLE = `// Node 18+. Verify a webhook from HowDoesThisLand.
const { createHmac, timingSafeEqual } = require('node:crypto');

const MAX_AGE_SECONDS = 300;

function verifyHowDoesThisLandWebhook(rawBody, headers, secret, nowSeconds) {
  const timestamp = headers['x-sunrise-timestamp'];
  const signature = headers['x-sunrise-signature'];
  if (!timestamp || !signature || !signature.startsWith('sha256=')) return false;

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_AGE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest('hex');
  const given = signature.slice('sha256='.length);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}

module.exports = { verifyHowDoesThisLandWebhook };
`;

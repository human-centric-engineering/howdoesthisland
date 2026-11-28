/**
 * Tests: the receiver sample in `.context/app/webhooks.md` (t-99), which
 * `/developers` shows (`components/app/developers/webhooks.ts`, t-100), verifies a
 * body core signed, and refuses one tampered with, signed with another
 * secret, or too old.
 *
 * The sample is read out of the doc and run as written, so the doc cannot
 * drift from a scheme that works. It is signed by core's own `signHookPayload`,
 * the function the dispatcher signs every delivery with.
 */
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { signHookPayload } from '@/lib/orchestration/hooks/signing';
import { VERIFY_SAMPLE } from '@/components/app/developers/webhooks';

type Verify = (
  rawBody: string,
  headers: Record<string, string | undefined>,
  secret: string,
  nowSeconds?: number
) => boolean;

function docSample(): string {
  const doc = readFileSync(path.join(process.cwd(), '.context/app/webhooks.md'), 'utf8');
  const block = /```js\n([\s\S]*?)```/.exec(doc)?.[1];
  if (!block) throw new Error('No ```js block in webhooks.md');
  return block;
}

function loadSample(): Verify {
  const block = docSample();
  // The doc's own CommonJS module, written out and required as Node would load it.
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'webhook-sample-')), 'verify.cjs');
  writeFileSync(file, block);
  const loaded: unknown = createRequire(import.meta.url)(file);
  const verify =
    loaded && typeof loaded === 'object' && 'verifyHowDoesThisLandWebhook' in loaded
      ? loaded.verifyHowDoesThisLandWebhook
      : undefined;
  if (typeof verify !== 'function') {
    throw new Error('The sample exports no verifyHowDoesThisLandWebhook');
  }
  return (rawBody, headers, secret, nowSeconds) =>
    z.boolean().parse(verify(rawBody, headers, secret, nowSeconds));
}

const verify = loadSample();
const SECRET = 'c'.repeat(64);
const BODY = JSON.stringify({
  eventType: 'app.assessment.finished',
  timestamp: '2026-11-27T10:15:02.114Z',
  data: { eventId: 'assessment:a1', assessmentId: 'a1', status: 'completed' },
});
const NOW = 1_800_000_000;

function headersFor(body: string, secret: string, at = NOW) {
  const { timestamp, signature } = signHookPayload(secret, body, at);
  // Node lower-cases incoming header names.
  return { 'x-sunrise-timestamp': timestamp, 'x-sunrise-signature': signature };
}

describe('the webhook verification sample', () => {
  it('is the code /developers shows, so the public docs run what this test runs', () => {
    expect(VERIFY_SAMPLE).toBe(docSample());
  });

  it('accepts a body core signed with the secret', () => {
    expect(verify(BODY, headersFor(BODY, SECRET), SECRET, NOW)).toBe(true);
  });

  it('refuses a tampered body, another secret, missing headers and an old timestamp', () => {
    const headers = headersFor(BODY, SECRET);
    expect(verify(BODY.replace('completed', 'failed'), headers, SECRET, NOW)).toBe(false);
    expect(verify(BODY, headersFor(BODY, 'd'.repeat(64)), SECRET, NOW)).toBe(false);
    expect(verify(BODY, {}, SECRET, NOW)).toBe(false);
    expect(verify(BODY, headersFor(BODY, SECRET, NOW - 301), SECRET, NOW)).toBe(false);
  });

  it('refuses a timestamp that is not a number, so the age check cannot be skipped', () => {
    // Validly signed over "abc.<body>": only the timestamp check can refuse it.
    const hex = createHmac('sha256', SECRET).update(`abc.${BODY}`).digest('hex');
    const headers = { 'x-sunrise-timestamp': 'abc', 'x-sunrise-signature': `sha256=${hex}` };
    expect(verify(BODY, headers, SECRET, NOW)).toBe(false);
  });

  it('refuses a signature that is not hex, rather than throwing', () => {
    const headers = {
      ...headersFor(BODY, SECRET),
      'x-sunrise-signature': `sha256=${'z'.repeat(64)}`,
    };
    expect(verify(BODY, headers, SECRET, NOW)).toBe(false);
  });
});

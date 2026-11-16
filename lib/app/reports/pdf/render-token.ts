/**
 * The token that lets headless Chromium open one report's print page (t-31).
 *
 * The PDF route renders `/print/assessments/{id}` in a browser it launched.
 * That browser has no session cookie and no API key, so the print page needs
 * another way to know the request is the route's own: this token, minted by
 * the route for one assessment in one org, living {@link RENDER_TOKEN_TTL_SECONDS}.
 * It never leaves the server. The route hands it to its own browser in a
 * request header, which that browser sends only to this app's origin.
 *
 * Token format: `<base64url-payload>.<base64url-signature>`
 *   payload = JSON { typ: 'report-render', assessmentId, orgId, expiresAt }
 *   signature = HMAC-SHA256(BETTER_AUTH_SECRET, payload-bytes)
 *
 * **Why `typ`.** The approval tokens (`lib/orchestration/approval-tokens.ts`)
 * and storage read tokens (`lib/storage/access-tokens.ts`) sign this same
 * construction with this same secret, so a valid signature alone does not
 * say which scheme minted a token. Without a tag, the schemes are kept apart
 * only by their payloads happening to need different fields. That stops
 * holding as soon as one of them gains an optional field. Then a storage-read
 * token for some key could be replayed here as a render token, or a render
 * token presented to the storage route. The tag is inside the signed bytes,
 * and each scheme refuses any tag but its own, so the schemes stay separate
 * whatever fields they add. It is checked in both directions: those two
 * schemes refuse `report-render`, and this one refuses theirs.
 *
 * **Why both `assessmentId` and `orgId`.** The print page compares the id
 * with the one in its path. That is the access control, since a token for
 * one report must not open another. It then reads the assessment's org from
 * the row and refuses it unless it is the org the token was minted in. Given
 * the id check, the org check only matters for a token minted wrongly. That
 * is the point of it: minting is one call in the route, and the print page is
 * where a mistake there would otherwise show another workspace's report.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { env } from '@/lib/env';
import { isRecord } from '@/lib/utils';

/**
 * Scheme tag carried in the signed payload and checked on verify (see the
 * module header). Changing it invalidates every outstanding token, which for
 * a token this short-lived is harmless.
 */
export const RENDER_TOKEN_TYPE = 'report-render';

/**
 * How long a render token lives. Long enough for the browser to launch and
 * request the page, which takes a few seconds, and too short for a token that
 * leaked into a log to be worth anything.
 */
export const RENDER_TOKEN_TTL_SECONDS = 60;

/** The header the route's browser sends the token in. */
export const RENDER_TOKEN_HEADER = 'x-report-render-token';

const payloadSchema = z.object({
  typ: z.literal(RENDER_TOKEN_TYPE),
  assessmentId: z.string().min(1),
  orgId: z.string().min(1),
  expiresAt: z.string().min(1),
});

export type RenderTokenPayload = z.infer<typeof payloadSchema>;

/** Why a token was refused. One code per failure, so a test can say which. */
export type RenderTokenRefusal =
  'malformed' | 'bad-signature' | 'wrong-type' | 'expired' | 'wrong-assessment';

export class RenderTokenError extends Error {
  constructor(readonly reason: RenderTokenRefusal) {
    super(`Report render token refused: ${reason}`);
    this.name = 'RenderTokenError';
  }
}

function sign(payloadJson: string): string {
  return createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(payloadJson, 'utf8')
    .digest('base64url');
}

/** Mint a token for one assessment in one org. */
export function mintRenderToken(
  assessmentId: string,
  orgId: string,
  now: Date = new Date()
): string {
  const payload: RenderTokenPayload = {
    typ: RENDER_TOKEN_TYPE,
    assessmentId,
    orgId,
    expiresAt: new Date(now.getTime() + RENDER_TOKEN_TTL_SECONDS * 1000).toISOString(),
  };
  const json = JSON.stringify(payload);
  return `${Buffer.from(json, 'utf8').toString('base64url')}.${sign(json)}`;
}

/**
 * Verify a token and check it was minted for `assessmentId`. Returns the
 * payload, whose `orgId` the caller must still compare with the
 * assessment's org (see the module header). Throws {@link RenderTokenError}.
 */
export function verifyRenderToken(
  token: string,
  assessmentId: string,
  now: Date = new Date()
): RenderTokenPayload {
  const dot = token.indexOf('.');
  if (dot <= 0) throw new RenderTokenError('malformed');
  const json = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8');

  const provided = Buffer.from(token.slice(dot + 1), 'utf8');
  const expected = Buffer.from(sign(json), 'utf8');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new RenderTokenError('bad-signature');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new RenderTokenError('malformed');
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) {
    // An authentic token from another scheme is a different event from a
    // payload that is merely incomplete, so it gets its own reason.
    // An untagged payload is malformed, not another scheme's: only a tag
    // that names a different scheme says that.
    const otherScheme = isRecord(raw) && raw.typ !== undefined && raw.typ !== RENDER_TOKEN_TYPE;
    throw new RenderTokenError(otherScheme ? 'wrong-type' : 'malformed');
  }

  const expiresAt = new Date(parsed.data.expiresAt).getTime();
  if (Number.isNaN(expiresAt) || expiresAt <= now.getTime()) {
    throw new RenderTokenError('expired');
  }
  if (parsed.data.assessmentId !== assessmentId) throw new RenderTokenError('wrong-assessment');
  return parsed.data;
}

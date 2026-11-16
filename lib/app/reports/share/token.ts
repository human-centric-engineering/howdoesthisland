/**
 * A share link's token (t-32).
 *
 * 32 random bytes, base64url (43 characters), shown once when the link is
 * made. Only its SHA-256 is stored (`ReportShare.tokenHash`), so a database
 * read, an export or a backup holds nothing that opens a report. A plain hash
 * is enough, and a slow one would buy nothing: the token is 256 bits of
 * randomness, not a password a guess could find.
 *
 * The lookup is by the hash, an exact match on a unique index, so it leaks
 * nothing about how close a guess was.
 */
import { createHash, randomBytes } from 'crypto';

/** Bytes of randomness in a token. */
export const SHARE_TOKEN_BYTES = 32;

/** What a well-formed token looks like: 32 bytes as unpadded base64url. */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new token, and the hash to store for it. */
export function mintShareToken(): { token: string; tokenHash: string } {
  const token = randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashShareToken(token) };
}

/** The stored form of a token: SHA-256, hex. */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The page a token opens, as a path. */
export const sharedReportPath = (token: string): string => `/r/${token}`;

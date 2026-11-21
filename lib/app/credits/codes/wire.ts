/**
 * The free review codes' wire shapes (t-59): the issuing body, a code as the
 * admin page and the API show it, and the list. Client-safe: no server
 * imports, so the admin page parses with them.
 */
import { z } from 'zod';

/** The admin page, and the routes. */
export const ADMIN_CODES_PATH = '/admin/codes';
export const ADMIN_CODES_ENDPOINT = '/api/v1/admin/codes';

/** Where a code is redeemed (t-60): its link is this with `?code=`. */
export const REDEEM_PATH = '/redeem';

/** The most codes one call mints. */
export const MAX_BATCH = 200;
/** The most credits one redemption gives: a typo guard, not a policy ($1,000 at the launch rate). */
export const MAX_CODE_CREDITS = 100_000;
/** The most redemptions one code allows. */
export const MAX_REDEMPTIONS = 100_000;
/** The longest campaign label. */
export const MAX_CAMPAIGN = 100;
/** The longest idempotency key. */
export const MAX_IDEMPOTENCY_KEY = 200;
/** How far ahead a code may expire. */
export const MAX_EXPIRY_DAYS = 3 * 366;
/** The most codes the admin list returns. */
export const ADMIN_CODES_LIST_LIMIT = 200;
/** The longest search the admin list accepts. */
export const MAX_CODE_SEARCH = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A whole number from 1 to `max`. An empty field reaches here as NaN: say what is wanted. */
const positive = (what: string, max: number) =>
  z
    .number({ error: `Enter ${what}` })
    .int('Whole numbers only')
    .min(1, 'At least 1')
    .max(max, `At most ${max.toLocaleString('en-GB')}`);

/**
 * `POST /api/v1/admin/codes`: mint `count` codes alike. One personal code is
 * `count: 1, maxRedemptions: 1`; a QR card is one code with `maxRedemptions`
 * of however many people may use it; a batch is many personal codes.
 *
 * `idempotencyKey` makes a retried call mint once: the same key with the same
 * body answers with the codes it minted the first time; with a different body
 * it is refused (409).
 */
export const issueCodesSchema = z
  .object({
    count: positive('how many codes', MAX_BATCH),
    creditsPerRedemption: positive('a number of credits', MAX_CODE_CREDITS),
    maxRedemptions: positive('how many times it can be used', MAX_REDEMPTIONS),
    expiresAt: z.iso
      .datetime({ offset: true, error: 'Choose when it expires' })
      // Zod runs these even when the format check failed: a value that is not
      // a time is left to that check's one message.
      .refine((iso) => Number.isNaN(Date.parse(iso)) || Date.parse(iso) > Date.now(), {
        message: 'Choose a time in the future',
      })
      .refine(
        (iso) =>
          Number.isNaN(Date.parse(iso)) || Date.parse(iso) <= Date.now() + MAX_EXPIRY_DAYS * DAY_MS,
        { message: 'At most three years ahead' }
      ),
    campaign: z
      .string()
      .trim()
      .min(1, 'Say what it is for')
      .max(MAX_CAMPAIGN, `${MAX_CAMPAIGN} characters at most`),
    idempotencyKey: z
      .string()
      .min(1)
      .max(MAX_IDEMPOTENCY_KEY)
      .regex(/^[\x21-\x7e]+$/, 'Printable ASCII, no spaces')
      .optional(),
  })
  .strict();

export type IssueCodes = z.infer<typeof issueCodesSchema>;

/** `GET /api/v1/admin/codes?q=`: by campaign or code. Counted by code point, as the page cuts it. */
export const adminCodesQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .refine((s) => Array.from(s).length <= MAX_CODE_SEARCH, {
      message: `${MAX_CODE_SEARCH} characters at most`,
    })
    .optional(),
});

/**
 * Where a code stands. `revoked` wins over the rest, then `expired`, then
 * `used-up`: each says why it can no longer be redeemed.
 */
export const codeStatusSchema = z.enum(['active', 'used-up', 'expired', 'revoked']);
export type CodeStatus = z.infer<typeof codeStatusSchema>;

/** A code as the admin page and the API show it. */
export const reviewCodeSchema = z.object({
  id: z.string(),
  /** Canonical: upper case, no separators. */
  code: z.string(),
  /** The redeem link, absolute: what the QR encodes. */
  link: z.string(),
  campaign: z.string(),
  creditsPerRedemption: z.number().int(),
  maxRedemptions: z.number().int(),
  redemptionsUsed: z.number().int(),
  redemptionsLeft: z.number().int(),
  status: codeStatusSchema,
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type ReviewCodeView = z.infer<typeof reviewCodeSchema>;

export const issuedCodesSchema = z.object({
  codes: z.array(reviewCodeSchema),
  /** The idempotency key had minted these already: nothing new was made. */
  replayed: z.boolean(),
});

export type IssuedCodes = z.infer<typeof issuedCodesSchema>;

export const adminCodesListSchema = z.object({
  codes: z.array(reviewCodeSchema),
  /** More codes match than the list holds: narrow the search. */
  truncated: z.boolean(),
});

export type AdminCodesList = z.infer<typeof adminCodesListSchema>;

/** `DELETE /api/v1/admin/codes/{id}`: a code's id. */
export const codeIdParamSchema = z.object({ id: z.cuid() });

/** How long a new code lasts unless the admin says otherwise. */
export const DEFAULT_EXPIRY_DAYS = 90;

/** `YYYY-MM-DD`, `days` from `now`, in UTC: the admin form's first expiry. */
export function dateFromNow(days: number, now: number = Date.now()): string {
  return new Date(now + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The CopyCredits wire shapes (t-57): the admin routes' bodies and answers,
 * and the balance `GET /api/v1/usage` carries. Client-safe: no server imports,
 * so the admin page and `/usage` parse with them.
 */
import { z } from 'zod';

/** The admin page, and the route it reads. */
export const ADMIN_CREDITS_PATH = '/admin/credits';
export const ADMIN_CREDITS_ENDPOINT = '/api/v1/admin/credits';

/** The most credits one admin change may move, either way: a typo guard, not a policy. */
export const MAX_CREDIT_CHANGE = 1_000_000;

/** The longest reason an admin may give. */
export const MAX_CREDIT_REASON = 500;

/** The most workspaces the admin list returns. */
export const ADMIN_CREDITS_LIST_LIMIT = 200;

/**
 * `POST /api/v1/admin/credits/{orgId}/entries`.
 *
 * - `grant` gives credits: `amount` is positive.
 * - `adjust` corrects the balance either way: `amount` is any whole number but
 *   `0`, and may take the balance below zero (a correction says what is true).
 */
const AT_MOST = `At most ${MAX_CREDIT_CHANGE.toLocaleString('en-GB')} at a time`;

/** Whole credits within one change's limit. An empty field reaches here as NaN: say what is wanted, not the type. */
const credits = () =>
  z
    .number({ error: 'Enter a number of credits' })
    .int('Credits are whole numbers')
    .min(-MAX_CREDIT_CHANGE, AT_MOST)
    .max(MAX_CREDIT_CHANGE, AT_MOST);

const reason = z
  .string()
  .trim()
  .min(1, 'Say why')
  .max(MAX_CREDIT_REASON, `${MAX_CREDIT_REASON} characters at most`);

// One object per kind, each rule on its own field, so every problem shows on
// the first submit: an object refinement is skipped while another field is wrong.
export const creditChangeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('grant'),
      amount: credits().refine((n) => n > 0, {
        message: 'A grant gives credits; use an adjustment to take them away',
      }),
      reason,
    })
    .strict(),
  z
    .object({
      kind: z.literal('adjust'),
      amount: credits().refine((n) => n !== 0, { message: 'An adjustment changes something' }),
      reason,
    })
    .strict(),
]);

export type CreditChange = z.infer<typeof creditChangeSchema>;

/** `GET /api/v1/admin/credits?q=` query. */
/** The longest search the admin list accepts. */
export const MAX_SEARCH = 100;

export const adminCreditsQuerySchema = z.object({
  q: z.string().trim().max(MAX_SEARCH).optional(),
});

/** A workspace's monthly AI cap, the safety ceiling, and what is left of it this month. */
export const creditsCapSchema = z.object({
  limitUsd: z.number(),
  remainingUsd: z.number(),
});

/** One workspace on the admin page. */
export const adminWorkspaceCreditsSchema = z.object({
  orgId: z.string(),
  name: z.string(),
  slug: z.string(),
  balance: z.number().int(),
  /** `null` when the workspace has no cap set (Sunrise reads that as unlimited). */
  cap: creditsCapSchema.nullable(),
});

export type AdminWorkspaceCredits = z.infer<typeof adminWorkspaceCreditsSchema>;

export const adminCreditsListSchema = z.object({
  workspaces: z.array(adminWorkspaceCreditsSchema),
  /** More workspaces match than the list holds: narrow the search. */
  truncated: z.boolean(),
});

export type AdminCreditsList = z.infer<typeof adminCreditsListSchema>;

/** A change as recorded. */
export const creditEntrySchema = z.object({
  id: z.string(),
  amount: z.number().int(),
  kind: z.enum(['GRANT', 'ADJUST', 'REDEEM', 'CHARGE']),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

/** What a change answers with. */
export const creditChangeResultSchema = z.object({
  entry: creditEntrySchema,
  balance: z.number().int(),
  /**
   * The balance is worth more than the workspace's cap leaves this month, so
   * the cap, not the credits, will stop its reviews first. Raise the cap on
   * the workspace's admin page if it should spend them this month. `null`
   * when the cap leaves room, or there is none.
   */
  capWarning: z
    .object({
      balanceUsd: z.number(),
      remainingUsd: z.number(),
      limitUsd: z.number(),
    })
    .nullable(),
});

export type CreditChangeResult = z.infer<typeof creditChangeResultSchema>;

/** A workspace's credits, as `GET /api/v1/usage` carries them. */
export const usageCreditsSchema = z.object({
  /** What the workspace has to spend. Can be below zero after an adjustment. */
  balance: z.number().int(),
  /** Credits its reviews were charged this month. */
  spentThisMonth: z.number().int(),
});

export type UsageCredits = z.infer<typeof usageCreditsSchema>;

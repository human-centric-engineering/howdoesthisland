/**
 * What `GET /api/v1/usage` answers with (t-48): a workspace's usage this
 * calendar month, as `getMonthUsage()` (`./service.ts`) returns it and the
 * `/usage` page reads it. No server imports, so the page can parse with it.
 */
import { z } from 'zod';
import { usageCreditsSchema } from '@/lib/app/credits/wire';

/** The route the `/usage` page reads. */
export const USAGE_ENDPOINT = '/api/v1/usage';

/**
 * What a line of the breakdown holds:
 *
 * - `project` — stored reviews in one project (`projectId`).
 * - `no-project` — stored reviews in no project.
 * - `kept-nowhere` — reviews run with `store: false`, which keep nothing but
 *   their cost rows (`ephemeral: true`).
 * - `other` — AI spend tied to no review that still exists: a deleted
 *   review's calls, a calibration run's, and anything else the workspace's
 *   AI spent. Present only
 *   when there is some.
 */
export const USAGE_LINE_KINDS = ['project', 'no-project', 'kept-nowhere', 'other'] as const;

export type UsageLineKind = (typeof USAGE_LINE_KINDS)[number];

export const usageLineSchema = z.object({
  kind: z.enum(USAGE_LINE_KINDS),
  /** The project's id for a `project` line; `null` on every other. */
  projectId: z.string().nullable(),
  /** Reviews started this month. */
  reviews: z.number().int(),
  /** Calls to an AI reviewer or the editor, each billed attempt counted. */
  calls: z.number().int(),
  /** USD spent this month. */
  spendUsd: z.number(),
});

export type UsageLine = z.infer<typeof usageLineSchema>;

/** The workspace's monthly AI budget and where it stands. */
export const usageCapSchema = z.object({
  limitUsd: z.number(),
  /** What is left of it; `0` once it is reached. */
  remainingUsd: z.number(),
  /** The budget is reached: an AI reviewer call is refused until next month. */
  exceeded: z.boolean(),
});

export const monthUsageSchema = z.object({
  month: z.object({
    /** Midnight UTC on the first of the month. */
    start: z.iso.datetime(),
    /** Midnight UTC on the first of next month, when the figures start again. */
    end: z.iso.datetime(),
  }),
  reviews: z.number().int(),
  calls: z.number().int(),
  /** Everything the workspace's AI spent this month: the total its budget is held to. */
  spendUsd: z.number(),
  /**
   * The workspace's monthly AI cap: since t-57 a safety ceiling on what it can
   * spend in a month, whatever its credits. `null` when none is set.
   */
  cap: usageCapSchema.nullable(),
  /** The workspace's CopyCredits (t-57): what it pays for reviews with. */
  credits: usageCreditsSchema,
  /** Projects first, by spend, then the lines that are not projects. */
  lines: z.array(usageLineSchema),
});

export type MonthUsage = z.infer<typeof monthUsageSchema>;

/** The page the budget refusal points at: the month's spend and the budget. */
export const USAGE_PAGE = '/usage';

/**
 * What a budget refusal carries (t-49, `lib/app/usage/budget.ts`): in
 * `details` of a 402 `BUDGET_EXCEEDED`, and in `errorDetails` of a stored
 * review refused as it was claimed (t-53).
 */
export const budgetRefusalDetailsSchema = z.object({
  /** USD, to the millionth. */
  estimateUsd: z.number(),
  /**
   * Where the cost per judge came from: the profile's reviews, recent judge
   * runs, the judges of recent `store: false` reviews (`kept-nowhere`), or none.
   */
  basis: z.enum(['profile', 'judges', 'kept-nowhere', 'rewrites', 'none']),
  /** What is left of the monthly budget once in-flight reviews are held back; `0` once none is. */
  remainingUsd: z.number(),
  /** What the workspace's other reviews in flight (starting, queued, running, or cancelled and finishing; stored or not) are estimated yet to spend. */
  inFlightUsd: z.number(),
  limitUsd: z.number(),
  /** `/usage`. A string rather than that literal, so figures stored before a move still read. */
  usagePage: z.string(),
});

export type BudgetRefusalDetails = z.infer<typeof budgetRefusalDetailsSchema>;

/**
 * What a credit refusal carries (t-58, `lib/app/usage/budget.ts`): in
 * `details` of a 402 `INSUFFICIENT_CREDITS`, and in `errorDetails` of a
 * stored review refused as it was claimed. Whole CopyCredits throughout.
 */
export const creditRefusalDetailsSchema = z.object({
  /** The estimate, rounded up to a whole credit. */
  estimateCredits: z.number().int(),
  /** Where the cost per judge came from, as in {@link budgetRefusalDetailsSchema}. */
  basis: budgetRefusalDetailsSchema.shape.basis,
  /** The workspace's balance. Below zero after a review cost more than its estimate. */
  balanceCredits: z.number().int(),
  /** What the workspace's reviews in flight have spent and are yet to spend, not yet charged. */
  heldCredits: z.number().int(),
  /** The balance less what is held; `0` once none is left. */
  remainingCredits: z.number().int(),
  /** `/usage`, where the balance is. */
  usagePage: z.string(),
});

export type CreditRefusalDetails = z.infer<typeof creditRefusalDetailsSchema>;

/** The figures of either refusal: the credits (t-58) or the monthly cap (t-49). */
export const reviewRefusalDetailsSchema = z.union([
  creditRefusalDetailsSchema,
  budgetRefusalDetailsSchema,
]);

export type ReviewRefusalDetails = z.infer<typeof reviewRefusalDetailsSchema>;

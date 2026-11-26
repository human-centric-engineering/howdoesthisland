/**
 * What `/compare/[id]` (t-89) reads of `GET /api/v1/comparisons/{id}`,
 * validated rather than cast. The wire contract is `comparisonDetailSchema`
 * in `lib/app/api/registry.ts` (t-87, t-88); this is the part the page
 * shows, read the same way, so a field the page never reads (`context`,
 * `model`, `costUsd`) cannot make it unreadable.
 */
import { z } from 'zod';

export const COMPARISONS_ENDPOINT = '/api/v1/comparisons';

export const comparisonEndpoint = (id: string): string =>
  `${COMPARISONS_ENDPOINT}/${encodeURIComponent(id)}`;

export const comparePath = (id: string): string => `/compare/${encodeURIComponent(id)}`;

const draftState = z.enum([
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled',
  'purged',
]);
export type DraftState = z.infer<typeof draftState>;

const verdictState = z.enum(['waiting', 'running', 'completed', 'failed', 'skipped']);
export type VerdictState = z.infer<typeof verdictState>;

const comparisonDraftSchema = z.object({
  position: z.number().int(),
  label: z.string().nullable(),
  /** `null` once its review is purged. */
  assessmentId: z.string().nullable(),
  status: draftState,
  overall: z.number().nullable(),
  band: z.string().nullable(),
  appeals: z.array(z.object({ appeal: z.string(), score: z.number() })).nullable(),
});
export type ComparisonDraft = z.infer<typeof comparisonDraftSchema>;

export const comparisonSchema = z.object({
  id: z.string(),
  status: z.enum(['running', 'completed', 'partial', 'failed']),
  framework: z.object({ slug: z.string(), version: z.string() }),
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  drafts: z.array(comparisonDraftSchema),
  /** Per appeal, once two drafts are scored; empty before. */
  appeals: z.array(
    z.object({
      appeal: z.string(),
      /** The positions with the best score; more than one on a tie. */
      leaders: z.array(z.number().int()),
      drafts: z.array(
        z.object({
          position: z.number().int(),
          score: z.number().nullable(),
          delta: z.number().nullable(),
        })
      ),
    })
  ),
  verdict: z.object({
    status: verdictState,
    /** The position of the draft that lands better, once `completed`. */
    draft: z.number().int().nullable(),
    why: z.string().nullable(),
    appeals: z.array(z.object({ appeal: z.string(), why: z.string() })),
    reason: z.string().nullable(),
  }),
});
export type Comparison = z.infer<typeof comparisonSchema>;

const DRAFT_FINAL: ReadonlySet<DraftState> = new Set([
  'completed',
  'partial',
  'failed',
  'cancelled',
  'purged',
]);

/**
 * Whether the comparison can still change: a draft still queued or running,
 * or a verdict still to come. A verdict `waiting` once every draft has ended
 * is due, or set to be asked again after a failure that passes, so it is
 * still moving.
 */
export function isMoving(comparison: Comparison): boolean {
  return (
    comparison.drafts.some((d) => !DRAFT_FINAL.has(d.status)) ||
    comparison.verdict.status === 'waiting' ||
    comparison.verdict.status === 'running'
  );
}

/** What a draft is called: its label, else its place. */
export function draftName(draft: Pick<ComparisonDraft, 'label' | 'position'>): string {
  return draft.label ?? `Draft ${draft.position + 1}`;
}

// --- The list (t-90) ---------------------------------------------------------

/** Where every comparison is listed, newest first. */
export const COMPARISONS_PATH = '/compare';

/** How many comparisons `/compare` asks for in its one call. */
export const COMPARISON_LIST_LIMIT = 20;

/** How many `/home` shows, with a link to the rest. */
export const COMPARISON_RECENT_LIMIT = 3;

/** The list call for one page: the one request a list of comparisons makes. */
export function comparisonListEndpoint(page = 1, limit = COMPARISON_LIST_LIMIT): string {
  const query = new URLSearchParams({ limit: String(limit) });
  if (page > 1) query.set('page', String(page));
  return `${COMPARISONS_ENDPOINT}?${query.toString()}`;
}

/** `/compare`'s address for a page: the first has none. */
export const comparisonsPagePath = (page: number): string =>
  page > 1 ? `${COMPARISONS_PATH}?page=${page}` : COMPARISONS_PATH;

/**
 * A row of `GET /api/v1/comparisons` (`comparisonSummarySchema` in
 * `lib/app/api/registry.ts`): only the fields a row shows. Its drafts carry
 * their states and scores and its verdict the draft it chose, so no row reads
 * its comparison again.
 */
export const comparisonRowSchema = z.object({
  id: z.string(),
  status: comparisonSchema.shape.status,
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  drafts: z.array(
    comparisonDraftSchema.pick({
      position: true,
      label: true,
      status: true,
      overall: true,
      band: true,
    })
  ),
  verdict: z.object({ status: verdictState, draft: z.number().int().nullable() }),
});
export type ComparisonRow = z.infer<typeof comparisonRowSchema>;

export const comparisonListSchema = z.array(comparisonRowSchema);

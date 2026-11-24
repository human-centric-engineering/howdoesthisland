/**
 * What the `/assess` workbench (t-78) reads from the API, validated rather
 * than cast: the catalogue's reader settings and reviewers, the review a
 * `POST /api/v1/assessments` creates, and each event of
 * `GET /api/v1/assessments/{id}/events` (`lib/app/assessments/api/events.ts`).
 */
import { z } from 'zod';
import { defaultsCatalogueSchema } from '@/components/app/projects/schemas';

export const ASSESSMENTS_ENDPOINT = '/api/v1/assessments';

export const assessmentEventsEndpoint = (id: string): string =>
  `${ASSESSMENTS_ENDPOINT}/${encodeURIComponent(id)}/events`;

export const reportPath = (id: string): string => `/assessments/${encodeURIComponent(id)}`;

const idName = z.object({ id: z.string(), name: z.string() });

/**
 * The project form's part of the catalogue, and what the workbench also
 * needs to name the AI reviewers: each reviewer with what it covers (an
 * appeal, a group, `lenses` or `influence`), and the groups by name.
 */
export const assessCatalogueSchema = defaultsCatalogueSchema.extend({
  result: defaultsCatalogueSchema.shape.result.extend({
    groups: z.array(idName),
    reviewers: z.array(z.object({ id: z.string(), covers: z.string() })),
  }),
});

export type AssessCatalogue = z.infer<typeof assessCatalogueSchema>;

const states = z.enum(['queued', 'running', 'completed', 'partial', 'failed', 'cancelled']);
export type ReviewState = z.infer<typeof states>;

export const FINAL_STATES: ReadonlySet<ReviewState> = new Set([
  'completed',
  'partial',
  'failed',
  'cancelled',
]);

/** A review's quick scan before its judges (t-77). */
export const earlyQuickScanSchema = z.object({
  overall: z.number().nullable(),
  band: z.string().nullable(),
  result: z.unknown(),
});
export type EarlyQuickScanWire = z.infer<typeof earlyQuickScanSchema>;

/** One AI reviewer's run, as it landed. */
export const judgeRunSchema = z.object({
  judge: z.string(),
  status: z.enum(['succeeded', 'failed']),
  errorCode: z.string().nullable(),
});
export type JudgeRunWire = z.infer<typeof judgeRunSchema>;

/** What the workbench reads of the review `POST /api/v1/assessments` stores. */
export const createdReviewSchema = z.object({
  id: z.string(),
  status: states,
  /** The judge slots it runs, in the version's order. */
  judges: z.array(z.string()),
  quickScan: earlyQuickScanSchema.nullable().optional(),
  judgeRuns: z.array(judgeRunSchema).optional(),
});
export type CreatedReview = z.infer<typeof createdReviewSchema>;

/** The stream's events, by their `type` (the SSE `event:` name). */
export const reviewEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('assessment_status'), status: states }),
  z.object({ type: z.literal('assessment_quick_scan') }).extend(earlyQuickScanSchema.shape),
  z.object({ type: z.literal('assessment_judge') }).extend(judgeRunSchema.shape),
  z.object({ type: z.literal('assessment_done'), status: states }),
  z.object({ type: z.literal('assessment_gone') }),
  z.object({ type: z.literal('assessment_timeout') }),
]);
export type ReviewEvent = z.infer<typeof reviewEventSchema>;

export const REVIEW_EVENT_TYPES = [
  'assessment_status',
  'assessment_quick_scan',
  'assessment_judge',
  'assessment_done',
  'assessment_gone',
  'assessment_timeout',
] as const satisfies ReadonlyArray<ReviewEvent['type']>;

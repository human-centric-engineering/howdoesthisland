/**
 * What the review lists (t-79) read from the API, validated rather than cast:
 * a row of `GET /api/v1/assessments` (`AssessmentSummary` in
 * `lib/app/assessments/api/views.ts`), only the fields a row shows, and the
 * part of a version's catalogue the filters are filled from.
 */
import { z } from 'zod';
import { ASSESSMENTS_ENDPOINT } from '@/components/app/workbench/schemas';

export { ASSESSMENTS_ENDPOINT };

/** How many reviews a list asks for in its one call. */
export const REVIEW_LIST_LIMIT = 20;

export const assessmentEndpoint = (id: string): string =>
  `${ASSESSMENTS_ENDPOINT}/${encodeURIComponent(id)}`;

/** What a list filters by; each left out means any. */
export type ReviewFilter = {
  projectId?: string;
  contentType?: string;
  band?: string;
};

export const FILTER_KEYS = ['projectId', 'contentType', 'band'] as const;

/** The list call for one page under a filter: the one request a list makes. */
export function reviewListEndpoint(filter: ReviewFilter, page = 1): string {
  const query = new URLSearchParams({ limit: String(REVIEW_LIST_LIMIT) });
  if (page > 1) query.set('page', String(page));
  for (const key of FILTER_KEYS) {
    const value = filter[key];
    if (value) query.set(key, value);
  }
  return `${ASSESSMENTS_ENDPOINT}?${query.toString()}`;
}

/**
 * A list page's address under this filter: `basePath` with it, and `page`
 * past the first. A filter change leaves the page out, to start at the first.
 */
export function filterHref(basePath: string, filter: ReviewFilter, page = 1): string {
  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filter[key];
    if (value) query.set(key, value);
  }
  if (page > 1) query.set('page', String(page));
  const qs = query.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** A filter read from a page's search params: only strings, only the keys it knows. */
export function filterFromSearch(
  search: Record<string, string | string[] | undefined>
): ReviewFilter {
  const filter: ReviewFilter = {};
  for (const key of FILTER_KEYS) {
    const value = search[key];
    if (typeof value === 'string' && value.length > 0 && value.length <= 64) filter[key] = value;
  }
  return filter;
}

/** `?page=` as a page number: 1 for anything that is not a whole number from 1. */
export function pageFromSearch(value: string | string[] | undefined): number {
  const n = typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : 1;
  return n >= 1 ? n : 1;
}

const states = z.enum(['queued', 'running', 'completed', 'partial', 'failed', 'cancelled']);
export type ReviewListState = z.infer<typeof states>;

export const reviewRowSchema = z.object({
  id: z.string(),
  status: states,
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  title: z.string().nullable(),
  source: z.object({
    kind: z.enum(['text', 'file', 'url']),
    url: z.string().nullable(),
    fileName: z.string().nullable(),
  }),
  wordCount: z.number(),
  overall: z.number().nullable(),
  band: z.string().nullable(),
  createdAt: z.string(),
});
export type ReviewRow = z.infer<typeof reviewRowSchema>;

export const reviewListSchema = z.array(reviewRowSchema);

const idName = z.object({ id: z.string(), name: z.string() });

/** The catalogue's content types and bands, which the filters offer. */
export const filterCatalogueSchema = z.object({
  request: z.object({ contentTypes: z.array(idName) }),
  result: z.object({ bands: z.array(z.string()) }),
});
export type FilterCatalogue = z.infer<typeof filterCatalogueSchema>;

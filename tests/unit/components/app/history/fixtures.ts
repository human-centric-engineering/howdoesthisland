/** Rows of `GET /api/v1/assessments` as the review lists (t-79) read them. */
import type { ReviewRow } from '@/components/app/history/schemas';

export function aReview(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: 'rev-1',
    status: 'completed',
    project: { id: 'proj-1', name: 'Spring launch' },
    title: 'Spring landing page',
    source: { kind: 'text', url: null, fileName: null },
    wordCount: 240,
    overall: 72.4,
    band: 'Strong',
    createdAt: '2026-11-20T10:00:00.000Z',
    ...overrides,
  };
}

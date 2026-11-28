/**
 * The worked example's reports, as `components/app/example/load.ts` builds
 * them: the engine's reviews of both drafts against the newest model file in
 * the repo, laid out by `buildReportView`. Shared by the coaching tests (t-108).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import {
  EXAMPLE_PROFILE,
  EXAMPLE_TITLE,
  reviewExample,
  type ExampleReview,
} from '@/lib/app/example/example-review';
import { reportModelSchema, reportResultSchema } from '@/lib/app/reports/input';
import { buildReportView, type ReportView } from '@/lib/app/reports/view';

const DATA = 'lib/app/frameworks/howdoesthisland/data';
const versionOf = (file: string) =>
  (/^model-(\d+)\.(\d+)\.(\d+)\.json$/.exec(file) ?? []).slice(1).map(Number);
const NEWEST = readdirSync(DATA)
  .filter((f) => versionOf(f).length === 3)
  .sort((a, b) => {
    const [x, y] = [versionOf(a), versionOf(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  })
  .at(-1)!;
export const DOCUMENT = JSON.parse(readFileSync(`${DATA}/${NEWEST}`, 'utf8')) as Record<
  string,
  unknown
>;
export const MODEL = reportModelSchema.parse(DOCUMENT);
export const REVIEWS = reviewExample(howDoesThisLand, DOCUMENT);

/** A review's full report view, as `components/app/example/load.ts` builds it. */
function viewOf(review: ExampleReview): ReportView {
  const result = reportResultSchema.parse(JSON.parse(JSON.stringify(review.full)));
  return buildReportView({
    assessment: {
      status: 'completed',
      profile: EXAMPLE_PROFILE,
      judges: review.accepted,
      framework: { slug: 'howdoesthisland', version: MODEL.meta.version },
      title: EXAMPLE_TITLE,
      wordCount: review.text.split(/\s+/).filter(Boolean).length,
      overall: result.scores.overall,
      band: result.scores.band,
      createdAt: '2026-11-22T09:00:00.000Z',
      completedAt: '2026-11-22T09:00:00.000Z',
      text: review.text,
      overlay: null,
      result,
      judgeRuns: review.accepted.map((judge) => ({ judge, status: 'succeeded', model: 'example' })),
    },
    result,
    model: MODEL,
  });
}

export const DRAFT_VIEW = viewOf(REVIEWS.draft);
export const FINAL_VIEW = viewOf(REVIEWS.final);

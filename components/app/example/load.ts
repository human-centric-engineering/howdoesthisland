/**
 * The worked example's report views (t-69), built as the app builds a
 * report: the example's results (`lib/app/example/example-review.ts`, the
 * engine's quick scan and assembly over hand-written reviewer replies) and
 * the latest published model, parsed by the report's own schemas and laid
 * out by `buildReportView`. Read in process, as every report reads the model.
 *
 * Nothing of the model reaches the browser but what a report shows.
 */
import { cache } from 'react';
import { FrameworkApiError, getFramework } from '@/lib/app/frameworks/api/service';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import { HOWDOESTHISLAND_SLUG } from '@/lib/app/frameworks/howdoesthisland/slug';
import {
  EXAMPLE_PROFILE,
  EXAMPLE_TITLE,
  reviewExample,
  type ExampleReview,
} from '@/lib/app/example/example-review';
import { reportModelSchema, reportResultSchema } from '@/lib/app/reports/input';
import { asOnTheWire, loadModelDocument } from '@/lib/app/reports/pdf/print-source';
import { buildReportView, type ReportView } from '@/lib/app/reports/view';
import { logger } from '@/lib/logging';

export interface ExampleViews {
  draftText: string;
  finalText: string;
  /** The first draft through the quick scan alone. */
  draftQuick: ReportView;
  /** The first draft, fully reviewed. */
  draft: ReportView;
  /** The final draft, fully reviewed. */
  final: ReportView;
}

const SLOTS = ['judge_ethos', 'judge_pathos', 'judge_logos', 'judge_kairos'];
const DAY = '2026-11-22T09:00:00.000Z';

function viewOf(
  review: ExampleReview,
  result: unknown,
  mode: 'quick' | 'full',
  framework: { slug: string; version: string },
  model: ReturnType<typeof reportModelSchema.parse>
): ReportView {
  const parsed = reportResultSchema.parse(asOnTheWire(result));
  const full = mode === 'full';
  return buildReportView({
    assessment: {
      status: 'completed',
      profile: full ? EXAMPLE_PROFILE : 'quick',
      judges: full ? SLOTS : [],
      framework,
      title: EXAMPLE_TITLE,
      wordCount: review.text.split(/\s+/).filter(Boolean).length,
      overall: parsed.scores.overall,
      band: parsed.scores.band,
      createdAt: DAY,
      completedAt: DAY,
      text: review.text,
      result: parsed,
      judgeRuns: full
        ? SLOTS.map((judge) => ({ judge, status: 'succeeded', model: 'example' }))
        : [],
    },
    result: parsed,
    model,
  });
}

/** The example, reviewed with the latest published model, or null when there is none. */
export const loadExampleViews = cache(async (): Promise<ExampleViews | null> => {
  let version: string | null;
  try {
    version = (await getFramework(HOWDOESTHISLAND_SLUG)).latestVersion;
  } catch (err) {
    if (err instanceof FrameworkApiError) return null;
    throw err;
  }
  const document = version ? await loadModelDocument(HOWDOESTHISLAND_SLUG, version) : null;
  if (!version || !document) return null;

  const reviews = reviewExample(howDoesThisLand, document);
  const problems = [...reviews.draft.problems, ...reviews.final.problems];
  if (problems.length > 0) {
    // The example still renders; what the model no longer accepts is dropped.
    logger.error('Worked example: the model refused part of it', undefined, {
      version,
      problems: problems.slice(0, 10),
    });
  }
  const model = reportModelSchema.parse(document);
  const framework = { slug: HOWDOESTHISLAND_SLUG, version };
  return {
    draftText: reviews.draft.text,
    finalText: reviews.final.text,
    draftQuick: viewOf(reviews.draft, reviews.draft.quick, 'quick', framework, model),
    draft: viewOf(reviews.draft, reviews.draft.full, 'full', framework, model),
    final: viewOf(reviews.final, reviews.final.full, 'full', framework, model),
  };
});

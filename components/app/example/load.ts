/**
 * The worked example's report views (t-69), built as the app builds a
 * report: the example's results (`lib/app/example/example-review.ts`, the
 * engine's quick scan and assembly over hand-written reviewer replies) and
 * the latest published model, parsed by the report's own schemas and laid
 * out by `buildReportView`. Read in process, as every report reads the model.
 *
 * **Built once per published version, not per view.** A published version
 * never changes and the example is deterministic, so the views are kept in
 * process by version, and which version is latest is looked up at most once
 * a {@link LOOKUP_TTL_MS}, however many views arrive. So an anonymous flood
 * of `/example-review` reaches neither the engine nor the database per view.
 * A version the example no longer fits is logged once and answers `null`
 * (the page's 404), rather than an error on every view.
 *
 * Nothing of the model reaches the browser but what a report shows.
 */
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

/** How long the latest published version is taken as known. */
export const LOOKUP_TTL_MS = 60_000;

const DAY = '2026-11-22T09:00:00.000Z';

function viewOf(
  review: ExampleReview,
  result: unknown,
  mode: 'quick' | 'full',
  framework: { slug: string; version: string },
  model: ReturnType<typeof reportModelSchema.parse>
): ReportView {
  const parsed = reportResultSchema.parse(asOnTheWire(result));
  const slots = mode === 'full' ? review.accepted : [];
  return buildReportView({
    assessment: {
      status: 'completed',
      profile: mode === 'full' ? EXAMPLE_PROFILE : 'quick',
      judges: slots,
      framework,
      title: EXAMPLE_TITLE,
      wordCount: review.text.split(/\s+/).filter(Boolean).length,
      overall: parsed.scores.overall,
      band: parsed.scores.band,
      createdAt: DAY,
      completedAt: DAY,
      text: review.text,
      result: parsed,
      // Only the reviewers whose replies the engine accepted ran, as a report says.
      judgeRuns: slots.map((judge) => ({ judge, status: 'succeeded', model: 'example' })),
    },
    result: parsed,
    model,
  });
}

/** The example reviewed with one version's model, or null when it no longer fits. */
/** No document for the version yet: not a verdict on the example, so not kept. */
const MISSING = Symbol('missing');

async function build(version: string): Promise<ExampleViews | null | typeof MISSING> {
  const document = await loadModelDocument(HOWDOESTHISLAND_SLUG, version);
  if (!document) return MISSING;
  try {
    const reviews = reviewExample(howDoesThisLand, document);
    const problems = [...reviews.draft.problems, ...reviews.final.problems];
    if (problems.length > 0) {
      // Logged once per version, since the views are kept: what the model
      // no longer accepts is left out, and the example still renders.
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
  } catch (err) {
    logger.error('Worked example: it does not fit this model version', err, { version });
    return null;
  }
}

/** Built views by version: a handful at most. A model the example doesn't fit is kept, so it is logged once. */
const built = new Map<string, Promise<ExampleViews | null>>();

/**
 * The latest published version, looked up at most once a {@link LOOKUP_TTL_MS}:
 * concurrent views share one lookup in flight. A lookup that fails keeps the
 * last good answer (retried after the same interval), so a database blip does
 * not turn every view into an error; with no good answer yet, it throws.
 */
let latest: { version: Promise<string | null>; at: number; good: string | null } | null = null;

function latestVersion(now: number): Promise<string | null> {
  if (latest && now - latest.at < LOOKUP_TTL_MS) return latest.version;
  const previous = latest?.good ?? null;
  const lookup = getFramework(HOWDOESTHISLAND_SLUG).then(
    (fw) => {
      if (latest?.version === lookup) latest.good = fw.latestVersion;
      return fw.latestVersion;
    },
    (err: unknown) => {
      if (err instanceof FrameworkApiError) return null;
      logger.error('Worked example: the latest version could not be looked up', err);
      if (previous !== null) return previous;
      throw err;
    }
  );
  latest = { version: lookup, at: now, good: previous };
  return lookup;
}

/** The example, reviewed with the latest published model, or null when there is none it fits. */
export async function loadExampleViews(now: number = Date.now()): Promise<ExampleViews | null> {
  const version = await latestVersion(now);
  if (!version) return null;
  let views: Promise<ExampleViews | null> | undefined = built.get(version);
  if (!views) {
    // A read that failed, or found no document yet (a publish in progress),
    // is retried on the next view; only "doesn't fit" is kept.
    views = build(version).then(
      (result) => {
        if (result === MISSING) {
          built.delete(version);
          return null;
        }
        return result;
      },
      (err: unknown) => {
        built.delete(version);
        throw err;
      }
    );
    built.set(version, views);
  }
  return views;
}

/** Test seam: forget the built views and the latest version. */
export function __resetExampleCacheForTests(): void {
  built.clear();
  latest = null;
}

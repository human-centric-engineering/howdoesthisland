/**
 * Tests: the worked example holds against the model (t-69).
 *
 * The example's AI reviewer replies are written by hand from the model, so
 * the model is what keeps them honest: every reply must pass the engine's own
 * validation with nothing dropped or missing, against the newest model file
 * in the repo, so a model change that breaks the example fails in the PR that
 * brings it. The scores are the engine's, never typed in.
 *
 * The page serves the latest *published* version, which can lag the newest
 * file until it is published; a version the example does not fit is logged
 * once and answers 404 there (`components/app/example/load.ts`).
 *
 * @see lib/app/example/example-review.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { howDoesThisLand } from '@/lib/app/frameworks/howdoesthisland/definition';
import {
  DRAFT,
  draftNote,
  EXAMPLE_INPUTS,
  FINAL,
  reviewExample,
} from '@/lib/app/example/example-review';

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
const MODEL = JSON.parse(readFileSync(`${DATA}/${NEWEST}`, 'utf8')) as Record<string, unknown>;

type Scored = { scores: { overall: number; band: string } };

describe('the worked example, reviewed by the engine', () => {
  const reviews = reviewExample(howDoesThisLand, MODEL);

  it('passes the engine’s reply and editor validation with nothing dropped or missing', () => {
    expect(reviews.draft.problems).toEqual([]);
    expect(reviews.final.problems).toEqual([]);
  });

  it('scores the rewrite well above the first draft, in both the quick scan and the full review', () => {
    const score = (r: unknown) => (r as Scored).scores.overall;
    expect(score(reviews.final.full)).toBeGreaterThan(score(reviews.draft.full) + 30);
    expect(score(reviews.final.quick)).toBeGreaterThan(score(reviews.draft.quick));
  });

  it('is deterministic: the same texts and replies give the same results', () => {
    const again = reviewExample(howDoesThisLand, MODEL);
    expect(again.draft.full).toEqual(reviews.draft.full);
    expect(again.final.full).toEqual(reviews.final.full);
  });

  it('reviews the texts the page shows', () => {
    expect(reviews.draft.text).toBe(DRAFT);
    expect(reviews.final.text).toBe(FINAL);
  });
});

describe('when the model no longer fits the example', () => {
  const clone = () => JSON.parse(JSON.stringify(MODEL)) as Record<string, unknown[]>;

  it('says what it dropped, rather than failing, when a dimension is gone', () => {
    const model = clone();
    model.dimensions = model.dimensions.filter((d) => (d as { id: string }).id !== 'eth_goodwill');
    const reviews = reviewExample(howDoesThisLand, model);
    expect(reviews.draft.problems.some((p) => p.includes('eth_goodwill'))).toBe(true);
  });

  it('refuses a model that no longer has the email’s type of copy', () => {
    const model = clone();
    model.content_types = model.content_types.filter(
      (c) => (c as { id: string }).id !== 'sales_email'
    );
    expect(() => reviewExample(howDoesThisLand, model as Record<string, unknown>)).toThrow(
      'The example context does not fit this model'
    );
  });
});

describe('when a reply or the editor is refused whole', () => {
  it('records it, assembles without it, and keeps no editor record', () => {
    const reviews = reviewExample(howDoesThisLand, MODEL, {
      ...EXAMPLE_INPUTS,
      draft: {
        ...EXAMPLE_INPUTS.draft,
        replies: { ...EXAMPLE_INPUTS.draft.replies, judge_ethos: 'not an object' },
        editor: 'not an object',
      },
    });
    expect(reviews.draft.problems.some((p) => p.startsWith('draft.judge_ethos:'))).toBe(true);
    expect(reviews.draft.problems.some((p) => p.startsWith('draft.editor:'))).toBe(true);
    expect(reviews.draft.full).not.toHaveProperty('editor');
    expect(reviews.final.problems).toEqual([]);
  });
});

describe('draftNote', () => {
  it('reads a reviewer’s note on a line of the first draft, and refuses a line with none', () => {
    expect(draftNote('We are a leading provider of digital transformation solutions.')).toMatch(
      /superlative/
    );
    expect(() => draftNote('Hi Sarah,')).toThrow();
  });

  it('every reply that ran is accepted, in run order', () => {
    const reviews = reviewExample(howDoesThisLand, MODEL);
    expect(reviews.draft.accepted).toEqual([
      'judge_ethos',
      'judge_pathos',
      'judge_logos',
      'judge_kairos',
    ]);
  });
});

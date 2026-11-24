/**
 * The workbench's pure parts (t-78): naming the AI reviewers, which can be
 * ticked, and how a refusal is worded. The rest is proved through the page
 * (`assess-workbench.test.tsx`).
 *
 * @see components/app/workbench/assess-draft.ts
 */
import { describe, expect, it } from 'vitest';
import {
  CHOOSE_REVIEWERS,
  EMPTY_DRAFT,
  choosableReviewers,
  problemsOf,
  readDraft,
  refusalOf,
  requestBodyOf,
  reviewerName,
} from '@/components/app/workbench/assess-draft';
import { MAX_CONTENT_CHARS } from '@/lib/app/assessments/limits';
import { APIClientError } from '@/lib/api/client';
import { anAssessCatalogue } from '@/tests/unit/components/app/workbench/fixtures';

describe('reviewerName', () => {
  const catalogue = anAssessCatalogue({ culture: true });

  it('names a reviewer by the appeal it covers, else its group', () => {
    expect(reviewerName(catalogue, 'judge_ethos')).toBe('Ethos');
    expect(reviewerName(catalogue, 'judge_craft')).toBe('Craft');
  });

  it('falls back to a reviewer set of that id, then to the slot', () => {
    const withLenses = {
      ...catalogue,
      result: {
        ...catalogue.result,
        profiles: [...catalogue.result.profiles, { id: 'lenses', name: 'The four lenses' }],
        reviewers: [...catalogue.result.reviewers, { id: 'judge_lenses', covers: 'lenses' }],
      },
    };
    expect(reviewerName(withLenses, 'judge_lenses')).toBe('The four lenses');
    expect(reviewerName(withLenses, 'judge_unknown')).toBe('judge_unknown');
  });
});

describe('choosableReviewers', () => {
  it('offers the culture reviewer only when the version serves countries', () => {
    expect(choosableReviewers(anAssessCatalogue({ culture: false })).map((r) => r.slot)).toEqual([
      'judge_ethos',
      'judge_pathos',
      'judge_craft',
    ]);
    expect(choosableReviewers(anAssessCatalogue({ culture: true })).map((r) => r.slot)).toContain(
      'judge_culture'
    );
  });
});

describe('readDraft and problemsOf', () => {
  const catalogue = anAssessCatalogue();

  it('reads back text over the limit, so the field keeps it and the limit is what is reported', () => {
    const text = 'x'.repeat(MAX_CONTENT_CHARS * 3);
    const draft = readDraft({
      ...EMPTY_DRAFT,
      text,
      url: `https://example.com/${'p'.repeat(3000)}`,
    });
    expect(draft.text).toBe(text);
    expect(problemsOf(draft, null, catalogue)).toEqual([
      { field: 'assess-text', message: expect.stringMatching(/over 40,000 characters/) },
    ]);
  });

  it('counts the text as the API does, trailing space and all', () => {
    const draft = { ...EMPTY_DRAFT, text: `${'x'.repeat(MAX_CONTENT_CHARS - 5)}\n\n\n\n\n\n` };
    expect(problemsOf(draft, null, catalogue)).toHaveLength(1);
    expect(problemsOf({ ...draft, text: '  \n ' }, null, catalogue)).toEqual([
      { field: 'assess-text', message: 'Paste some copy to review.' },
    ]);
  });
});

describe('requestBodyOf', () => {
  it('sends only the ticked AI reviewers the version still offers', () => {
    const draft = {
      ...EMPTY_DRAFT,
      text: 'Copy',
      profile: CHOOSE_REVIEWERS,
      judges: ['judge_culture', 'judge_retired', 'judge_ethos'],
    };
    const catalogue = anAssessCatalogue({ culture: false });
    expect(requestBodyOf(draft, null, catalogue)).toMatchObject({ judges: ['judge_ethos'] });
    expect(
      problemsOf({ ...draft, judges: ['judge_culture'] }, null, catalogue).map((p) => p.field)
    ).toEqual(['assess-reviewers']);
  });
});

describe('refusalOf', () => {
  it('links a credit refusal to the usage page even when its details name none', () => {
    expect(refusalOf(new APIClientError('No credits.', 'INSUFFICIENT_CREDITS', 402))).toEqual({
      message: 'No credits.',
      usagePage: '/usage',
    });
  });

  it('does not take a usage page that is not a path on this site', () => {
    const err = new APIClientError('Over budget.', 'BUDGET_EXCEEDED', 402, {
      usagePage: 'https://elsewhere.example',
    });
    expect(refusalOf(err)?.usagePage).toBe('/usage');
    const protocolRelative = new APIClientError('Over budget.', 'BUDGET_EXCEEDED', 402, {
      usagePage: '//elsewhere.example/usage',
    });
    expect(refusalOf(protocolRelative)?.usagePage).toBe('/usage');
  });

  it('leaves the intake’s refusals, and anything not from the API, to the server’s words', () => {
    expect(refusalOf(new APIClientError('Too long', 'TEXT_TOO_LONG', 422))).toBeNull();
    expect(refusalOf(new Error('boom'))).toBeNull();
  });
});

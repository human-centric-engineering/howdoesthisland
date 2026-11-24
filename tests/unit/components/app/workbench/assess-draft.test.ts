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
  settingsInProject,
  staleDefaultsOf,
} from '@/components/app/workbench/assess-draft';
import { NO_DEFAULT } from '@/components/app/projects/project-defaults';
import { MAX_CONTENT_CHARS, MAX_URL_CHARS } from '@/lib/app/assessments/limits';
import { aProject } from '@/tests/unit/components/app/projects/fixtures';
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
    expect(problemsOf(draft, null, catalogue, null)).toEqual([
      { field: 'assess-text', message: expect.stringMatching(/over 40,000 characters/) },
    ]);
  });

  it('counts the text as the API does, trailing space and all', () => {
    const draft = { ...EMPTY_DRAFT, text: `${'x'.repeat(MAX_CONTENT_CHARS - 5)}\n\n\n\n\n\n` };
    expect(problemsOf(draft, null, catalogue, null)).toHaveLength(1);
    expect(problemsOf({ ...draft, text: '  \n ' }, null, catalogue, null)).toEqual([
      { field: 'assess-text', message: 'Paste some copy to review.' },
    ]);
  });
});

describe('staleDefaultsOf', () => {
  it('finds none in a project whose defaults this version takes', () => {
    const project = aProject({
      defaults: { context: { contentType: 'landing_page', audience: { relationship: 'warm' } } },
    });
    expect(staleDefaultsOf(project, anAssessCatalogue())).toEqual([]);
    expect(staleDefaultsOf(null, anAssessCatalogue())).toEqual([]);
  });

  it('names each default the version refuses, which only the project’s page can take out', () => {
    const project = aProject({
      defaults: {
        context: {
          contentType: 'press_release',
          audience: { relationship: 'lukewarm', old_setting: 'x', archetype: 'general' },
          culture: { reader: 'gb' },
        },
      },
    });
    expect(staleDefaultsOf(project, anAssessCatalogue({ culture: false }))).toEqual([
      'Type of copy',
      'Relationship with the reader',
      'old_setting',
      'archetype',
      'Reader’s culture',
    ]);
    // With the culture switch on, a country it serves is fine.
    expect(staleDefaultsOf(project, anAssessCatalogue({ culture: true }))).not.toContain(
      'Reader’s culture'
    );
  });

  it('stops a review in that project before it is sent', () => {
    const project = aProject({ defaults: { context: { audience: { old_setting: 'x' } } } });
    const draft = { ...EMPTY_DRAFT, text: 'Copy' };
    expect(problemsOf(draft, null, anAssessCatalogue(), project).map((p) => p.field)).toEqual([
      'assess-project',
    ]);
  });
});

describe('settingsInProject', () => {
  it('shows the project’s value for a setting it fixes that a kept draft leaves to the model', () => {
    const project = aProject({
      defaults: { context: { contentType: 'landing_page', audience: { relationship: 'warm' } } },
    });
    const settings = settingsInProject(EMPTY_DRAFT.settings, project, anAssessCatalogue());
    expect(settings.contentType).toBe('landing_page');
    expect(settings.modifiers).toEqual({ relationship: 'warm' });
    expect(settings.archetype).toBe(NO_DEFAULT);
    // A value chosen in the draft stays chosen.
    expect(
      settingsInProject(
        { ...EMPTY_DRAFT.settings, contentType: 'general', modifiers: { relationship: 'cold' } },
        project,
        anAssessCatalogue()
      )
    ).toMatchObject({ contentType: 'general', modifiers: { relationship: 'cold' } });
  });
});

describe('problemsOf for a page’s address', () => {
  it('refuses an address longer than the API takes, beside its field', () => {
    const url = `https://example.com/?${'q'.repeat(MAX_URL_CHARS)}`;
    expect(
      problemsOf({ ...EMPTY_DRAFT, source: 'url', url }, null, anAssessCatalogue(), null)
    ).toEqual([{ field: 'assess-url', message: expect.stringMatching(/over 2,048 characters/) }]);
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
      problemsOf({ ...draft, judges: ['judge_culture'] }, null, catalogue, null).map((p) => p.field)
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

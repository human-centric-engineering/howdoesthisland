/**
 * Tests: a review's gaps, as questions for the writer (t-108).
 *
 * Real throughout: the worked example's reviews, built by the engine and laid
 * out by `buildReportView` against the newest model file in the repo, as the
 * example page builds them. The source cases start from that view and change
 * one thing, so each reads what one source adds.
 *
 * The model-vocabulary list is built here from the raw model file, not with
 * `modelVocabulary()`, so a check that missed a kind of id would fail.
 *
 * @see lib/app/coaching/gaps.ts
 */
import { describe, expect, it } from 'vitest';
import {
  buildGaps,
  LOW_APPEAL_SCORE,
  MAX_GAPS,
  MODEL_TERMS,
  modelVocabulary,
  slotsOf,
  TOPIC_OF,
  type Gap,
  type GapsInput,
} from '@/lib/app/coaching/gaps';
import type { ReportView } from '@/lib/app/reports/view';
import {
  DOCUMENT,
  DRAFT_VIEW,
  FINAL_VIEW,
  MODEL,
  REVIEWS,
} from '@/tests/unit/lib/app/coaching/example-view';

/** A finished rewrite with this draft. */
const draft = (text: string, id = 'rw-1') => ({ id, draft: text });

const gapsOf = (over: Partial<GapsInput> = {}): Gap[] =>
  buildGaps({
    view: DRAFT_VIEW,
    rewrite: null,
    known: { brief: null },
    vocabulary: modelVocabulary(MODEL),
    ...over,
  });

/** The draft's view with no recommendations, notes or low appeals: a blank to add one source to. */
function blank(): ReportView {
  const view = structuredClone(DRAFT_VIEW);
  view.recommendations = [];
  view.copy.notes = [];
  view.lands.appeals = view.lands.appeals.map((a) => ({ ...a, score: 80 }));
  return view;
}

const ids = (gaps: Gap[]) => gaps.map((g) => g.id);

// ─── The worked example ─────────────────────────────────────────────────────

describe('the worked example’s first draft', () => {
  const gaps = gapsOf();

  it('holds against the model, so the gaps below are the engine’s', () => {
    expect(REVIEWS.draft.problems).toEqual([]);
  });

  it('gives its gaps in a stable order, strongest first', () => {
    expect(ids(gaps)).toEqual([
      'reader-moment',
      'customer-proof',
      'reader-problem',
      'small-ask',
      'concrete-change',
      'how-it-works',
      'objection',
    ]);
    expect(gapsOf()).toEqual(gaps);
  });

  it('asks for the customer proof Tom fills with Harlow & Finch', () => {
    const proof = gaps.find((g) => g.id === 'customer-proof')!;
    expect(proof.question).toMatch(/solved this for someone like your reader/);
    expect(proof.question).toMatch(/hours, money or another number/);
    // The recommendation on borrowed credibility, with its two slots to fill.
    const rec = DRAFT_VIEW.recommendations.find((r) => r.dimensionId === 'eth_borrowed')!;
    expect(slotsOf(rec.rewrite)).toEqual(['result, with a number', 'a named client like her']);
    expect(proof.sources[0]).toEqual({ kind: 'recommendation', number: rec.number });
    expect(proof.found[0]).toBe('The results are claimed, not shown.');
    // The note on "outstanding results" asks the same thing, so it is the same gap.
    expect(proof.found).toContain(
      'Which clients, and what results? One named result would do more than both adjectives.'
    );
  });

  it('asks each fact once, however many places in the review ask for it', () => {
    expect(new Set(ids(gaps)).size).toBe(gaps.length);
    const moment = gaps.find((g) => g.id === 'reader-moment')!;
    expect(moment.sources.filter((s) => s.kind === 'recommendation')).toHaveLength(2);
  });
});

describe('the worked example’s final draft', () => {
  it('no longer asks for what the rewrite supplied', () => {
    const final = gapsOf({ view: FINAL_VIEW });
    expect(ids(final)).not.toContain('customer-proof');
    expect(ids(final)).not.toContain('reader-moment');
    // What its low-impact recommendations still leave to fill.
    expect(ids(final)).toEqual(['reader', 'story', 'cost-of-waiting']);
  });
});

// ─── Each source ────────────────────────────────────────────────────────────

describe('placeholders in the latest rewrite', () => {
  it('come first, each asked in its own words', () => {
    const gaps = gapsOf({
      rewrite: draft(
        'Hi Sarah,\n\n[ADD: a customer like Sarah’s] saw [ADD: the result, in hours].\n\nAgain: [ADD: a customer like Sarah’s].'
      ),
    });
    expect(ids(gaps).slice(0, 2)).toEqual(['placeholder-rw-1-p1', 'placeholder-rw-1-p2']);
    expect(gaps[0]).toMatchObject({
      missing: 'a customer like Sarah’s',
      question: 'Your rewrite has a gap for a customer like Sarah’s. What should go there?',
      sources: [{ kind: 'placeholder', rewriteId: 'rw-1', placeholderId: 'p1' }],
    });
  });

  it('are keyed to their rewrite, since a later one numbers its own from p1', () => {
    const later = gapsOf({ rewrite: draft('[ADD: the hours saved each week]', 'rw-2') });
    expect(later[0]).toMatchObject({
      id: 'placeholder-rw-2-p1',
      missing: 'the hours saved each week',
    });
    expect(ids(later)).not.toContain('placeholder-rw-1-p1');
  });

  it('give nothing with no rewrite', () => {
    expect(gapsOf().some((g) => g.id.startsWith('placeholder-'))).toBe(false);
  });
});

describe('recommendations', () => {
  const rec = DRAFT_VIEW.recommendations.find((r) => r.dimensionId === 'eth_borrowed')!;

  it('give a gap only when their rewrite leaves a slot to fill', () => {
    const view = blank();
    view.recommendations = [{ ...rec, rewrite: 'Name one client and one result.' }];
    expect(gapsOf({ view })).toEqual([]);
    view.recommendations = [rec];
    expect(ids(gapsOf({ view }))).toEqual(['customer-proof']);
  });

  it('on a part of the model with no question of its own, ask in the review’s words', () => {
    const view = blank();
    view.recommendations = [
      {
        ...rec,
        number: 4,
        dimensionId: 'aud_hook',
        issue: 'The opening could be hers.',
        rewrite: 'Your [recent announcement] mentioned [the change].',
      },
    ];
    expect(gapsOf({ view })).toEqual([
      {
        id: 'recommendation-4',
        missing: 'recent announcement; the change',
        question:
          'The review suggests: “Your [recent announcement] mentioned [the change].” What would you put in the brackets?',
        why: 'Only you know what goes there, so the review could not suggest it.',
        found: ['The opening could be hers.'],
        sources: [{ kind: 'recommendation', number: 4 }],
      },
    ]);
  });

  it('put an impact they do not know after low, as the report does', () => {
    const view = blank();
    view.recommendations = [
      { ...rec, number: 1, impact: 'critical' },
      { ...rec, number: 2, dimensionId: 'kai_call', impact: 'low' },
    ];
    expect(ids(gapsOf({ view }))).toEqual(['small-ask', 'customer-proof']);
  });

  it('read impact in any case, as the report does', () => {
    const view = blank();
    view.recommendations = [
      { ...rec, number: 1, impact: 'low' },
      { ...rec, number: 2, dimensionId: 'kai_call', impact: 'High' },
    ];
    expect(ids(gapsOf({ view }))).toEqual(['small-ask', 'customer-proof']);
  });

  it('do not take a citation, a link or an editor’s mark for a slot', () => {
    expect(slotsOf('Teams cut onboarding by 30% [1], or more [2, 3] [sic] […].')).toEqual([]);
    expect(
      slotsOf('See our [case study][1] and [the guide](/guide). [x] Done [emphasis added].')
    ).toEqual([]);
    expect(slotsOf('We cut [a cost] by [a number] [1].')).toEqual(['a cost', 'a number']);
  });

  it('asked in their own words with no issue, quote nothing', () => {
    const view = blank();
    view.recommendations = [
      { ...rec, number: 3, dimensionId: 'aud_hook', issue: '  ', rewrite: 'Open with [her news].' },
    ];
    expect(gapsOf({ view })[0]).toMatchObject({ id: 'recommendation-3', found: [] });
  });

  it('rank by impact before the report’s order', () => {
    const view = blank();
    const low = { ...rec, number: 1, impact: 'low' };
    const high = { ...rec, number: 2, dimensionId: 'kai_call', impact: 'high' };
    view.recommendations = [low, high];
    expect(ids(gapsOf({ view }))).toEqual(['small-ask', 'customer-proof']);
  });
});

describe('notes', () => {
  const note = DRAFT_VIEW.copy.notes.find((n) => n.dimensionId === 'eth_borrowed')!;

  it('on a weakness that needs a fact give a gap, quoting the note', () => {
    const view = blank();
    view.copy.notes = [note];
    expect(gapsOf({ view })).toEqual([
      expect.objectContaining({
        id: 'customer-proof',
        found: [note.note],
        sources: [{ kind: 'note', number: note.number }],
      }),
    ]);
  });

  it('on a strength, or on a craft change the rewrite can make alone, give none', () => {
    const view = blank();
    view.copy.notes = [
      { ...note, polarity: 'strength' },
      { ...note, number: 9, dimensionId: 'eth_polish' },
    ];
    expect(gapsOf({ view })).toEqual([]);
  });
});

describe('low appeals', () => {
  it('with no gap yet give one, from their weakest part that needs a fact', () => {
    const view = blank();
    const pathos = view.lands.appeals.find((a) => a.id === 'pathos')!;
    pathos.score = LOW_APPEAL_SCORE - 1;
    const rows = view.dimensions.find((g) => g.id === 'pathos')!.rows;
    for (const row of rows) row.score = row.id === 'pat_story' ? 0 : 2;
    expect(gapsOf({ view })).toEqual([
      expect.objectContaining({ id: 'story', sources: [{ kind: 'appeal', appeal: 'pathos' }] }),
    ]);
  });

  it('at the threshold, or already asked about, give none', () => {
    const view = blank();
    const pathos = view.lands.appeals.find((a) => a.id === 'pathos')!;
    pathos.score = LOW_APPEAL_SCORE;
    expect(gapsOf({ view })).toEqual([]);
    pathos.score = 0;
    view.copy.notes = [
      { ...DRAFT_VIEW.copy.notes[0], number: 1, polarity: 'weakness', dimensionId: 'pat_stakes' },
    ];
    expect(ids(gapsOf({ view }))).toEqual(['reader-problem']);
  });

  it('see the gap an earlier low appeal gave, so one that shares it gives no second', () => {
    const view = blank();
    for (const id of ['ethos', 'logos']) view.lands.appeals.find((a) => a.id === id)!.score = 0;
    for (const id of ['ethos', 'logos']) {
      for (const row of view.dimensions.find((g) => g.id === id)!.rows) {
        row.score = row.id === 'eth_integrity' || row.id === 'log_mechanism' ? 0 : 2;
      }
    }
    // Ethos's weakest asks for the reader's doubt, which logos asks for too
    // (its objections), so logos's own weakest, how it works, is not added.
    expect(gapsOf({ view })).toEqual([
      expect.objectContaining({ id: 'objection', sources: [{ kind: 'appeal', appeal: 'ethos' }] }),
    ]);
  });
});

describe('the project’s brief', () => {
  it('asks for each empty field last, in the brief’s order', () => {
    const gaps = gapsOf({ view: blank(), known: { brief: { voice: '  ' } } });
    expect(ids(gaps)).toEqual([
      'brief-offer',
      'reader',
      'brief-voice',
      'brief-markets',
      'brief-goals',
    ]);
    expect(gaps[1].sources).toEqual([{ kind: 'brief', field: 'audience' }]);
  });

  it('asks nothing of a review in no project', () => {
    expect(gapsOf({ view: blank(), known: { brief: null } })).toEqual([]);
  });

  it('drops a gap it already answers, whichever source asked', () => {
    const view = blank();
    view.copy.notes = [
      {
        ...DRAFT_VIEW.copy.notes[0],
        number: 1,
        polarity: 'weakness',
        dimensionId: 'eth_identification',
      },
    ];
    expect(ids(gapsOf({ view, known: { brief: {} } }))).toContain('reader');
    const answered = gapsOf({
      view,
      known: {
        brief: {
          offer: 'Stock systems for retailers',
          audience: 'Ops directors at mid-size retailers',
        },
      },
    });
    expect(ids(answered)).toEqual(['brief-voice', 'brief-markets', 'brief-goals']);
  });
});

it('offers at most MAX_GAPS', () => {
  const view = blank();
  const rec = DRAFT_VIEW.recommendations[0];
  view.recommendations = Array.from({ length: MAX_GAPS + 5 }, (_, i) => ({
    ...rec,
    number: i + 1,
    dimensionId: 'aud_hook',
    rewrite: `Say [fact ${i + 1}].`,
  }));
  expect(gapsOf({ view })).toHaveLength(MAX_GAPS);
});

// ─── The model is IP ────────────────────────────────────────────────────────

/**
 * The ids of the model's internals, read from the raw document: its appeals,
 * dimensions, moves, perspectives and their levers, red flags, lenses,
 * duties, groups and judges. Not the ids of what the report's cover names in
 * plain words (content types, audiences), which are ordinary English.
 */
const INTERNAL = [
  'appeals',
  'dimensions',
  'extra_dimensions',
  'moves',
  'perspectives',
  'red_flags',
  'lenses',
  'duties',
  'groups',
  'judges',
  'judge_catalogue',
] as const;
const idsOf = (list: unknown): string[] =>
  Array.isArray(list)
    ? list.flatMap((x: unknown) => {
        if (!x || typeof x !== 'object' || !('id' in x) || typeof x.id !== 'string') return [];
        const levers = 'levers' in x ? idsOf(x.levers) : [];
        return [x.id, ...levers];
      })
    : [];

/**
 * Words about how the model works. The app's own templates are held to all of
 * them; review text only to `MODEL_TERMS`, since a writer's fact may use the
 * rest (a product's weight).
 */
const TEMPLATE_TERMS = [
  ...MODEL_TERMS,
  'weight',
  'weights',
  'formula',
  'lever',
  'levers',
  'judge',
  'judges',
];
/** The model's id-shaped ids: a plain-word id (`audience`) is shown in the report as a name. */
const MODEL_IDS = [...new Set(INTERNAL.flatMap((k) => idsOf(DOCUMENT[k])))].filter((id) =>
  /[_\d]/.test(id)
);
const FORBIDDEN = [...MODEL_IDS, ...TEMPLATE_TERMS];
const textOf = (g: Gap) => [g.missing, g.question, g.why, ...g.found, g.id].join('\n');
const leaks = (gaps: Gap[]) =>
  gaps.flatMap((g) =>
    FORBIDDEN.filter((w) =>
      new RegExp(
        `(^|[^\\p{L}\\p{N}_])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_])`,
        'iu'
      ).test(textOf(g))
    ).map((w) => `${g.id}: ${w}`)
  );

describe('no gap carries the model’s internal vocabulary', () => {
  it('checks against a real list: the model’s dimensions, moves, levers and the rest', () => {
    expect(FORBIDDEN.length).toBeGreaterThan(100);
    for (const id of ['eth_borrowed', 'mv_specific_testimonial', 'rf_hype', 'judge_ethos']) {
      expect(FORBIDDEN).toContain(id);
    }
  });

  it('in any gap of the example, before or after, with a rewrite or a brief', () => {
    const all = [
      ...gapsOf(),
      ...gapsOf({ view: FINAL_VIEW }),
      ...gapsOf({ rewrite: draft('[ADD: a customer like Sarah’s]'), known: { brief: {} } }),
    ];
    expect(all.length).toBeGreaterThan(10);
    expect(leaks(all)).toEqual([]);
  });

  it('keeping a writer’s fact that shares a word with a plain-word id or an ordinary word', () => {
    // `move` is a duty's id and `audience` a group's; the report shows both as names.
    const label = 'what would move your audience to reply, and the product’s weight';
    const gaps = gapsOf({ view: blank(), rewrite: draft(`Hi [ADD: ${label}].`) });
    expect(gaps).toEqual([expect.objectContaining({ id: 'placeholder-rw-1-p1', missing: label })]);
  });

  it('leaving out review text that carries it', () => {
    const view = blank();
    const rec = DRAFT_VIEW.recommendations.find((r) => r.dimensionId === 'eth_borrowed')!;
    view.recommendations = [
      { ...rec, number: 1, issue: 'Apply mv_specific_testimonial here.' },
      {
        ...rec,
        number: 2,
        dimensionId: 'aud_hook',
        rewrite: 'Open with [the aud_hook dimension].',
      },
    ];
    const gaps = gapsOf({
      view,
      rewrite: draft('Hi [ADD: proof for eth_borrowed] and [ADD: a client].'),
    });
    expect(ids(gaps)).toEqual(['placeholder-rw-1-p2', 'customer-proof']);
    expect(gaps[1].found).toEqual([]);
    expect(leaks(gaps)).toEqual([]);
  });
});

it('every part of the model given a question exists in the newest model', () => {
  const dimensions = new Set([...MODEL.dimensions, ...MODEL.extra_dimensions].map((d) => d.id));
  expect(Object.keys(TOPIC_OF).filter((id) => !dimensions.has(id))).toEqual([]);
});

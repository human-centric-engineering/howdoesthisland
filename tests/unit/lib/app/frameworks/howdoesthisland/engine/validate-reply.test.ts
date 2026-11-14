/**
 * Tests: engine/validate-reply.ts — post-validation of a judge's reply
 * (t-18, BRIEF §5).
 *
 * Each rule is exercised by a reply that breaks it, against a real baseline
 * text (eval ev01) and the 0.5.1 model, and each test asserts the exact drop
 * record as well as what survives, so reverting a rule fails a test. The
 * last test hands a validated reply to `assemble()`, which is what reads it.
 *
 * Most tests reply about a dimension or two, so every other one is recorded
 * as `missing`. Those tests read {@link given}, the record less its gaps; the
 * `missing` tests read the whole record, against replies complete but for
 * the gap they test.
 */
import { describe, expect, it } from 'vitest';
import { createHowDoesThisLandEngine } from '@/lib/app/frameworks/howdoesthisland/engine';
import { indexModel } from '@/lib/app/frameworks/howdoesthisland/engine/model';
import {
  validateJudgeReply,
  type JudgeDrop,
} from '@/lib/app/frameworks/howdoesthisland/engine/validate-reply';
import {
  loadCases,
  loadModel,
} from '@/tests/unit/lib/app/frameworks/howdoesthisland/engine/baseline-fixtures';

const model = loadModel();
const m = indexModel(model);
const ev01 = loadCases().find((c) => c.file === 'eval/ev01.json');
if (!ev01) throw new Error('baseline case eval/ev01.json is missing');
const TEXT = ev01.input.text;
/** Words that are in ev01. */
const IN_TEXT = 'a revolutionary, world-class platform';
const NOT_IN_TEXT = 'words this text never says';

const validate = (slot: string, reply: unknown) => validateJudgeReply(m, slot, reply, TEXT);

/** A score of 2 for each id. */
const scores = (ids: readonly string[]) => ids.map((id) => ({ id, score: 2, rationale: 'r' }));
const ETHOS_DIMS = m.DIMS.filter((d) => d.appeal === 'ethos').map((d) => d.id);

/** An ethos reply with nothing wrong in it. */
const ethos = (over: Record<string, unknown> = {}) => ({
  appeal: 'ethos',
  summary: 'Two sentences.',
  dimension_scores: scores(ETHOS_DIMS),
  highlights: [{ quote: IN_TEXT, dimension: 'eth_polish', polarity: 'weakness', note: 'n' }],
  recommendations: [
    {
      dimension: 'eth_competence',
      move: 'mv_cut_superlatives',
      issue: 'i',
      original: IN_TEXT,
      rewrite: 'w',
      impact: 'high',
    },
  ],
  red_flags: [{ id: 'rf_hype', quote: IN_TEXT, note: 'n' }],
  ...over,
});

/** The record less what is `missing`, for a test about another rule. */
const given = (drops: JudgeDrop[]) => drops.filter((d) => d.reason !== 'missing');

function ok(result: ReturnType<typeof validate>) {
  if (!result.ok) throw new Error(`refused: ${result.detail}`);
  return result;
}

describe('validateJudgeReply() refuses a malformed reply whole', () => {
  it('when it is not an object', () => {
    expect(validate('judge_ethos', [])).toEqual({
      ok: false,
      reason: 'malformed',
      detail: 'the reply is not a JSON object',
    });
    expect(validate('judge_ethos', 'text').ok).toBe(false);
  });

  it('when it lacks the list its shape is built on', () => {
    expect(validate('judge_ethos', { appeal: 'ethos', summary: 's' })).toEqual({
      ok: false,
      reason: 'malformed',
      detail: 'the reply has no "dimension_scores" list',
    });
    expect(validate('judge_influence', { dimension_scores: [] })).toEqual({
      ok: false,
      reason: 'malformed',
      detail: 'the reply has no "perspectives" list',
    });
  });
});

describe('validateJudgeReply() on a reply with nothing wrong', () => {
  it('keeps everything and records nothing', () => {
    const { output, drops } = ok(validate('judge_ethos', ethos()));
    expect(drops).toEqual([]);
    expect(output).toEqual(ethos());
  });
});

describe('validateJudgeReply() drops unknown ids', () => {
  it('in scores, highlights, recommendations and red flags', () => {
    const { output, drops } = ok(
      validate(
        'judge_ethos',
        ethos({
          dimension_scores: [
            { id: 'eth_competence', score: 2, rationale: 'r' },
            { id: 'pat_story', score: 3, rationale: 'another judge’s dimension' },
          ],
          highlights: [{ quote: IN_TEXT, dimension: 'eth_nope', polarity: 'strength' }],
          recommendations: [
            {
              dimension: 'eth_nope',
              move: '',
              issue: 'i',
              original: '',
              rewrite: 'w',
              impact: 'low',
            },
          ],
          red_flags: [{ id: 'rf_fear', quote: IN_TEXT }],
        })
      )
    );
    expect(given(drops)).toEqual([
      { at: 'dimension_scores[1]', reason: 'unknown_id', detail: 'pat_story' },
      { at: 'highlights[0]', reason: 'unknown_id', detail: 'eth_nope' },
      { at: 'red_flags[0]', reason: 'unknown_id', detail: 'rf_fear' },
      { at: 'recommendations[0]', reason: 'unknown_id', detail: 'eth_nope' },
    ]);
    expect(output.dimension_scores).toHaveLength(1);
    expect(output.highlights).toEqual([]);
    expect(output.recommendations).toEqual([]);
    expect(output.red_flags).toEqual([]);
  });

  it('only the move from a recommendation naming an unknown one', () => {
    const rec = ethos().recommendations[0];
    const { output, drops } = ok(
      validate('judge_ethos', ethos({ recommendations: [{ ...rec, move: 'mv_nope' }] }))
    );
    expect(given(drops)).toEqual([
      { at: 'recommendations[0].move', reason: 'unknown_id', detail: 'mv_nope' },
    ]);
    expect(output.recommendations).toEqual([{ ...rec, move: '' }]);
  });

  it('a lever under the wrong perspective, and an unknown perspective', () => {
    const { output, drops } = ok(
      validate('judge_influence', {
        appeal: 'influence',
        summary: 's',
        perspectives: [
          {
            id: 'pv_rhetoric',
            score: 2,
            summary: 's',
            levers: [
              { id: 'lv_tricolon', status: 'present', quote: '', note: '' },
              { id: 'lv_reciprocity', status: 'absent', quote: '', note: '' },
            ],
          },
          { id: 'pv_nope', score: 2, summary: 's', levers: [] },
        ],
        recommendations: [],
      })
    );
    expect(given(drops)).toEqual([
      { at: 'perspectives[0].levers[1]', reason: 'unknown_id', detail: 'lv_reciprocity' },
      { at: 'perspectives[1]', reason: 'unknown_id', detail: 'pv_nope' },
    ]);
    expect(output.perspectives).toEqual([
      {
        id: 'pv_rhetoric',
        score: 2,
        summary: 's',
        levers: [{ id: 'lv_tricolon', status: 'present', note: '' }],
      },
    ]);
  });

  it('an unknown duty, a primary that is not a duty, and an unknown scale', () => {
    const lenses = ok(
      validate('judge_lenses', {
        dimension_scores: [],
        duties: { teach: 50, delight: 50, preach: 10, primary: 'preach' },
      })
    );
    expect(given(lenses.drops)).toEqual([
      { at: 'duties.preach', reason: 'unknown_id', detail: 'preach' },
      { at: 'duties.primary', reason: 'unknown_id', detail: 'preach' },
    ]);
    expect(lenses.output.duties).toEqual({ teach: 50, delight: 50 });

    const culture = ok(
      validate('judge_culture', {
        dimension_scores: [],
        text_positions: { context: 0.4, humour: 0.2 },
      })
    );
    expect(given(culture.drops)).toEqual([
      { at: 'text_positions.humour', reason: 'unknown_id', detail: 'humour' },
    ]);
    expect(culture.output.text_positions).toEqual({ context: 0.4 });
  });

  it('a repeated id after the first', () => {
    const { output, drops } = ok(
      validate(
        'judge_ethos',
        ethos({
          dimension_scores: [
            { id: 'eth_competence', score: 1 },
            { id: 'eth_competence', score: 4 },
          ],
        })
      )
    );
    expect(given(drops)).toEqual([
      { at: 'dimension_scores[1]', reason: 'duplicate', detail: 'eth_competence' },
    ]);
    expect(output.dimension_scores).toEqual([{ id: 'eth_competence', score: 1 }]);
  });
});

describe('validateJudgeReply() clamps scores to their scale', () => {
  it('records a score outside 0–4, reads a numeric string, and drops one that is not a number', () => {
    const { output, drops } = ok(
      validate(
        'judge_ethos',
        ethos({
          dimension_scores: [
            { id: 'eth_competence', score: 7 },
            { id: 'eth_integrity', score: -1 },
            { id: 'eth_goodwill', score: '3' },
            { id: 'eth_borrowed', score: 'high' },
          ],
        })
      )
    );
    expect(given(drops)).toEqual([
      { at: 'dimension_scores[0].score', reason: 'out_of_range', detail: '7' },
      { at: 'dimension_scores[1].score', reason: 'out_of_range', detail: '-1' },
      { at: 'dimension_scores[3].score', reason: 'malformed', detail: 'high' },
    ]);
    expect(output.dimension_scores?.map((d) => [d.id, d.score])).toEqual([
      ['eth_competence', 4],
      ['eth_integrity', 0],
      ['eth_goodwill', 3],
    ]);
  });

  it('holds duties to 0–100, culture positions to 0–1, and perspectives to 0–4', () => {
    const lenses = ok(
      validate('judge_lenses', { dimension_scores: [], duties: { teach: 150, primary: 'teach' } })
    );
    expect(lenses.output.duties).toEqual({ teach: 100, primary: 'teach' });
    expect(given(lenses.drops)).toEqual([
      { at: 'duties.teach', reason: 'out_of_range', detail: '150' },
    ]);

    const culture = ok(
      validate('judge_culture', { dimension_scores: [], text_positions: { trust: 1.5 } })
    );
    expect(culture.output.text_positions).toEqual({ trust: 1 });
    expect(given(culture.drops)).toEqual([
      { at: 'text_positions.trust', reason: 'out_of_range', detail: '1.5' },
    ]);

    const influence = ok(
      validate('judge_influence', { perspectives: [{ id: 'pv_godin', score: 9, levers: [] }] })
    );
    expect(influence.output.perspectives).toMatchObject([{ id: 'pv_godin', score: 4 }]);
    expect(given(influence.drops)).toEqual([
      { at: 'perspectives[0].score', reason: 'out_of_range', detail: '9' },
    ]);
  });
});

describe('validateJudgeReply() locates quotes in the text', () => {
  it('drops a highlight or red flag whose quote is not there', () => {
    const { output, drops } = ok(
      validate(
        'judge_ethos',
        ethos({
          highlights: [{ quote: NOT_IN_TEXT, dimension: 'eth_polish', polarity: 'weakness' }],
          red_flags: [{ id: 'rf_hype', quote: NOT_IN_TEXT }],
        })
      )
    );
    expect(given(drops)).toEqual([
      { at: 'highlights[0]', reason: 'unlocated_quote', detail: NOT_IN_TEXT },
      { at: 'red_flags[0]', reason: 'unlocated_quote', detail: NOT_IN_TEXT },
    ]);
    expect(output.highlights).toEqual([]);
    expect(output.red_flags).toEqual([]);
  });

  it('clears only the quote of a recommendation or lever whose quote is not there', () => {
    const rec = ethos().recommendations[0];
    const reco = ok(
      validate('judge_ethos', ethos({ recommendations: [{ ...rec, original: NOT_IN_TEXT }] }))
    );
    expect(given(reco.drops)).toEqual([
      { at: 'recommendations[0].original', reason: 'unlocated_quote', detail: NOT_IN_TEXT },
    ]);
    expect(reco.output.recommendations).toEqual([{ ...rec, original: '' }]);

    const lever = ok(
      validate('judge_influence', {
        perspectives: [
          {
            id: 'pv_rhetoric',
            score: 1,
            levers: [{ id: 'lv_tricolon', status: 'present', quote: NOT_IN_TEXT }],
          },
        ],
      })
    );
    expect(given(lever.drops)).toEqual([
      { at: 'perspectives[0].levers[0].quote', reason: 'unlocated_quote', detail: NOT_IN_TEXT },
    ]);
    expect(lever.output.perspectives?.[0].levers).toEqual([
      { id: 'lv_tricolon', status: 'present' },
    ]);
  });

  it('finds a quote the way assemble() does: ignoring case and runs of whitespace', () => {
    const quote = 'A   REVOLUTIONARY,\nworld-class platform';
    const { drops } = ok(
      validate(
        'judge_ethos',
        ethos({ highlights: [{ quote, dimension: 'eth_polish', polarity: 'weakness' }] })
      )
    );
    expect(given(drops)).toEqual([]);
  });

  it('does not count a blank quote as located, though the text has spaces', () => {
    const rec = ethos().recommendations[0];
    const { output, drops } = ok(
      validate(
        'judge_ethos',
        ethos({
          highlights: [{ quote: ' ', dimension: 'eth_polish', polarity: 'weakness' }],
          recommendations: [{ ...rec, original: '\n ' }],
          red_flags: [{ id: 'rf_hype', quote: '  ' }],
        })
      )
    );
    expect(given(drops)).toEqual([
      { at: 'highlights[0]', reason: 'unlocated_quote', detail: ' ' },
      { at: 'red_flags[0]', reason: 'unlocated_quote', detail: '  ' },
      { at: 'recommendations[0].original', reason: 'unlocated_quote', detail: '\n ' },
    ]);
    expect(output.highlights).toEqual([]);
    expect(output.red_flags).toEqual([]);
    expect(output.recommendations).toEqual([{ ...rec, original: '' }]);
  });
});

describe('validateJudgeReply() holds lists to the judge’s limits', () => {
  it('keeps the first max_highlights and records the rest', () => {
    // judge_ethos: max_highlights 8, max_recommendations 5 (model 0.5.1).
    const h = { quote: IN_TEXT, dimension: 'eth_polish', polarity: 'weakness' };
    const rec = ethos().recommendations[0];
    const { output, drops } = ok(
      validate(
        'judge_ethos',
        ethos({ highlights: Array(10).fill(h), recommendations: Array(6).fill(rec) })
      )
    );
    expect(given(drops)).toEqual([
      { at: 'highlights[8]', reason: 'over_limit' },
      { at: 'highlights[9]', reason: 'over_limit' },
      { at: 'recommendations[5]', reason: 'over_limit' },
    ]);
    expect(output.highlights).toHaveLength(8);
    expect(output.recommendations).toHaveLength(5);
  });
});

describe('validateJudgeReply() drops malformed items', () => {
  it('an item of the wrong shape, a bad polarity or impact, and a field that is not a list', () => {
    const { output, drops } = ok(
      validate(
        'judge_ethos',
        ethos({
          dimension_scores: [7, { id: 'eth_competence', score: 2 }],
          highlights: [{ quote: IN_TEXT, dimension: 'eth_polish', polarity: 'meh' }],
          recommendations: [{ ...ethos().recommendations[0], impact: 'huge' }],
          red_flags: 'none',
        })
      )
    );
    expect(given(drops).map((d) => [d.at, d.reason])).toEqual([
      ['dimension_scores[0]', 'malformed'],
      ['highlights[0]', 'malformed'],
      ['red_flags', 'malformed'],
      ['recommendations[0]', 'malformed'],
    ]);
    expect(output.dimension_scores).toHaveLength(1);
  });
});

describe('validateJudgeReply() records what the reply leaves out', () => {
  /** Every perspective, each with every lever, nothing wrong. */
  const allPerspectives = () =>
    m.data.perspectives.map((p) => ({
      id: p.id,
      score: 2,
      summary: 's',
      levers: p.levers.map((l) => ({ id: l.id, status: 'absent', quote: '', note: '' })),
    }));
  const influence = (perspectives: unknown[]) => ({
    appeal: 'influence',
    summary: 's',
    perspectives,
    recommendations: [],
  });
  const LENS_DIMS = m.LENSES.map((d) => d.id);
  const DUTIES = m.FN.map((f) => f.id);
  /** Every duty, totalling 100. */
  const allDuties = () => ({
    ...Object.fromEntries(DUTIES.map((k, i) => [k, i === 0 ? 100 : 0])),
    primary: DUTIES[0],
  });
  const CULTURE_DIMS = m.EXTRA.filter((d) => d.group === 'culture').map((d) => d.id);
  const allPositions = () => Object.fromEntries(m.SCALE_IDS.map((k) => [k, 0.5]));

  it('records nothing for a complete reply of each shape', () => {
    expect(ok(validate('judge_influence', influence(allPerspectives()))).drops).toEqual([]);
    expect(
      ok(validate('judge_lenses', { dimension_scores: scores(LENS_DIMS), duties: allDuties() }))
        .drops
    ).toEqual([]);
    expect(
      ok(
        validate('judge_culture', {
          dimension_scores: scores(CULTURE_DIMS),
          text_positions: allPositions(),
        })
      ).drops
    ).toEqual([]);
  });

  it('a dimension not scored, including one dropped for another reason', () => {
    const [first, second, ...rest] = ETHOS_DIMS;
    const { output, drops } = ok(
      validate(
        'judge_ethos',
        ethos({ dimension_scores: [{ id: second, score: 'high' }, ...scores(rest)] })
      )
    );
    expect(drops).toEqual([
      { at: 'dimension_scores[0].score', reason: 'malformed', detail: 'high' },
      { at: 'dimension_scores', reason: 'missing', detail: first },
      { at: 'dimension_scores', reason: 'missing', detail: second },
    ]);
    expect(output.dimension_scores?.map((d) => d.id)).toEqual(rest);
  });

  it('a perspective not given, and a lever not marked', () => {
    const [left, ...kept] = allPerspectives();
    const [unmarked, ...levers] = kept[0].levers;
    kept[0] = { ...kept[0], levers };
    const { drops } = ok(validate('judge_influence', influence(kept)));
    expect(drops).toEqual([
      { at: 'perspectives[0].levers', reason: 'missing', detail: unmarked.id },
      { at: 'perspectives', reason: 'missing', detail: left.id },
    ]);
  });

  it('a duty, the primary duty, and a culture position', () => {
    const [unset, ...duties] = DUTIES;
    const lenses = ok(
      validate('judge_lenses', {
        dimension_scores: scores(LENS_DIMS),
        duties: Object.fromEntries(duties.map((k) => [k, 0])),
      })
    );
    expect(lenses.drops).toEqual([
      { at: 'duties', reason: 'missing', detail: unset },
      { at: 'duties.primary', reason: 'missing' },
    ]);

    const [unplaced, ...scales] = m.SCALE_IDS;
    const culture = ok(
      validate('judge_culture', {
        dimension_scores: scores(CULTURE_DIMS),
        text_positions: Object.fromEntries(scales.map((k) => [k, 0.5])),
      })
    );
    expect(culture.drops).toEqual([{ at: 'text_positions', reason: 'missing', detail: unplaced }]);
  });

  it('duties that do not total 100, kept as given, and only when every duty is there', () => {
    const [first, ...others] = DUTIES;
    const off = {
      ...Object.fromEntries(DUTIES.map((k) => [k, 30])),
      primary: first,
    };
    const lenses = ok(
      validate('judge_lenses', { dimension_scores: scores(LENS_DIMS), duties: off })
    );
    expect(lenses.drops).toEqual([
      { at: 'duties', reason: 'off_total', detail: String(30 * DUTIES.length) },
    ]);
    expect(lenses.output.duties).toEqual(off);

    const partial = ok(
      validate('judge_lenses', {
        dimension_scores: scores(LENS_DIMS),
        duties: { ...Object.fromEntries(others.map((k) => [k, 10])), primary: others[0] },
      })
    );
    expect(partial.drops).toEqual([{ at: 'duties', reason: 'missing', detail: first }]);
  });

  it('every duty and position when the block is absent', () => {
    const lenses = ok(validate('judge_lenses', { dimension_scores: scores(LENS_DIMS) }));
    expect(lenses.drops).toEqual([
      ...DUTIES.map((detail) => ({ at: 'duties', reason: 'missing', detail })),
      { at: 'duties.primary', reason: 'missing' },
    ]);
    expect(lenses.output.duties).toBeUndefined();

    const culture = ok(validate('judge_culture', { dimension_scores: scores(CULTURE_DIMS) }));
    expect(culture.drops).toEqual(
      m.SCALE_IDS.map((detail) => ({ at: 'text_positions', reason: 'missing', detail }))
    );
  });
});

describe('a validated reply', () => {
  it('is one assemble() reads, and moves the score it names', () => {
    const engine = createHowDoesThisLandEngine(model, { culture: true });
    const q = engine.quickScan(TEXT, ev01.input.ctx);
    const reply = ethos({
      dimension_scores: ETHOS_DIMS.map((id) => ({ id, score: 4, rationale: 'r' })),
    });
    const { output } = ok(validate('judge_ethos', reply));
    const result = engine.assemble(TEXT, ev01.input.ctx, structuredClone(q), { ethos: output });
    expect(result.mode).toBe('full');
    expect(result.dimensions.find((d) => d.id === 'eth_competence')).toMatchObject({
      score: 4,
      source: 'ai',
    });
  });
});
